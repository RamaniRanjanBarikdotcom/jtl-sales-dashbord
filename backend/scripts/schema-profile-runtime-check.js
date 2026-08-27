'use strict';

const bcrypt = require('bcrypt');
const { Client } = require('pg');

const tenantId = '10000000-0000-4000-8000-000000000001';
const apiKey = 'schema-profile-runtime-key';
const baseUrl = process.env.API_BASE_URL || 'http://127.0.0.1:3101/api';
const profile = process.env.SCHEMA_PROFILE || 'unknown';
const runtimeOrderId = 990001;

async function waitForApi() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/healthz`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('API did not become ready');
}

async function main() {
  const client = new Client({
    host: process.env.PG_HOST,
    port: Number(process.env.PG_PORT || 5432),
    database: process.env.PG_DATABASE,
    user: process.env.PG_USER,
    password: process.env.PG_PASSWORD,
  });
  await client.connect();
  const hash = await bcrypt.hash(apiKey, 4);
  await client.query(
    `INSERT INTO tenants (id, name, slug, is_active)
     VALUES ($1::uuid, 'Schema Profile Runtime', 'schema-profile-runtime', true)
     ON CONFLICT (id) DO UPDATE SET is_active = true`,
    [tenantId],
  );
  await client.query(
    `INSERT INTO tenant_connections (tenant_id, sync_api_key_hash, sync_api_key_prefix, is_active)
     VALUES ($1::uuid, $2, 'schema-pro', true)
     ON CONFLICT (tenant_id) DO UPDATE SET sync_api_key_hash = EXCLUDED.sync_api_key_hash, is_active = true`,
    [tenantId, hash],
  );

  await waitForApi();
  const health = await fetch(`${baseUrl}/healthz`);
  if (!health.ok) throw new Error(`Health endpoint returned ${health.status}`);

  const ingest = await fetch(`${baseUrl}/sync/ingest`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
      'x-api-version': '1',
      'x-tenant-id': tenantId,
    },
    body: JSON.stringify({
      tenantId,
      module: 'orders',
      syncMode: 'incremental',
      batchIndex: 0,
      totalBatches: 1,
      isLastBatch: true,
      rows: [{
        kAuftrag: runtimeOrderId,
        cAuftragsNr: `SCHEMA-${profile}`,
        dErstellt: '2026-01-15T12:00:00.000Z',
        fGesamtsumme: 19.99,
        fGesamtsummeNetto: 16.80,
        channelName: 'Runtime Source Platform',
        zahlungsartName: 'Runtime Payment',
        versandartName: 'Runtime Shipping',
      }],
    }),
  });
  if (ingest.status !== 202) {
    throw new Error(`Ingest endpoint returned ${ingest.status}: ${await ingest.text()}`);
  }
  const payload = await ingest.json();
  if (payload?.data?.accepted !== true && payload?.accepted !== true) {
    throw new Error('Ingest endpoint did not accept the runtime batch');
  }

  let order;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const result = await client.query(
      'SELECT channel FROM orders WHERE tenant_id = $1::uuid AND jtl_order_id = $2',
      [tenantId, runtimeOrderId],
    );
    order = result.rows[0];
    if (order) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!order || order.channel !== 'runtime source platform') {
    throw new Error(`${profile} runtime order ingest did not persist through the live API`);
  }

  const canonicalProfile = profile !== 'legacy';
  const columnResult = await client.query(
    `SELECT COUNT(*)::int AS count
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'orders'
        AND column_name IN ('source_platform_raw', 'channel_resolution_status')`,
  );
  if ((Number(columnResult.rows[0]?.count) === 2) !== canonicalProfile) {
    throw new Error(`${profile} runtime schema capability did not match its expected order columns`);
  }
  if (canonicalProfile) {
    const canonicalResult = await client.query(
      `SELECT source_platform_raw, channel_resolution_status
         FROM orders WHERE tenant_id = $1::uuid AND jtl_order_id = $2`,
      [tenantId, runtimeOrderId],
    );
    const canonicalOrder = canonicalResult.rows[0];
    if (canonicalOrder?.source_platform_raw !== 'Runtime Source Platform') {
      throw new Error(`${profile} canonical ingest did not preserve raw source platform evidence`);
    }
    if (canonicalOrder?.channel_resolution_status !== 'unresolved') {
      throw new Error(`${profile} canonical ingest did not retain the explicit unresolved state`);
    }
  }

  await client.end();
  process.stdout.write(`${profile} API and order-ingest runtime verified\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
