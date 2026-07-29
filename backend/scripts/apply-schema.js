const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const schemaDir = path.resolve(__dirname, '..', 'init-db');
const files = fs.readdirSync(schemaDir)
  .filter((name) => /^\d{2}-.*\.sql$/.test(name))
  .sort();

async function main() {
  if (process.env.SCHEMA_APPLY_CONFIRM !== 'yes') {
    throw new Error(
      'Schema application is disabled by default. Set SCHEMA_APPLY_CONFIRM=yes after reviewing the target database.',
    );
  }

  const client = new Client({
    host: process.env.PG_HOST,
    port: Number(process.env.PG_PORT || 5432),
    database: process.env.PG_DATABASE,
    user: process.env.PG_USER,
    password: process.env.PG_PASSWORD,
    ssl: process.env.PG_SSL === 'true'
      ? { rejectUnauthorized: process.env.PG_SSL_VERIFY !== 'false' }
      : false,
  });

  await client.connect();
  try {
    for (const file of files) {
      const sql = fs.readFileSync(path.join(schemaDir, file), 'utf8');
      await client.query(sql);
      process.stdout.write(`Applied ${file}\n`);
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
