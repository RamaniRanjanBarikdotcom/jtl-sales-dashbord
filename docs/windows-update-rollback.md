# Windows Update Rollback

## Automatic Triggers

Rollback starts when replacement fails, the portable app cannot restart, the new app does not complete backend-authoritative health verification before timeout, or the target version/Git SHA heartbeat is wrong.

## Automatic Flow

1. Stop the failed `JtlSyncEngine.exe` process started by the updater.
2. Restore only files replaced by the staged payload from `%AppData%\JTL-Sync\updates\backups\<transaction>` and remove newly introduced payload files.
3. Start the previous `JtlSyncEngine.exe`.
4. Wait for the previous version/Git SHA heartbeat.
5. Mark the request `rolled_back`.
6. Record local and backend bad-release suppression.
7. Preserve transaction, updater log, package, staging data, and backend events.

The selective restore avoids touching unrelated files in the extracted application folder. The helper marks `rollback_failed` and stops retrying if restoration or restart fails.

## Recovery After Reboot

Transactions are atomic and HMAC protected. On startup the portable app rechecks pending `restarting`, `verifying_health`, `rolled_back`, and `rollback_failed` states. Duplicate callbacks are bound to the same request/transaction, and failed releases are suppressed to avoid an update loop.

## Manual Recovery

```powershell
Stop-Process -Name JtlSyncEngine -Force -ErrorAction SilentlyContinue
Copy-Item "$env:APPDATA\JTL-Sync\updates\backups\<transaction>\*" `
  "C:\Tools\JTL-Sync" -Recurse -Force
Start-Process "C:\Tools\JTL-Sync\JtlSyncEngine.exe"
```

Use the same Windows user that runs the portable app. Do not delete transaction evidence until the previous heartbeat, tenant authentication, scheduler, JTL connectivity report, and one safe sync have been verified.

## Evidence

Collect `%AppData%\JTL-Sync\logs\updater`, application logs, transaction JSON, bad-release registry, backend System Logs correlation ID, release manifest/signature/hash, current/previous file hashes, and heartbeat rows.
