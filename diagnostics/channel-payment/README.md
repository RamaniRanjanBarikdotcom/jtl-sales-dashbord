# Channel and Payment Phase 0 Diagnostics

These diagnostics collect evidence for separating JTL source platform, marketplace, marketplace account, payment method, and shipping method. They do not modify JTL or reporting data.

## JTL SQL Server

Run `jtl-phase0-readonly.sql` in SQL Server Management Studio against each representative JTL database. Save every result set and record the JTL version, tenant, execution date, and reviewer.

The script uses `READ UNCOMMITTED` and contains only metadata/data `SELECT` statements plus session-level `SET` statements.

Complete `representative-order-trace-template.csv` with at least 20 source orders per available marketplace and tenant. Mask external order numbers before committing evidence. A row is complete only when source SQL values, JTL-Wawi UI values, current PostgreSQL values, expected canonical values, evidence, and review status are recorded.

Allowed trace statuses:

- `verified_exact`
- `verified_mapping`
- `verified_external_pattern`
- `verified_platform`
- `verified_payment_fallback`
- `ambiguous`
- `unresolved`

## Reporting PostgreSQL

From `backend/`:

```bash
ENV_FILE=.env npm run --silent diagnostics:channel-payment > phase0-reporting.json
```

Limit the report to one tenant when required:

```bash
ENV_FILE=.env npm run --silent diagnostics:channel-payment -- --tenant=<TENANT_UUID> > phase0-reporting.json
```

The reporting script opens a `READ ONLY` transaction and rolls it back after collecting evidence.

Store raw output only under the ignored local results directory:

```bash
mkdir -p ../diagnostics/channel-payment/results
ENV_FILE=.env npm run --silent diagnostics:channel-payment -- --tenant=<TENANT_UUID> \
  > ../diagnostics/channel-payment/results/<tenant>-reporting.json
```

Generate a commit-safe trace CSV with hashed order references and shape-only external-number masks:

```bash
npm run --silent diagnostics:channel-payment:sanitize -- \
  --input=../diagnostics/channel-payment/results/<tenant>-reporting.json \
  --output=../diagnostics/channel-payment/representative-order-trace-template.csv
```

The sanitizer never marks a mapping verified. JTL database/version, source shop/account, JTL-Wawi display values, expected canonical values, reviewer, and review timestamp remain blank for manual completion.

For the My Company pilot, build the private working trace, deterministic lookup, and grouped JTL-Wawi review queue from the raw read-only report:

```bash
npm run --silent diagnostics:channel-payment:private-workspace -- \
  --input=../diagnostics/channel-payment/results-private/my-company/reporting-postgresql-readonly.json \
  --output-dir=../diagnostics/channel-payment/results-private/my-company
```

The command refuses output paths that are not under `results-private`, accepts only the My Company tenant, and creates owner-readable files. It emits both a pattern-level queue and a minimal queue grouped by platform, payment, and shipping. Pattern families are retained in the minimal row, while affected-order and revenue totals appear only once per source combination. These files contain actual order references and must never be committed or copied into tracked documentation.

## Safety

- Do not convert diagnostic observations into production mapping rules before representative JTL-Wawi orders are traced.
- Do not include database credentials or unmasked customer/order data in committed evidence.
- Do not run update, insert, delete, merge, truncate, or schema statements against JTL.
