const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const content = fs.readFileSync(filePath, 'utf8');

  for (const line of content.split('\n')) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const equalIndex = trimmed.indexOf('=');

    if (equalIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, equalIndex).trim();
    let value = trimmed.slice(equalIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function bool(value) {
  return String(value || '').toLowerCase() === 'true';
}

function buildClient() {
  const useSsl = bool(process.env.PG_SSL);
  const verifySsl = bool(process.env.PG_SSL_VERIFY);

  return new Client({
    host: process.env.PG_HOST,
    port: Number(process.env.PG_PORT || 5432),
    database: process.env.PG_DATABASE,
    user: process.env.PG_USER,
    password: process.env.PG_PASSWORD,
    ssl: useSsl
      ? {
          rejectUnauthorized: verifySsl,
        }
      : undefined,
  });
}

async function main() {
  const envPath = process.env.ENV_FILE || '.env';
  loadEnvFile(path.resolve(process.cwd(), envPath));

  console.log('Resolved DB config:', {
    host: process.env.PG_HOST,
    port: process.env.PG_PORT,
    database: process.env.PG_DATABASE,
    user: process.env.PG_USER,
    ssl: process.env.PG_SSL,
    sslVerify: process.env.PG_SSL_VERIFY,
  });

  if (!process.env.PG_HOST || !process.env.PG_DATABASE || !process.env.PG_USER) {
    throw new Error('Missing PG_HOST / PG_DATABASE / PG_USER env values');
  }

  const client = buildClient();
  await client.connect();

  console.log('\n=== INVENTORY SUMMARY ===');
  console.table(
    (
      await client.query(`
        SELECT
          COUNT(*) AS inventory_rows,
          COALESCE(SUM(available), 0) AS sum_available,
          COALESCE(SUM(reserved), 0) AS sum_reserved,
          COALESCE(SUM(total), 0) AS sum_total,
          COUNT(*) FILTER (WHERE available > 0) AS rows_available_gt_0,
          COUNT(*) FILTER (WHERE total > 0) AS rows_total_gt_0,
          COUNT(*) FILTER (WHERE available = 0 AND total = 0) AS zero_stock_rows
        FROM inventory;
      `)
    ).rows,
  );

  console.log('\n=== PRODUCT STOCK SUMMARY ===');
  console.table(
    (
      await client.query(`
        SELECT
          COUNT(*) AS product_rows,
          COALESCE(SUM(stock_quantity), 0) AS sum_product_stock,
          COUNT(*) FILTER (WHERE stock_quantity > 0) AS products_stock_gt_0,
          COUNT(*) FILTER (WHERE stock_quantity = 0) AS products_stock_zero
        FROM products
        WHERE is_active = true;
      `)
    ).rows,
  );

  console.log('\n=== SAMPLE INVENTORY ROWS ===');
  console.table(
    (
      await client.query(`
        SELECT
          tenant_id,
          jtl_product_id,
          jtl_warehouse_id,
          warehouse_name,
          available,
          reserved,
          total,
          reorder_point,
          synced_at
        FROM inventory
        ORDER BY synced_at DESC NULLS LAST
        LIMIT 20;
      `)
    ).rows,
  );

  await client.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});