# Windows Portable Repair

There is no installer in the normal distribution. `JtlSyncEngine-Portable-win-x64.zip` contains a self-contained click-to-run application and its restricted updater helper.

## Repair Procedure

```powershell
Stop-Process -Name JtlSyncEngine -Force -ErrorAction SilentlyContinue
Rename-Item "C:\Tools\JTL-Sync" "C:\Tools\JTL-Sync-broken"
Expand-Archive .\JtlSyncEngine-Portable-win-x64.zip "C:\Tools\JTL-Sync"
Start-Process "C:\Tools\JTL-Sync\JtlSyncEngine.exe"
```

Do not delete `%AppData%\JTL-Sync`. Compare agent/tenant identity, backend URL, API key usability, JTL configuration, watermarks, failed batches, logs, scheduler settings, and heartbeat with the pre-repair record.

## Disaster Recovery

If both routine rollback and repair fail, preserve `%AppData%\JTL-Sync\updates` and logs, extract the last known-good signed portable ZIP to a clean user-owned folder, restore only an approved AppData backup, migrate/re-encrypt secrets if the Windows user or machine changed, and keep scheduling paused until backend/JTL/tenant identity checks pass.
