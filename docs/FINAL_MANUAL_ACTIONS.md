# Final Manual Actions

These actions require production infrastructure, Windows, privileged access, or external account control and were intentionally not performed locally.

## 1. External Security

- Rotate PostgreSQL, Redis, JWT, sync API, deployment, and any previously exposed credentials.
- Run the repository history-purge procedure in `docs/SECURITY_ROTATION_RUNBOOK.md`.
- Re-run Gitleaks against full history and invalidate old tokens after the purge.

## 2. Database Migration

1. Take and verify a managed PostgreSQL backup.
2. Review `backend/init-db/12-tenant-integrity.sql`.
3. In the approved maintenance window, run:

```bash
cd backend
SCHEMA_APPLY_CONFIRM=yes npm run migration:run
```

4. Confirm `synchronize` remains disabled.
5. Verify tenant uniqueness and order-duplicate protection before deployment.

## 3. Production Inventory Acceptance

Using authenticated admin diagnostics and an authorized read-only JTL comparison, verify:

```text
JIS-001 = 5
JIS-002 = 6
JIS-003 = 4
JIS-004 = 12
JIS-006 = 8
JIS-007 = 5
mismatched_products = 0
```

Confirm visible stock equals JTL “Bestand alle Lager”, while available and reserved remain separate.

## 4. Windows Configuration Migration

Run under the original Windows user whose CurrentUser DPAPI key protects the old secrets:

```powershell
Set-Location "C:\Program Files\JTL Sync Engine"
.\service-tools\migrate-config.ps1
```

Verify:

- `C:\ProgramData\JTL-Sync` contains all required directories.
- Settings, watermarks, and failed batches are preserved.
- No plaintext secret file exists.
- A timestamped backup and `state\migration-v1.complete` exist.

If rollback is required while the service is stopped:

```powershell
.\service-tools\rollback-config.ps1 `
  -BackupDirectory "C:\ProgramData\JTL-Sync\backups\<legacy-backup>"
```

## 5. Service Account

- Create a dedicated domain account or gMSA.
- Grant “Log on as a service”.
- Grant only required access to `C:\ProgramData\JTL-Sync`.
- Grant backend network access and read-only JTL SQL access.
- Do not grant local administrator, `db_owner`, or `db_datawriter`.

Verify SQL permissions with read-only queries:

```sql
SELECT
  HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'SELECT') AS can_select,
  HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'INSERT') AS can_insert,
  HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'UPDATE') AS can_update,
  HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'DELETE') AS can_delete;
```

Expected: `can_select = 1`; all write permissions `= 0`.

## 6. Install and Verify the Windows Service

Download the immutable installer matching the deployed Git SHA, then run as administrator:

```powershell
.\service-tools\install-service.ps1 `
  -InstallDirectory "C:\Program Files\JTL Sync Engine" `
  -ServiceAccount "DOMAIN\jtl-sync-service"
.\service-tools\start-service.ps1
.\service-tools\verify-service.ps1
```

Set `JTL_SYNC_PIPE_IDENTITIES` to the approved local management identities. Confirm an approved user can manage the service and an unapproved user receives access denied.

## 7. Windows Failure and Reboot Tests

In a maintenance window:

1. Start with backend unavailable; verify retry intervals and no crash loop.
2. Start with JTL SQL unavailable; verify retry and no watermark advance.
3. Kill the service process and verify recovery at 60/120/300 seconds.
4. Reboot without interactive login; verify Automatic Delayed Start.
5. Reboot during a controlled sync; verify confirmed watermarks and failed batches remain valid.
6. Open WPF while the service runs; verify it connects through the pipe and does not create another scheduler.
7. Stop the service and open WPF; verify it shows stopped and does not silently enter standalone mode.

Run Windows tests:

```powershell
dotnet test .\sync-engine-dotnet\JtlSyncEngine.Core.Tests\JtlSyncEngine.Core.Tests.csproj -c Release
```

## 8. Exact-SHA Production Deployment

Use the CI-tested full SHA:

```bash
export IMAGE_SHA="<FULL_TESTED_GIT_SHA>"
export IMAGE_NAMESPACE="ghcr.io/<owner>/<repository>"
export JTL_API_IMAGE="$IMAGE_NAMESPACE/jtl-api:$IMAGE_SHA"
export JTL_WEB_IMAGE="$IMAGE_NAMESPACE/jtl-frontend:$IMAGE_SHA"
export BACKEND_ENV_FILE="./backend/.env.production"

docker compose -f docker-compose.prod.yml pull nestjs-api nextjs-frontend
docker compose -f docker-compose.prod.yml up -d --force-recreate --no-deps \
  nestjs-api nextjs-frontend apache
curl -fsS https://<dashboard-host>/api/healthz | grep "$IMAGE_SHA"
```

Verify dashboard inventory, tenant switching, authentication, sync heartbeat, all sync modules, and authenticated `/api/admin/health`.

## 9. Production Rollback Rehearsal

Redeploy the previous tested SHA and verify health reports that SHA. Stop the Windows service before replacing sync-engine binaries. Confirm watermarks, failed batches, and ProgramData configuration remain unchanged.
