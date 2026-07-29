# Implementation Status

## Baseline

- Baseline commit: `f779db1`.
- The working tree was clean before implementation.
- Architecture: NestJS/PostgreSQL/Redis backend, Next.js frontend, Docker, and a WPF sync engine.
- Safety constraints preserved: no production deployment, no production data changes, no service installation, and no JTL SQL writes.

## Completed requirements

- Phase 0: repository baseline, dependency map, generated-file review, and safety audit.
- Phase 1: canonical total-stock calculation, tenant-safe inventory joins, final-batch product reconciliation, zero-stock protection, regression fixtures, and stock-mismatch diagnostics.
- Phase 2: versioned tenant cache keys, targeted invalidation, strict ingest validation, single body parser, secure public health, authenticated diagnostics, build identity, production secret checks, CORS/Swagger controls, and database pool timeouts.
- Phase 3: tenant/JTL integrity SQL, tenant-first indexes, clean-database schema validation, and an explicit guarded schema runner.
- Phase 4: shared non-UI Core project, Windows Worker Service, global scheduler ownership, dependency retries, read-only SQL intent, graceful shutdown, and safe service scheduling.
- Phase 5: WPF service-managed mode, versioned named-pipe protocol, local identity authorization, diagnostics/settings commands, and service lifecycle controls.
- Phase 6: ProgramData runtime layout, DPAPI migration, retained backups, watermarks and failed batches, decryption verification, rollback, configuration-corruption blocking, ACL setup, and recovery scripts.
- Phase 7: canonical frontend stock object, compatibility aliases, server pagination, total-stock rendering, production-only HSTS, tightened CSP, generated-file cleanup, and frontend documentation.
- Phase 8: exact-SHA Docker deployment, build identity labels, immutable sync-engine artifacts, installer, service tools, Windows CI tests, and release metadata.
- Phase 9: backend, frontend, .NET build, Compose validation, YAML validation, repository audit, and authenticated isolated Docker smoke verification.

## Partial requirements

- Windows service behavior is implemented and compile-checked, but service installation, DPAPI migration, reboot, crash recovery, and named-pipe operation require a Windows host.
- Production data acceptance values and `mismatched_products = 0` require authorized access to the real tenant and JTL database.
- Exact-image deployment and rollback are implemented but were not executed against production.
- External credential rotation and Git-history purge cannot be proven from the local working tree.

## Missing requirements

- No locally implementable source-code requirement remains open.
- Remaining actions are environment-specific and listed in `docs/FINAL_MANUAL_ACTIONS.md`.

## Current phase

Phase 9 complete locally; awaiting Windows and production verification.

## Files changed

- Backend inventory, ingest, cache, health, validation, database integrity, image identity, environment templates, and tests.
- Frontend inventory contract, paginated UI, security headers, tests, and README.
- Sync-engine Core, Service, WPF management mode, named-pipe IPC, runtime migration, service scripts, installer, and tests.
- Docker smoke stack, Make targets, CI/deployment workflows, and operations documentation.

## Tests passed

- Backend: 12 suites, 73 tests.
- Frontend: 3 files, 9 tests.
- Backend TypeScript typecheck and production build.
- Frontend production build.
- Complete .NET solution cross-build: zero warnings and zero errors.
- Isolated Docker smoke: clean schema, login, tenant-scoped live inventory response, total/available/reserved fixture, detailed integrity diagnostics, and cleanup.
- Compose configuration and YAML syntax validation.
- `git diff --check`.

## Known risks

- .NET tests are included in Windows CI but cannot execute on this macOS host because the Windows Desktop runtime is unavailable.
- Dependency audit output reports existing npm advisories; upgrades require a separate reviewed dependency-maintenance change.
- PostgreSQL cannot express a cross-partition unique constraint on `(tenant_id, jtl_order_id)` while partitioning only by `order_date`; a database trigger and advisory lock enforce the invariant.
- A dedicated least-privilege Windows service account and JTL SQL permissions must be configured by an administrator.

## Manual verification required

- Follow `docs/FINAL_MANUAL_ACTIONS.md`.
