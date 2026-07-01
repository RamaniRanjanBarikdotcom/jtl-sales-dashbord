const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;

  const content = fs.readFileSync(filePath, 'utf8');

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const index = trimmed.indexOf('=');
    if (index === -1) continue;

    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!process.env[key]) process.env[key] = value;
  }
}

function bool(value) {
  return String(value || '').toLowerCase() === 'true';
}

async function main() {
  loadEnvFile(path.resolve(process.cwd(), process.env.ENV_FILE || '.env'));

  const client = new Client({
    host: process.env.PG_HOST,
    port: Number(process.env.PG_PORT || 5432),
    database: process.env.PG_DATABASE,
    user: process.env.PG_USER,
    password: process.env.PG_PASSWORD,
    ssl: bool(process.env.PG_SSL)
      ? { rejectUnauthorized: bool(process.env.PG_SSL_VERIFY) }
      : undefined,
  });

  await client.connect();

  console.log('\n=== BEFORE FIX ===');
  console.table(
    (
      await client.query(`
        SELECT
          SUM(stock_quantity) AS sum_product_stock,
          COUNT(*) FILTER (WHERE stock_quantity > 0) AS products_with_stock
        FROM products
        WHERE is_active = true;
      `)
    ).rows,
  );

  const result = await client.query(`
    UPDATE products p
    SET stock_quantity = sub.display_stock,
        updated_at = now()
    FROM (
      SELECT
        tenant_id,
        jtl_product_id,
        CASE
          WHEN COALESCE(SUM(total), 0) > 0 THEN COALESCE(SUM(total), 0)
          ELSE COALESCE(SUM(available), 0)
        END AS display_stock
      FROM inventory
      GROUP BY tenant_id, jtl_product_id
    ) sub
    WHERE p.tenant_id = sub.tenant_id
      AND p.jtl_product_id = sub.jtl_product_id
      AND p.stock_quantity IS DISTINCT FROM sub.display_stock;
  `);

  console.log(`\nUpdated product rows: ${result.rowCount}`);

  console.log('\n=== AFTER FIX ===');
  console.table(
    (
      await client.query(`
        SELECT
          SUM(stock_quantity) AS sum_product_stock,
          COUNT(*) FILTER (WHERE stock_quantity > 0) AS products_with_stock
        FROM products
        WHERE is_active = true;
      `)
    ).rows,
  );

  console.log('\n=== JIS CHECK AFTER FIX ===');
  console.table(
    (
      await client.query(`
        SELECT
          p.tenant_id,
          p.article_number,
          p.jtl_product_id,
          p.name,
          i.available,
          i.reserved,
          i.total,
          p.stock_quantity,
          CASE
            WHEN COALESCE(i.total, 0) > 0 THEN i.total
            ELSE COALESCE(i.available, 0)
          END AS expected_dashboard_stock
        FROM products p
        LEFT JOIN inventory i
          ON i.tenant_id = p.tenant_id
         AND i.jtl_product_id = p.jtl_product_id
        WHERE p.article_number IN ('JIS-001','JIS-002','JIS-003','JIS-004','JIS-006','JIS-007')
        ORDER BY p.tenant_id, p.article_number;
      `)
    ).rows,
  );

  await client.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});