'use strict';

const { Client } = require('pg');

const profile = process.env.SCHEMA_PROFILE || 'legacy';
const expected = {
  legacy: { canonical: false, marketplace20: false, marketplace21: false },
  canonical: { canonical: true, marketplace20: false, marketplace21: false },
  'marketplace-disabled': { canonical: true, marketplace20: true, marketplace21: false },
  'marketplace-enabled': { canonical: true, marketplace20: true, marketplace21: true },
}[profile];

if (!expected) throw new Error(`Unknown SCHEMA_PROFILE: ${profile}`);

async function main() {
  const client = new Client({
    host: process.env.PG_HOST,
    port: Number(process.env.PG_PORT || 5432),
    database: process.env.PG_DATABASE,
    user: process.env.PG_USER,
    password: process.env.PG_PASSWORD,
  });
  await client.connect();
  const { rows } = await client.query(`SELECT
    to_regclass('public.tenant_channel_payment_settings') IS NOT NULL AS canonical,
    to_regclass('public.marketplace_accounts') IS NOT NULL AS marketplace20,
    to_regclass('public.marketplace_feedback_sources') IS NOT NULL AS marketplace21`);
  await client.end();
  for (const [key, value] of Object.entries(expected)) {
    if (rows[0][key] !== value) {
      throw new Error(`${profile}: expected ${key}=${value}, got ${rows[0][key]}`);
    }
  }
  process.stdout.write(`${profile} schema profile verified\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
