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

  console.log('\n=== PRODUCTS COLUMNS ===');
  console.table(
    (
      await client.query(`
        SELECT
          column_name,
          data_type
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'products'
        ORDER BY ordinal_position;
      `)
    ).rows,
  );

  console.log('\n=== INVENTORY COLUMNS ===');
  console.table(
    (
      await client.query(`
        SELECT
          column_name,
          data_type
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'inventory'
        ORDER BY ordinal_position;
      `)
    ).rows,
  );

  await client.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});