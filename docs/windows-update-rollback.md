# Windows Update Rollback

## Automatic Triggers

Rollback starts when replacement fails, the service cannot start, the new service does not complete backend-authoritative health verification before timeout, or the target version/Git SHA heartbeat is wrong.

## Automatic Flow

1. Stop the failed `JtlSyncEngine` service.
2. Restore only files replaced by the staged payload from `%ProgramData%\JTL-Sync\updates\backups\<transaction>` and remove newly introduced payload files.
3. Start the same service.
4. Wait for the previous version/Git SHA heartbeat.
5. Mark the request `rolled_back`.
6. Record local and backend bad-release suppression.
7. Preserve transaction, updater log, package, staging data, and backend events.

The selective restore avoids touching the WPF application or unrelated installation files that were not part of the routine service package. The helper marks `rollback_failed` and stops retrying if restoration/start fails. Windows service recovery settings remain unchanged.

## Recovery After Reboot

Transactions are atomic and HMAC protected. On startup the service rechecks pending `restarting`, `verifying_health`, `rolled_back`, and `rollback_failed` states. Duplicate callbacks are bound to the same request/transaction, and failed releases are suppressed to avoid an install loop.

## Manual Recovery

```powershell
Stop-Service JtlSyncEngine
Copy-Item "$env:ProgramData\JTL-Sync\updates\backups\<transaction>\*" `
  "$env:ProgramFiles\JTL Sync Engine" -Recurse -Force
Start-Service JtlSyncEngine
Get-Service JtlSyncEngine
```

Use an authorised administrator. Do not delete transaction evidence until the previous heartbeat, tenant authentication, named pipe, scheduler, JTL connectivity report, and one safe sync have been verified.

## Evidence

Collect `%ProgramData%\JTL-Sync\logs\updater`, service logs, transaction JSON, bad-release registry, backend System Logs correlation ID, release manifest/signature/hash, service event log, current/previous file hashes, and heartbeat rows.
