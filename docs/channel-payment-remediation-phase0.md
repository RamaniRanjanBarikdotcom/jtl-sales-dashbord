# Sales Channel and Payment Separation — Phase 0 Evidence

Status: **Phase 0A complete; Phase 0B in progress; Phase 1 blocked**  
Reporting snapshot: **2026-08-05**  
Scope: repository audit, tenant-scoped read-only PostgreSQL diagnostics, and sanitized sample preparation  
Missing evidence: direct access to the two client JTL SQL Server databases and manual JTL-Wawi order confirmation

## Phase 0B Automated Run

| Diagnostic | My Company | jtl desktop 3 |
| --- | --- | --- |
| Tenant-scoped PostgreSQL report | Completed | Completed |
| PostgreSQL transaction mode | `transaction_read_only=on` | `transaction_read_only=on` |
| Reporting database/version | `jtl_dash_db`, PostgreSQL 15.18 | `jtl_dash_db`, PostgreSQL 15.18 |
| Direct JTL SQL connection | Unavailable | Unavailable |
| JTL account permission check | Blocked by unavailable connection | Blocked by unavailable connection |
| Sanitized representative CSV | Completed | Completed |

The My Company raw report and private review files are stored only under the gitignored `diagnostics/channel-payment/results-private/my-company/` directory. The jtl desktop 3 reporting artifact remains outside this pilot execution. The committed CSV contains stable hashes for internal/order numbers and shape-only masks for external order numbers; it contains no original order identifiers.

## My Company Pilot Continuation

The continuation request described a Windows Sync Engine host, but this execution environment identifies itself as macOS and contains neither the Windows Sync Engine settings/secrets nor a SQL Server command-line client. Therefore no direct JTL connection attempt using client credentials was possible, no credential was displayed, and no direct-JTL result is claimed.

### My Company verified

- The reporting diagnostic session ran with `transaction_read_only=on`.
- The JTL diagnostic SQL passed the forbidden-statement scanner and contains no write-capable statement.
- The private files are excluded by Git and use owner-only file permissions.
- All 160 private references reproduce the deterministic hashes in the tracked sanitized trace.

These are process/evidence verifications only; they are not marketplace or payment mapping verifications.

### My Company candidate

| Candidate group | Private samples | Human-confirmed |
| --- | ---: | ---: |
| Amazon | 20 | 0 |
| eBay | 20 | 0 |
| Otto | 20 | 0 |
| Kaufland | 20 | 0 |
| MediaMarktSaturn | 20 | 0 |
| Onlineshop/Direct | 20 | 0 |

The private evidence contains 70 pattern-level rows and a reduced queue of 48 unique platform/payment/shipping combinations. External-number pattern families are retained within each reduced row, so affected-order and revenue totals occur once per source combination rather than being repeated for every pattern. It includes common and unusual samples for the requested platform/payment families. Candidate labels are sampling aids only and are not active mappings.

### My Company ambiguous

- `jtl-wawi` with marketplace-like payment values and no external order number.
- `unicorn` with marketplace-like payment values without a dedicated marketplace/account source.
- `onlineshop` with `Amazon Pay`, where payment evidence must not become Amazon marketplace evidence.
- Marketplace-managed or marketplace-specific invoice labels that combine marketplace and payment semantics.

No strict cross-marketplace conflict appeared in the bounded reporting sample. This does not prove conflicts are absent from JTL.

### My Company unresolved

- 20 payment-only unresolved samples and 20 other unresolved samples remain queued.
- JTL database/server identity, SQL Server version, JTL version/build, platform/payment/shipping IDs, dedicated marketplace/shop/account fields, and connector-table relationships remain unavailable.
- Actual payment semantics for marketplace-managed values remain unresolved.
- All JTL-Wawi display and business-decision fields remain blank.

Private files created for authorized local review:

- `diagnostics/channel-payment/results-private/my-company/reporting-postgresql-readonly.json`
- `diagnostics/channel-payment/results-private/my-company/representative-order-trace-working.csv`
- `diagnostics/channel-payment/results-private/my-company/representative-order-private-lookup.csv`
- `diagnostics/channel-payment/results-private/my-company/jtl-wawi-review-queue.csv`
- `diagnostics/channel-payment/results-private/my-company/jtl-wawi-review-queue-minimal.csv`
- `diagnostics/channel-payment/results-private/my-company/sanitized-evidence-summary.json`
- `diagnostics/channel-payment/results-private/my-company/manual-fields-required.txt`
- `diagnostics/channel-payment/results-private/my-company/jtl-direct/connection-status.json`
- `diagnostics/channel-payment/results-private/my-company/manifest.json`

The tracked sanitized evidence remains `diagnostics/channel-payment/representative-order-trace-template.csv`. It was not replaced because the private lookup reproduces its deterministic My Company hashes.

## Project State

| Phase | Status | Decision |
| --- | --- | --- |
| Phase 0A — Diagnostic tooling and reporting | Complete | Repository and reporting evidence are repeatable and read-only |
| Phase 0B — Direct JTL evidence validation | In progress | Requires client-side JTL execution and manual order traces |
| Phase 1 — Additive raw-source schema | Blocked | Must not begin before the Phase 0B approval gate closes |

## Repository Confirmation

The current pipeline preserves three legacy reporting values but does not preserve the five required source dimensions.

| Source | Current path | Current reporting field | Finding |
| --- | --- | --- | --- |
| `dbo.tPlattform.cName` | Sync Engine `ChannelName` → order transformer | `orders.channel` | Used as both platform and channel |
| `dbo.tZahlungsart.cName` | Sync Engine `ZahlungsartName` → order transformer | `orders.payment_method` | Marketplace-like values are present |
| `dbo.tVersandart.cName` | Sync Engine `VersandartName` → order transformer | `orders.shipping_method` | Preserved independently |
| `cExterneAuftragsnummer` | Sync Engine payload → order transformer | `orders.external_order_number` | Available as diagnostic evidence |

Confirmed code locations:

- `sync-engine-dotnet/JtlSyncEngine/Services/MssqlService.cs` builds version-adaptive platform, payment, shipping, and external-order selections.
- `backend/src/ingest/transformers/orders.transformer.ts` writes platform to `channel`, payment to `payment_method`, and shipping to `shipping_method`.
- `backend/src/modules/analytics/analytics.service.ts` derives both platform and channel from `orders.channel`.
- The same analytics service currently treats any Amazon-like payment value as `Amazon Pay`, which is unsafe for values such as `Amazon Marktplatz`.
- `backend/init-db/16-comparison-analytics.sql` contains a single-field `channel_mappings` model and cannot express multi-field evidence, precedence, resolution versions, or rollback history.

## Direct JTL Diagnostics Executed

The direct JTL diagnostic has **not** been executed from this environment because neither client SQL Server endpoint/configuration is present on this workstation. Sync Engine SQL settings are Windows-host-local and secrets are protected with Windows DPAPI; no `sqlcmd` or `tsql` client is installed locally. The repository contains the required read-only script and trace template:

- `diagnostics/channel-payment/jtl-phase0-readonly.sql`
- `diagnostics/channel-payment/representative-order-trace-template.csv`

The script has passed an automated forbidden-statement scan and contains only `SELECT` plus session-level `SET` statements. It now returns effective `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `ALTER`, and `CONTROL` permission flags. On each client, proceed only when `can_select=1` and every write/control flag is `0`. Save all result sets locally with the completed trace template. No direct-JTL checkbox is marked complete until those artifacts are reviewed.

## JTL Database/Version Tested

| Tenant | JTL database | JTL version/build | Diagnostic date | Status |
| --- | --- | --- | --- | --- |
| My Company | Connection unavailable | Pending | 2026-08-05 attempt | Not executed |
| jtl desktop 3 | Connection unavailable | Pending | 2026-08-05 attempt | Not executed |

The SQL pack records database/server identity and discovers candidate version/build metadata objects without assuming one JTL version-table name.

## Repository-Visible JTL Schema Baseline

The repository confirms that the Sync Engine currently detects:

- `Verkauf.tAuftrag.kPlattform`
- `Verkauf.tAuftrag.kZahlungsart`
- `Verkauf.tAuftrag.kVersandArt`
- `Verkauf.tAuftrag.cExterneAuftragsnummer`
- `dbo.tPlattform`
- `dbo.tZahlungsart`
- `dbo.tVersandart`

Actual client JTL schema discovery is still pending. The read-only diagnostic pack is available at `diagnostics/channel-payment/jtl-phase0-readonly.sql`. It discovers optional marketplace, shop, account, connector, and source fields before any Sync Engine extraction is extended.

## Representative Orders Traced

| Tenant | Amazon | eBay | Otto | Kaufland | MediaMarktSaturn |
| --- | ---: | ---: | ---: | ---: | ---: |
| My Company | 20 candidate / 0 confirmed | 20 candidate / 0 confirmed | 20 candidate / 0 confirmed | 20 candidate / 0 confirmed | 20 candidate / 0 confirmed |
| jtl desktop 3 | No candidate data | 20 candidate / 0 confirmed | No candidate data | No candidate data | No candidate data |

Additional samples: My Company has 20 Onlineshop/Direct, 20 payment-only unresolved, and 20 other unresolved candidates. jtl desktop 3 has 20 Onlineshop/Direct, 3 payment-only unresolved, and 20 other unresolved candidates. No automatically detected cross-marketplace conflict met the strict classifier; known weak combinations remain ambiguous as listed below. Reporting samples are not direct JTL-Wawi traces. A trace counts only when source SQL values, JTL-Wawi channel/payment display, current reporting values, and a reviewer decision are recorded together.

## Reporting Schema Findings

The configured reporting database currently contains only these relevant order dimensions:

| Column | Present | Role |
| --- | --- | --- |
| `channel` | Yes | Legacy raw platform/channel |
| `payment_method` | Yes | Legacy raw payment value |
| `shipping_method` | Yes | Legacy raw shipping value |
| `external_order_number` | Yes | External source evidence |
| `source_platform_raw` | No | Required additive field |
| `source_payment_raw` | No | Required additive field |
| `source_shipping_raw` | No | Required additive field |
| `source_marketplace_raw` | No | Required additive field |
| `source_account_raw` | No | Required additive field |
| `source_shop_raw` | No | Required additive field |
| `sales_channel_name` | No | Future canonical field |
| `payment_method_canonical` | No | Future canonical field |
| `channel_resolution_status` | No | Future resolution metadata |

No schema changes were made during Phase 0.

## Tenant-Specific Behaviour

| Tenant | Active | Reporting orders | Current observation |
| --- | ---: | ---: | --- |
| My Company | Yes | 76,844 | Broad platforms and marketplace-like payments are heavily mixed |
| jtl desktop 3 | Yes | 7,481 | eBay platform values coexist with eBay managed-payment values |
| !004 | Yes | 73 | Only `onlineshop` observed; no marketplace-like payment evidence in this snapshot |
| Client Tenant mr101xt2-6108b0 | No | 0 | No reporting evidence available |

The reporting audit found 515 platform/payment/shipping combinations across the available tenants.

## Raw Value Combinations

High-impact combinations from the reporting snapshot:

| Tenant | Platform raw | Payment raw | Orders | Revenue | Reporting-only assessment |
| --- | --- | --- | ---: | ---: | --- |
| My Company | `amazon.de` | `Amazon Marktplatz` | 16,062 | €883,925.34 | Marketplace is likely Amazon; canonical payment is not proven |
| My Company | `weitere verkaufskanäle` | `Otto.de` | 5,149 | €390,712.65 | Payment value appears to carry marketplace evidence; JTL verification required |
| My Company | `weitere verkaufskanäle` | `MediaMarktSaturn` | 8,652 | €289,803.40 | Payment value appears to carry marketplace evidence; JTL verification required |
| My Company | `unicorn` | `Kaufland` | 6,657 | €218,417.60 | Connector/platform and payment combination may identify Kaufland; not yet verified |
| My Company | `weitere verkaufskanäle` | `Kaufland.de` | 5,603 | €202,531.88 | Payment value appears to carry marketplace evidence; JTL verification required |
| My Company | `unicorn` | `OTTO market` | 367 | €37,334.53 | Possible legacy Otto connector path; JTL verification required |
| My Company | `onlineshop` | `Amazon Pay` | 1,081 | €36,293.25 | Strong candidate for a genuine payment method, not an Amazon marketplace order |
| jtl desktop 3 | `ebay.de` | `eBay Managed Payments` | 3,158 | €241,609.11 | Marketplace is likely eBay; payment category requires approved canonical treatment |

Marketplace-like payment rows affect 44,314 orders and €2,167,789.41 for My Company, and 3,201 orders and €246,342.46 for jtl desktop 3. These totals describe contamination candidates, not automatically misclassified orders.

## Marketplace Evidence Matrix

| Platform raw | Payment raw | External pattern observed | Candidate marketplace | Evidence | Status |
| --- | --- | --- | --- | --- | --- |
| `amazon.de` and country variants | `Amazon Marktplatz` | Amazon-style three-part numeric identifiers appear in samples | Amazon with country/account dimension | Precise platform plus external pattern | **Pending JTL trace** |
| `weitere verkaufskanäle` | `Otto.de` | Distinct alphanumeric identifiers appear in samples | Otto | Repeated platform/payment combination plus external pattern | **Pending JTL trace** |
| `weitere verkaufskanäle` | `Kaufland.de` | Distinct short alphanumeric identifiers appear in samples | Kaufland | Repeated platform/payment combination plus external pattern | **Pending JTL trace** |
| `weitere verkaufskanäle` | `MediaMarktSaturn` | Stable numeric/underscore family appears in samples | MediaMarktSaturn | Repeated platform/payment combination plus external pattern | **Pending JTL trace** |
| `unicorn` | `Kaufland` | Samples available | Kaufland | Connector plus marketplace-like payment evidence | **Pending connector/JTL trace** |
| `unicorn` | `OTTO market` | Samples available | Otto | Connector plus marketplace-like payment evidence | **Pending connector/JTL trace** |
| `ebay.*` | `eBay Managed Payments` | Samples available | eBay with country/account dimension | Precise platform | **Pending JTL trace** |
| `jtl-wawi` | marketplace-like values | Mixed | Unknown | Conflicting/weak platform evidence | **Ambiguous** |

External identifiers are deliberately not copied into this document. The temporary diagnostic output contains samples for authorized local review only.

## External-Order Pattern Findings

Sanitized reporting samples show these shape-only identifier families:

| Candidate group | Tenant | Shape evidence in sample |
| --- | --- | --- |
| Amazon | My Company | `999-9999999-9999999` in 20/20 samples |
| eBay | My Company | `99-99999-99999` in 20/20 samples |
| eBay | jtl desktop 3 | `99-99999-99999` in 20/20 samples |
| MediaMarktSaturn | My Company | `99999_999999999-A` in 20/20 samples |
| Otto | My Company | Ten-character mixed alphanumeric family; multiple shapes |
| Kaufland | My Company | Seven-character mixed alphanumeric family; multiple shapes |
| Onlineshop/Direct | Both | Five-digit family in 20/20 samples per tenant |

This is useful evidence for selecting trace samples, but no external-order rule is verified because:

- only reporting values were inspected;
- the source JTL fields and connector records were not compared;
- pattern stability across historical periods was not measured;
- false-positive and conflicting combinations were not assessed.

External identifiers must remain masked in committed evidence. Approved rules require representative direct-JTL traces and tenant-specific collision testing.

## Dedicated Shop/Account Field Findings

No dedicated shop, marketplace, or marketplace-account field is currently stored in reporting PostgreSQL or emitted by the existing Sync Engine order model. Whether such fields exist in the client JTL versions is pending direct schema discovery.

The expanded JTL SQL pack lists candidate source objects and their relevant columns. No new Sync Engine join should be designed until those result sets are reviewed.

Repository-known candidate keys are `Verkauf.tAuftrag.kPlattform`, `kZahlungsart`, `kVersandArt`, and `cExterneAuftragsnummer`, joined to `dbo.tPlattform`, `dbo.tZahlungsart`, and `dbo.tVersandart`. Candidate marketplace/shop/account objects are discovered by metadata name and column scans in the JTL SQL pack. No dedicated account/shop field has been found or verified because direct JTL metadata results remain unavailable.

## Payment Evidence Matrix

| Raw payment | Safe current conclusion | Candidate canonical payment | Status |
| --- | --- | --- | --- |
| `Amazon Pay` | This is a known payment label, including on `onlineshop` orders | Amazon Pay | Candidate; exact-label rule still requires approval |
| `Amazon Marktplatz` | Must not be converted to Amazon Pay merely because it contains “Amazon” | Marketplace Managed, Unknown, or separate real source | Unresolved |
| `Otto.de` / `OTTO market` | Likely marketplace identity in some combinations | Marketplace Managed or Unknown | Unresolved pending trace |
| `Kaufland` / `Kaufland.de` | Likely marketplace identity in some combinations | Marketplace Managed or Unknown | Unresolved pending trace |
| `MediaMarktSaturn` | Likely marketplace identity in some combinations | Marketplace Managed or Unknown | Unresolved pending trace |
| `eBay Managed Payments` | Marketplace-managed settlement/payment label | Marketplace Managed or approved eBay category | Pending business approval |
| `eBay Rechnungskauf` | Contains a real invoice concept but is marketplace-specific | Invoice or approved marketplace-specific category | Pending business approval |

No canonical payment rule is approved by this report.

## Canonical Payment Decisions

| Raw value | Current decision | Phase 0B requirement |
| --- | --- | --- |
| `PayPal` | Pending approval as `PayPal` | Confirm representative JTL UI/source rows |
| `Überweisung` | Pending approval as `Bank Transfer` | Confirm naming variants and business category |
| `Rechnung` | Pending approval as `Invoice` | Confirm marketplace-specific invoice variants |
| `Amazon Pay` | Pending approval as `Amazon Pay` | Require exact-label handling, never `%amazon%` |
| `Amazon Marktplatz` | Unresolved | Determine whether a separate real payment source exists |
| `Otto.de` / `OTTO market` | Unresolved | Verify marketplace evidence and actual payment availability |
| `Kaufland` / `Kaufland.de` | Unresolved | Verify connector/source behaviour |
| `MediaMarktSaturn` | Unresolved | Verify connector/source behaviour |
| `eBay Managed Payments` | Unresolved | Business decision between Marketplace Managed and dedicated category |

Allowed final decisions are: actual canonical payment, `Marketplace Managed`, `Unknown`, or `Unresolved`. No suggested decision is active until approved.

## Unresolved Cases

- Whether a dedicated marketplace/account source exists in each supported JTL version.
- Whether connector-specific tables provide stronger evidence than payment labels.
- The real underlying payment method for Amazon Marktplatz, Otto, Kaufland, and MediaMarktSaturn orders.
- Country/account boundaries for Amazon and eBay platform variants.
- How marketplace-managed settlements should appear in the business Payment Methods widget.
- Whether all observed external-order patterns remain stable across historical periods and tenants.

## Ambiguous Cases

- `jtl-wawi` combined with Amazon, Kaufland, MediaMarktSaturn, Otto, or eBay-like payment values.
- `unicorn` combined with different marketplace-like values without a dedicated marketplace/account field.
- Marketplace-specific invoice or managed-payment values that contain both marketplace and payment evidence.
- Broad platforms combined with empty or ordinary payment values where only external-order patterns may identify the marketplace.

These rows must remain in explicit unresolved/ambiguous buckets until stronger evidence exists.

Observed ambiguous reporting combinations include:

- My Company: `jtl-wawi` with `MediaMarktSaturn`, `Amazon Marktplatz`, `Kaufland`, `Kaufland.de`, `OTTO market`, or `Amazon Pay`, especially when the external order number is blank.
- My Company: `unicorn` with marketplace-like payment labels; the connector name is not a marketplace identity.
- My Company: `onlineshop` with `Amazon Pay`; this is payment evidence and must not classify the sales channel as Amazon.
- jtl desktop 3: `jtl-wawi` with `eBay Managed Payments` and no external order number.

No sample is promoted from ambiguous/unresolved based on payment text alone.

## Manual CSV Completion

The automated run populated tenant, candidate group, masked identifiers, reporting platform/payment/shipping, current PostgreSQL channel/payment, evidence source/strength, and unresolved status. These columns intentionally remain blank until a human verifies the order in JTL SQL and JTL-Wawi:

- `jtl_database`
- `jtl_version`
- `shop_store_field`
- `marketplace_account_field`
- `jtl_ui_channel`
- `jtl_ui_payment`
- `expected_canonical_marketplace`
- `expected_canonical_payment`
- `reviewer`
- `reviewed_at_utc`

The masked `jtl_internal_order_id`, `jtl_order_number`, and `external_order_number_masked` values may be matched to the raw gitignored report only on an authorized workstation. They are not production mapping evidence.

## Verified Mappings

There are currently **zero verified production mappings**. The reporting combinations are sampling candidates only. A mapping can be added here only after the required direct-JTL samples support one of these statuses:

- `verified_exact`
- `verified_mapping`
- `verified_external_pattern`
- `verified_platform`
- `verified_payment_fallback`

Conflicting evidence must be recorded as `ambiguous`; missing evidence remains `unresolved`.

## Recommended Candidate Rules

The following are candidates for testing, not production rules:

1. Exact dedicated marketplace/account identifiers, if discovered, have highest priority.
2. Exact tenant-approved multi-field combinations may classify broad platforms only after representative order traces.
3. Verified external-order patterns may classify marketplace when stronger dedicated fields are absent.
4. Precise platform values such as `amazon.de` or `ebay.de` may classify marketplace and account separately.
5. Marketplace-like payment values may provide channel evidence only for explicitly approved tenant combinations.
6. Exact `Amazon Pay` may classify payment; broad `%amazon%` matching must not.
7. Missing or conflicting evidence resolves to `Unresolved` or `Ambiguous`, never a guessed marketplace/payment.

## Data Prerequisites

Before Phase 1 approval, collect:

- JTL version for each representative database.
- Output from `diagnostics/channel-payment/jtl-phase0-readonly.sql`.
- At least 20 manually traced orders each for Amazon, eBay, Otto, Kaufland, and MediaMarktSaturn where available.
- Connector-table evidence for Unicorn and Weitere Verkaufskanäle.
- Approved canonical payment category definitions from the business owner.
- Approved handling for marketplace-managed settlement values.
- Confirmation of marketplace account/country grouping requirements.

## Implementation Approval Checklist

- [x] Current repository pipeline confirmed.
- [x] Reporting PostgreSQL schema inspected read-only.
- [x] Reporting platform/payment/shipping combinations exported.
- [x] Marketplace-like reporting payment values quantified.
- [x] External-order samples collected locally for authorized review.
- [ ] JTL candidate source columns identified on representative client databases.
- [ ] Candidate JTL source tables inspected.
- [ ] Amazon sample orders traced against JTL-Wawi.
- [ ] eBay sample orders traced against JTL-Wawi.
- [ ] Otto sample orders traced against JTL-Wawi.
- [ ] Kaufland sample orders traced against JTL-Wawi.
- [ ] MediaMarktSaturn sample orders traced against JTL-Wawi.
- [ ] External-order patterns validated across history.
- [ ] Tenant-specific evidence matrix approved.
- [ ] Canonical payment categories approved.
- [x] No JTL write operations introduced.

## Phase 1 Approval Decision

Phase 0A is complete. Phase 0B is **not complete** because direct JTL schema evidence and manual order traces are unavailable in this environment. The reporting data strongly confirms the problem and identifies the highest-impact combinations, but it does not safely prove canonical marketplace or payment mappings.

Phase 1 is **not approved**. Do not begin schema migration, resolver implementation, historical backfill, or production UI remapping until the remaining approval checklist items are completed, mapping/payment decisions are signed off, and reconciliation expectations are approved.

## Undeployed Phase 1 Safety Scaffold

After Phase 0B, the repository received an additive, undeployed implementation scaffold so the approved rollout can be performed without redesigning production code. This does not change the approval decision above and has not been applied to any database.

Implemented in source:

- Additive raw-evidence and canonical order columns in `19-channel-payment-canonical.sql`.
- Tenant-scoped, exact multi-field rules with candidate/verified/rejected evidence states.
- Separate channel and payment shadow/activation gates; both activation gates default to disabled.
- A resolver that accepts only enabled verified rules from the selected tenant, evaluates only the winning priority tier, and returns ambiguous for equal-priority conflicting outputs.
- Tenant-scoped preview and coverage/reconciliation APIs that can evaluate inactive candidate rules without modifying orders.
- Explicit rule-decision and activation APIs requiring fixed confirmation phrases, tenant permissions, verified evidence, and audit records.
- Bounded, resumable backfill code requiring an exact confirmation phrase, an active feature gate, and verified rules; checkpoints, pre-change snapshots, rollback, rule-version reprocessing, and every run are recorded and audited.
- Future ingestion preservation of platform, payment, shipping, marketplace, account, shop, and external-order raw evidence.
- Shared canonical Sales, Products, Analytics, and Compare reads: disabled features retain legacy values, while enabled features expose resolved values or explicit `Ambiguous`/`Unresolved` buckets. Screen and export projections use the same logic.
- Canonical cache namespaces include each tenant's independent channel/payment activation mode and resolution version.
- Exact `Amazon Pay` handling; broad `%amazon%` payment classification was removed.

Still intentionally blocked:

- Applying `19-channel-payment-canonical.sql` to PostgreSQL.
- Promoting any My Company candidate rule to verified/enabled.
- Enabling canonical marketplace for My Company.
- Running a historical backfill.
- Enabling canonical payment.
- Enabling rules for any other tenant.

Those actions require the direct JTL-Wawi confirmations and business approvals listed above. Remote Sync Engine metadata diagnostics remain a later task.
