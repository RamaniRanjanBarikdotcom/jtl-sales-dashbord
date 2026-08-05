const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function argument(name) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || '';
}

function hashReference(prefix, value) {
  if (value === null || value === undefined || String(value).trim() === '') return '';
  return `${prefix}#${crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 12)}`;
}

function externalPattern(value) {
  if (!value) return '';
  return String(value).slice(0, 64).replace(/[A-Za-z]/g, 'A').replace(/[0-9]/g, '9');
}

function csvValue(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function writeCsv(filePath, columns, rows) {
  const content = [
    columns.join(','),
    ...rows.map((row) => columns.map((column) => csvValue(row[column])).join(',')),
  ].join('\n');
  fs.writeFileSync(filePath, `${content}\n`, { mode: 0o600 });
}

function candidateMarketplace(group) {
  return ['Amazon', 'eBay', 'Otto', 'Kaufland', 'MediaMarktSaturn', 'Onlineshop/Direct'].includes(group)
    ? group
    : '';
}

function candidatePayment(rawPayment) {
  const normalized = String(rawPayment || '').trim().toLowerCase();
  if (normalized === 'paypal') return 'Candidate only: PayPal';
  if (normalized === 'überweisung' || normalized === 'ueberweisung') return 'Candidate only: Bank Transfer';
  if (normalized === 'amazon pay') return 'Candidate only: Amazon Pay';
  return 'Unresolved';
}

function reviewPriority(platform, payment, group) {
  const combination = `${platform} ${payment}`.toLowerCase();
  if (
    (combination.includes('amazon.de') && combination.includes('amazon marktplatz')) ||
    (combination.includes('ebay.de') && (combination.includes('unknown') || combination.includes('managed payments'))) ||
    (combination.includes('weitere verkaufskanäle') && /(otto|kaufland|mediamarkt|saturn)/.test(combination)) ||
    (combination.includes('onlineshop') && /(paypal|überweisung|amazon pay)/.test(combination)) ||
    (combination.includes('jtl-wawi') && /(amazon|ebay|otto|kaufland|mediamarkt|saturn)/.test(combination)) ||
    (combination.includes('unicorn') && /(amazon|ebay|otto|kaufland|mediamarkt|saturn)/.test(combination)) ||
    group === 'conflicting' || group === 'payment-only-unresolved'
  ) return 'P0';
  if (candidateMarketplace(group)) return 'P1';
  return 'P2';
}

const input = argument('input');
const outputDirectory = path.resolve(argument('output-dir'));
if (!input || !outputDirectory) {
  throw new Error('Usage: node channel-payment-phase0-private-workspace.js --input=<raw.json> --output-dir=<results-private/my-company>');
}
if (!outputDirectory.split(path.sep).includes('results-private')) {
  throw new Error('Refusing to write private evidence outside a results-private directory.');
}

const report = JSON.parse(fs.readFileSync(path.resolve(input), 'utf8'));
const tenant = report.tenants?.[0];
if (!tenant || tenant.name !== 'My Company') {
  throw new Error('The private pilot workspace accepts the My Company tenant only.');
}

fs.mkdirSync(outputDirectory, { recursive: true, mode: 0o700 });
const samples = report.representativeSamples || [];
const workingRows = samples.map((sample) => ({
  sanitized_internal_reference: hashReference('jtl-id', sample.jtl_order_id),
  sanitized_order_reference: hashReference('order', sample.order_number),
  jtl_internal_order_id: sample.jtl_order_id,
  jtl_order_number: sample.order_number,
  actual_external_order_number: sample.external_order_number,
  external_order_pattern: externalPattern(sample.external_order_number),
  reporting_order_identifier: sample.jtl_order_id,
  tenant: sample.tenant_name,
  jtl_database: '',
  jtl_version: '',
  marketplace_sample_group: sample.candidate_sample_group,
  raw_platform: sample.platform_raw,
  platform_id: '',
  raw_payment: sample.payment_raw,
  payment_id: '',
  raw_shipping: sample.shipping_raw,
  shipping_id: '',
  shop_store_candidate: '',
  marketplace_candidate: candidateMarketplace(sample.candidate_sample_group),
  account_candidate: '',
  current_reporting_channel: sample.platform_raw,
  current_reporting_payment: sample.payment_raw,
  jtl_ui_channel: '',
  jtl_ui_payment: '',
  jtl_ui_shipping: '',
  expected_canonical_marketplace: '',
  expected_canonical_payment: '',
  reviewer: '',
  reviewed_at_utc: '',
  human_verification_notes: '',
  status: sample.candidate_sample_group === 'conflicting' ? 'ambiguous' : 'unresolved',
}));

const workingColumns = Object.keys(workingRows[0] || {
  sanitized_internal_reference: '', sanitized_order_reference: '',
});
writeCsv(path.join(outputDirectory, 'representative-order-trace-working.csv'), workingColumns, workingRows);

const lookupColumns = [
  'sanitized_internal_reference', 'sanitized_order_reference',
  'actual_jtl_internal_order_id', 'actual_jtl_order_number',
  'actual_external_order_number', 'reporting_order_identifier',
];
const lookupRows = samples.map((sample) => ({
  sanitized_internal_reference: hashReference('jtl-id', sample.jtl_order_id),
  sanitized_order_reference: hashReference('order', sample.order_number),
  actual_jtl_internal_order_id: sample.jtl_order_id,
  actual_jtl_order_number: sample.order_number,
  actual_external_order_number: sample.external_order_number,
  reporting_order_identifier: sample.jtl_order_id,
}));
writeCsv(path.join(outputDirectory, 'representative-order-private-lookup.csv'), lookupColumns, lookupRows);

const totals = new Map((report.combinations || []).map((combination) => [
  [combination.platform_raw, combination.payment_raw, combination.shipping_raw].join('\u0000'),
  combination,
]));
const grouped = new Map();
for (const sample of samples) {
  const pattern = externalPattern(sample.external_order_number) || '(blank)';
  const key = [sample.candidate_sample_group, sample.platform_raw, sample.payment_raw, sample.shipping_raw, pattern].join('\u0000');
  const current = grouped.get(key) || {
    candidate_group: sample.candidate_sample_group,
    raw_platform: sample.platform_raw,
    raw_payment: sample.payment_raw,
    raw_shipping: sample.shipping_raw,
    external_order_pattern: pattern,
    sampled_orders: 0,
  };
  current.sampled_orders += 1;
  grouped.set(key, current);
}

const queueRows = [...grouped.values()].map((row) => {
  const total = totals.get([row.raw_platform, row.raw_payment, row.raw_shipping].join('\u0000'));
  return {
    ...row,
    total_affected_reporting_orders: total?.orders ?? '',
    affected_revenue: total?.revenue ?? '',
    candidate_marketplace: candidateMarketplace(row.candidate_group),
    candidate_canonical_payment: candidatePayment(row.raw_payment),
    evidence_available: 'Reporting PostgreSQL fields plus masked external-order shape; direct JTL metadata unavailable.',
    jtl_wawi_manual_fields: 'Channel; payment; shipping; marketplace/account/store; canonical marketplace; canonical payment',
    status: row.candidate_group === 'conflicting' ? 'ambiguous' : 'unresolved',
  };
});
const queueColumns = Object.keys(queueRows[0] || { candidate_group: '' });
writeCsv(path.join(outputDirectory, 'jtl-wawi-review-queue.csv'), queueColumns, queueRows);

const minimalGroups = new Map();
for (const row of queueRows) {
  const key = [row.candidate_group, row.raw_platform, row.raw_payment, row.raw_shipping].join('\u0000');
  const current = minimalGroups.get(key) || {
    priority: reviewPriority(row.raw_platform, row.raw_payment, row.candidate_group),
    candidate_group: row.candidate_group,
    raw_platform: row.raw_platform,
    raw_payment: row.raw_payment,
    raw_shipping: row.raw_shipping,
    external_order_patterns: new Set(),
    sampled_orders: 0,
    total_affected_reporting_orders: row.total_affected_reporting_orders,
    affected_revenue: row.affected_revenue,
    candidate_marketplace: row.candidate_marketplace,
    candidate_canonical_payment: row.candidate_canonical_payment,
    evidence_available: row.evidence_available,
    jtl_wawi_manual_fields: row.jtl_wawi_manual_fields,
    status: row.status,
  };
  current.external_order_patterns.add(row.external_order_pattern);
  current.sampled_orders += Number(row.sampled_orders || 0);
  minimalGroups.set(key, current);
}

const priorityOrder = { P0: 0, P1: 1, P2: 2 };
const minimalQueueRows = [...minimalGroups.values()]
  .map((row) => ({
    ...row,
    external_order_patterns: [...row.external_order_patterns].sort().join(' | '),
  }))
  .sort((left, right) =>
    priorityOrder[left.priority] - priorityOrder[right.priority] ||
    left.raw_platform.localeCompare(right.raw_platform) ||
    left.raw_payment.localeCompare(right.raw_payment) ||
    left.raw_shipping.localeCompare(right.raw_shipping),
  );
const minimalQueueColumns = Object.keys(minimalQueueRows[0] || { priority: '' });
writeCsv(
  path.join(outputDirectory, 'jtl-wawi-review-queue-minimal.csv'),
  minimalQueueColumns,
  minimalQueueRows,
);

const sampleCounts = workingRows.reduce((counts, row) => {
  counts[row.marketplace_sample_group] = (counts[row.marketplace_sample_group] || 0) + 1;
  return counts;
}, {});
const sanitizedSummary = {
  generatedAt: new Date().toISOString(),
  tenant: tenant.name,
  directJtlConnection: 'unavailable_in_current_environment',
  directJtlRowsMatched: 0,
  reportingSamplesLinked: workingRows.length,
  patternLevelReviewRows: queueRows.length,
  minimalReviewRows: minimalQueueRows.length,
  sampleCounts,
  verifiedMappings: 0,
  phase1: 'blocked',
};
fs.writeFileSync(
  path.join(outputDirectory, 'sanitized-evidence-summary.json'),
  `${JSON.stringify(sanitizedSummary, null, 2)}\n`,
  { mode: 0o600 },
);

const manualFields = [
  'jtl_ui_channel',
  'jtl_ui_payment',
  'jtl_ui_shipping',
  'expected_canonical_marketplace',
  'expected_canonical_payment',
  'reviewer',
  'reviewed_at_utc',
  'human_verification_notes',
];
fs.writeFileSync(
  path.join(outputDirectory, 'manual-fields-required.txt'),
  `${manualFields.join('\n')}\n`,
  { mode: 0o600 },
);

const manifest = {
  generatedAt: new Date().toISOString(),
  tenant: tenant.name,
  source: 'tenant-scoped reporting PostgreSQL read-only diagnostic',
  directJtlExecuted: false,
  samples: workingRows.length,
  patternLevelReviewRows: queueRows.length,
  minimalReviewRows: minimalQueueRows.length,
  files: [
    'representative-order-trace-working.csv',
    'representative-order-private-lookup.csv',
    'jtl-wawi-review-queue.csv',
    'jtl-wawi-review-queue-minimal.csv',
    'sanitized-evidence-summary.json',
    'manual-fields-required.txt',
  ],
  warning: 'Private reporting evidence only. Direct JTL SQL and JTL-Wawi confirmation remain required.',
};
fs.writeFileSync(
  path.join(outputDirectory, 'manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
  { mode: 0o600 },
);

process.stdout.write(`${JSON.stringify({
  samples: workingRows.length,
  patternLevelReviewRows: queueRows.length,
  minimalReviewRows: minimalQueueRows.length,
})}\n`);
