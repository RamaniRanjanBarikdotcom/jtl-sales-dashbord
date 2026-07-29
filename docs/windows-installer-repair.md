# Windows Installer and Repair

## Supported Operations

- **First install:** elevated installer creates `JtlSyncEngine`, ProgramData ACL, delayed automatic start, recovery actions, WPF UI, helper, and service tools.
- **Bridge/in-place upgrade:** stable Inno `AppId` detects the existing product, stops the service, overlays signed files, preserves ProgramData and the current service account, reapplies recovery and updater ACL, restarts, and verifies.
- **Repair:** rerun the same or newer signed installer. Do not uninstall first.
- **Service-account change:** administrator-only operational change followed by `install-service.ps1`/ACL verification.
- **Machine migration:** install on the new machine, securely migrate only approved ProgramData configuration/state, re-protect secrets on that machine, and validate tenant/agent identity before enabling schedules.
- **Uninstall:** removes the service through `uninstall-service.ps1`. Back up ProgramData first; runtime data is intentionally treated separately from binaries.

## Installer Identity

Inno Setup uses stable `AppId={C89F1AB0-6DF3-49F1-A292-C6AC780B4260}`. Routine versioned builds update `AppVersion`; they must not change the service name or install a second product. Inno does not require an MSI ProductCode/UpgradeCode.

## Repair Procedure

```powershell
Stop-Service JtlSyncEngine
# Run the signed installer as administrator.
& "$env:ProgramFiles\JTL Sync Engine\service-tools\verify-service.ps1"
Get-CimInstance Win32_Service -Filter "Name='JtlSyncEngine'"
```

Compare the service account, start mode, recovery settings, agent/tenant identity, backend URL, API key usability, JTL configuration, watermarks, failed batches, logs, scheduler settings, and heartbeat with the pre-repair record.

## Disaster Recovery

If both routine rollback and repair fail, preserve `%ProgramData%\JTL-Sync\updates` and logs, reinstall the last known-good signed bridge installer over the same path, restore approved ProgramData backup, migrate/re-encrypt secrets if the machine changed, start the existing service, and keep scheduling paused until backend/JTL/tenant identity checks pass.
