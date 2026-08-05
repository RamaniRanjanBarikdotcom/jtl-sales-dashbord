const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index < 1) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function argument(name) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || '';
}

function bool(value) {
  return String(value || '').toLowerCase() === 'true';
}

function clientConfig() {
  return {
    host: process.env.PG_HOST,
    port: Number(process.env.PG_PORT || 5432),
    database: process.env.PG_DATABASE,
    user: process.env.PG_USER,
    password: process.env.PG_PASSWORD,
    ssl: bool(process.env.PG_SSL) ? { rejectUnauthorized: bool(process.env.PG_SSL_VERIFY) } : undefined,
    statement_timeout: 120000,
    application_name: 'jtl-channel-payment-phase0-readonly',
  };
}

async function query(client, text, values = []) {
  return (await client.query(text, values)).rows;
}

async function main() {
  loadEnvFile(path.resolve(process.cwd(), process.env.ENV_FILE || '.env'));
  const required = ['PG_HOST', 'PG_DATABASE', 'PG_USER'];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) throw new Error(`Missing database settings: ${missing.join(', ')}`);

  const requestedTenant = argument('tenant');
  const client = new Client(clientConfig());
  await client.connect();
  await client.query('BEGIN TRANSACTION READ ONLY');

  try {
    const tenants = await query(client, `
      SELECT t.id, t.name, t.is_active, COUNT(o.id)::int AS order_count
      FROM tenants t
      LEFT JOIN orders o ON o.tenant_id = t.id
      WHERE ($1::uuid IS NULL OR t.id = $1::uuid)
      GROUP BY t.id, t.name, t.is_active
      ORDER BY order_count DESC, t.name
    `, [requestedTenant || null]);

    const tenantIds = tenants.map((tenant) => tenant.id);
    const report = {
      generatedAt: new Date().toISOString(),
      mode: 'read-only',
      requestedTenant: requestedTenant || null,
      tenants,
      schema: await query(client, `
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'orders'
          AND column_name IN (
            'channel', 'payment_method', 'shipping_method', 'external_order_number',
            'source_platform_raw', 'source_payment_raw', 'source_shipping_raw',
            'source_marketplace_raw', 'source_account_raw', 'source_shop_raw',
            'sales_channel_id', 'sales_channel_name', 'payment_method_canonical',
            'channel_resolution_status'
          )
        ORDER BY ordinal_position
      `),
      session: await query(client, `
        SELECT
          current_database() AS database_name,
          current_user AS database_user,
          current_setting('transaction_read_only') AS transaction_read_only,
          current_setting('server_version') AS server_version
      `),
      combinations: tenantIds.length ? await query(client, `
        SELECT o.tenant_id, t.name AS tenant_name,
          COALESCE(NULLIF(TRIM(o.channel), ''), 'Unknown') AS platform_raw,
          COALESCE(NULLIF(TRIM(o.payment_method), ''), 'Unknown') AS payment_raw,
          COALESCE(NULLIF(TRIM(o.shipping_method), ''), 'Unknown') AS shipping_raw,
          COUNT(*)::int AS orders,
          ROUND(COALESCE(SUM(o.gross_revenue), 0)::numeric, 2) AS revenue,
          MIN(o.order_date) AS first_order,
          MAX(o.order_date) AS last_order
        FROM orders o
        JOIN tenants t ON t.id = o.tenant_id
        WHERE o.tenant_id = ANY($1::uuid[])
        GROUP BY o.tenant_id, t.name, platform_raw, payment_raw, shipping_raw
        ORDER BY revenue DESC
        LIMIT 1000
      `, [tenantIds]) : [],
      marketplaceLikePayments: tenantIds.length ? await query(client, `
        SELECT o.tenant_id, t.name AS tenant_name,
          COALESCE(NULLIF(TRIM(o.channel), ''), 'Unknown') AS platform_raw,
          COALESCE(NULLIF(TRIM(o.payment_method), ''), 'Unknown') AS payment_raw,
          COUNT(*)::int AS orders,
          ROUND(COALESCE(SUM(o.gross_revenue), 0)::numeric, 2) AS revenue,
          MIN(o.order_date) AS first_order,
          MAX(o.order_date) AS last_order
        FROM orders o
        JOIN tenants t ON t.id = o.tenant_id
        WHERE o.tenant_id = ANY($1::uuid[])
          AND LOWER(COALESCE(o.payment_method, '')) ~ '(amazon|ebay|otto|kaufland|mediamarkt|saturn)'
        GROUP BY o.tenant_id, t.name, platform_raw, payment_raw
        ORDER BY revenue DESC
      `, [tenantIds]) : [],
      channelSummary: tenantIds.length ? await query(client, `
        SELECT o.tenant_id, t.name AS tenant_name,
          COALESCE(NULLIF(TRIM(o.channel), ''), 'Unknown') AS platform_raw,
          COUNT(*)::int AS orders,
          ROUND(COALESCE(SUM(o.gross_revenue), 0)::numeric, 2) AS revenue
        FROM orders o
        JOIN tenants t ON t.id = o.tenant_id
        WHERE o.tenant_id = ANY($1::uuid[])
        GROUP BY o.tenant_id, t.name, platform_raw
        ORDER BY revenue DESC
      `, [tenantIds]) : [],
      representativeSamples: tenantIds.length ? await query(client, `
        WITH normalized AS (
          SELECT
            o.tenant_id,
            t.name AS tenant_name,
            o.jtl_order_id,
            o.order_number,
            o.external_order_number,
            COALESCE(NULLIF(TRIM(o.channel), ''), 'Unknown') AS platform_raw,
            COALESCE(NULLIF(TRIM(o.payment_method), ''), 'Unknown') AS payment_raw,
            COALESCE(NULLIF(TRIM(o.shipping_method), ''), 'Unknown') AS shipping_raw,
            LOWER(COALESCE(o.channel, '')) AS platform_normalized,
            LOWER(COALESCE(o.payment_method, '')) AS payment_normalized,
            o.order_date
          FROM orders o
          JOIN tenants t ON t.id = o.tenant_id
          WHERE o.tenant_id = ANY($1::uuid[])
        ), classified AS (
          SELECT *,
            CASE
              WHEN platform_normalized ~ 'amazon' AND payment_normalized ~ '(ebay|otto|kaufland|mediamarkt|saturn)' THEN 'conflicting'
              WHEN platform_normalized ~ 'ebay' AND payment_normalized ~ '(amazon|otto|kaufland|mediamarkt|saturn)' THEN 'conflicting'
              WHEN platform_normalized ~ 'otto' AND payment_normalized ~ '(amazon|ebay|kaufland|mediamarkt|saturn)' THEN 'conflicting'
              WHEN platform_normalized ~ 'kaufland' AND payment_normalized ~ '(amazon|ebay|otto|mediamarkt|saturn)' THEN 'conflicting'
              WHEN platform_normalized ~ '(mediamarkt|saturn)' AND payment_normalized ~ '(amazon|ebay|otto|kaufland)' THEN 'conflicting'
              WHEN platform_normalized ~ 'amazon' THEN 'Amazon'
              WHEN platform_normalized ~ 'ebay' THEN 'eBay'
              WHEN platform_normalized ~ 'otto' THEN 'Otto'
              WHEN platform_normalized ~ 'kaufland' THEN 'Kaufland'
              WHEN platform_normalized ~ '(mediamarkt|saturn)' THEN 'MediaMarktSaturn'
              WHEN platform_normalized ~ '(weitere|unicorn|jtl.?wawi|unknown)'
                AND NULLIF(TRIM(external_order_number), '') IS NOT NULL
                AND payment_normalized ~ 'amazon' THEN 'Amazon'
              WHEN platform_normalized ~ '(weitere|unicorn|jtl.?wawi|unknown)'
                AND NULLIF(TRIM(external_order_number), '') IS NOT NULL
                AND payment_normalized ~ 'ebay' THEN 'eBay'
              WHEN platform_normalized ~ '(weitere|unicorn|jtl.?wawi|unknown)'
                AND NULLIF(TRIM(external_order_number), '') IS NOT NULL
                AND payment_normalized ~ 'otto' THEN 'Otto'
              WHEN platform_normalized ~ '(weitere|unicorn|jtl.?wawi|unknown)'
                AND NULLIF(TRIM(external_order_number), '') IS NOT NULL
                AND payment_normalized ~ 'kaufland' THEN 'Kaufland'
              WHEN platform_normalized ~ '(weitere|unicorn|jtl.?wawi|unknown)'
                AND NULLIF(TRIM(external_order_number), '') IS NOT NULL
                AND payment_normalized ~ '(mediamarkt|saturn)' THEN 'MediaMarktSaturn'
              WHEN platform_normalized ~ '(onlineshop|online.?shop|direct|webshop)' THEN 'Onlineshop/Direct'
              WHEN payment_normalized ~ '(amazon|ebay|otto|kaufland|mediamarkt|saturn)' THEN 'payment-only-unresolved'
              ELSE 'unresolved'
            END AS candidate_sample_group
          FROM normalized
        ), ranked AS (
          SELECT *, ROW_NUMBER() OVER (
            PARTITION BY tenant_id, candidate_sample_group
            ORDER BY order_date DESC, jtl_order_id DESC
          ) AS sample_rank
          FROM classified
          WHERE candidate_sample_group IN (
            'Amazon', 'eBay', 'Otto', 'Kaufland', 'MediaMarktSaturn',
            'Onlineshop/Direct', 'conflicting', 'payment-only-unresolved', 'unresolved'
          )
        )
        SELECT
          tenant_id, tenant_name, candidate_sample_group, jtl_order_id,
          order_number, external_order_number, platform_raw, payment_raw,
          shipping_raw, order_date
        FROM ranked
        WHERE sample_rank <= 20
        ORDER BY tenant_name, candidate_sample_group, sample_rank
      `, [tenantIds]) : [],
    };

    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
