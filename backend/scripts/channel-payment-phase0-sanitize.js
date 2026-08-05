const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function argument(name) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || '';
}

function maskedToken(prefix, value) {
  if (value === null || value === undefined || String(value).trim() === '') return '';
  return `${prefix}#${crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 12)}`;
}

function externalPattern(value) {
  if (!value) return '';
  return String(value)
    .slice(0, 64)
    .replace(/[A-Za-z]/g, 'A')
    .replace(/[0-9]/g, '9');
}

function csvValue(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const input = argument('input');
const output = argument('output');
if (!input || !output) {
  throw new Error('Usage: node channel-payment-phase0-sanitize.js --input=<raw.json> --output=<sanitized.csv>');
}

const reports = input.split(',').map((file) =>
  JSON.parse(fs.readFileSync(path.resolve(file.trim()), 'utf8')),
);
const columns = [
  'tenant', 'jtl_database', 'jtl_version', 'marketplace_sample_group',
  'jtl_internal_order_id', 'jtl_order_number', 'external_order_number_masked',
  'raw_platform', 'raw_payment', 'raw_shipping', 'shop_store_field',
  'marketplace_account_field', 'jtl_ui_channel', 'jtl_ui_payment',
  'postgres_channel', 'postgres_payment', 'expected_canonical_marketplace',
  'expected_canonical_payment', 'evidence_source', 'evidence_strength',
  'status', 'reviewer', 'reviewed_at_utc', 'notes',
];

const rows = reports.flatMap((report) => report.representativeSamples || []).map((sample) => {
  const conflicting = sample.candidate_sample_group === 'conflicting';
  const evidenceStrength = conflicting || sample.candidate_sample_group.includes('unresolved')
    ? 'insufficient'
    : 'candidate_only';
  return {
    tenant: sample.tenant_name,
    jtl_database: '',
    jtl_version: '',
    marketplace_sample_group: sample.candidate_sample_group,
    jtl_internal_order_id: maskedToken('jtl-id', sample.jtl_order_id),
    jtl_order_number: maskedToken('order', sample.order_number),
    external_order_number_masked: externalPattern(sample.external_order_number),
    raw_platform: sample.platform_raw,
    raw_payment: sample.payment_raw,
    raw_shipping: sample.shipping_raw,
    shop_store_field: '',
    marketplace_account_field: '',
    jtl_ui_channel: '',
    jtl_ui_payment: '',
    postgres_channel: sample.platform_raw,
    postgres_payment: sample.payment_raw,
    expected_canonical_marketplace: '',
    expected_canonical_payment: '',
    evidence_source: 'reporting_postgresql_read_only',
    evidence_strength: evidenceStrength,
    status: conflicting ? 'ambiguous' : 'unresolved',
    reviewer: '',
    reviewed_at_utc: '',
    notes: 'Candidate sample only; direct JTL SQL and JTL-Wawi confirmation required.',
  };
});

const csv = [
  columns.join(','),
  ...rows.map((row) => columns.map((column) => csvValue(row[column])).join(',')),
].join('\n');

fs.writeFileSync(path.resolve(output), `${csv}\n`);
