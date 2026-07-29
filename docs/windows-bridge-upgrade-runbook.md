# Windows Bridge Upgrade Runbook

## Purpose

This is the one administrator-assisted upgrade that installs the trusted updater helper and service-specific ACL. It is not required for later routine signed updates.

## Build and Sign

1. Set GitHub Actions secrets `WINDOWS_SIGNING_CERT_BASE64`, `WINDOWS_SIGNING_CERT_PASSWORD`, and the backend manifest verification key `SYNC_AGENT_MANIFEST_PUBLIC_KEY_PEM`.
2. Run **Build Sync Engine** with a semantic version higher than the installed version.
3. Confirm backend tests, .NET build/tests, publish, Authenticode signing, and Inno Setup build succeed.
4. Download `JtlSyncEngine-Installer-win-x64.exe` and record its SHA-256.
5. Verify on Windows:

```powershell
Get-AuthenticodeSignature .\JtlSyncEngine-Installer-win-x64.exe | Format-List
Get-FileHash .\JtlSyncEngine-Installer-win-x64.exe -Algorithm SHA256
```

## Preflight

```powershell
Get-CimInstance Win32_Service -Filter "Name='JtlSyncEngine'" |
  Select-Object Name,StartName,StartMode,PathName,State
Copy-Item "$env:ProgramData\JTL-Sync" "D:\JTL-Sync-prebridge" -Recurse
```

Record service account, binary path, tenant/agent identity, latest watermarks, recovery configuration, and backend heartbeat.

## Install

1. Sign in with an authorised administrator account.
2. Run the installer once as administrator.
3. The installer stops the existing service before replacing files.
4. It preserves the existing service account, service name, ProgramData, startup mode, and recovery settings.
5. It installs `JtlSyncEngine.Updater.exe`, grants only the service SID modify access to the install directory, starts the service, and runs `verify-service.ps1`.

## Verification

```powershell
& "$env:ProgramFiles\JTL Sync Engine\service-tools\verify-service.ps1"
Get-CimInstance Win32_Service -Filter "Name='JtlSyncEngine'"
sc.exe qfailure JtlSyncEngine
sc.exe sdshow JtlSyncEngine
icacls.exe "$env:ProgramFiles\JTL Sync Engine"
```

Confirm one service exists, the prior account is unchanged, dashboard heartbeat/version is current, JTL remains read-only, sync succeeds, WPF named-pipe status works, and reboot-without-login starts the service.

## Bridge Failure

Do not uninstall first. Stop, reinstall the previous signed installer in repair mode, restore ProgramData only if configuration/state was damaged, start the same service, and verify the previous heartbeat. Preserve installer/updater logs for investigation.

## Required Windows Pilot Matrix

Run this on an isolated Windows Server x64 pilot with an existing production-like agent, test tenant/API key, approved Authenticode certificate, manifest RSA key pair, and backend release storage:

```powershell
dotnet test .\sync-engine-dotnet\JtlSyncEngine.Core.Tests\JtlSyncEngine.Core.Tests.csproj -c Release
dotnet publish .\sync-engine-dotnet\JtlSyncEngine.Service\JtlSyncEngine.Service.csproj -c Release -r win-x64 --self-contained true
dotnet publish .\sync-engine-dotnet\JtlSyncEngine.Updater\JtlSyncEngine.Updater.csproj -c Release -r win-x64 --self-contained true
& "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe" .\sync-engine-dotnet\installer\JtlSyncEngine.iss
```

Expected automated result: all core tests pass, all projects publish, and the installer builds. Sign the application binaries and installer with the approved certificate, then verify valid, unsigned, tampered, wrong-publisher, wrong-architecture, downgrade, HTTP, redirect, unapproved-host, oversized, traversal, and duplicate-entry packages are rejected before replacement.

Exercise interrupted/partial download, disk/staging/backup failures, active sync and command lease, stop timeout, locked file, helper crash, new-version crash, missing/wrong heartbeat, wrong Git SHA, backend/network outage, successful and failed rollback, restart/reboot in every persisted transaction state, duplicate request, bad-release retry suppression, and overnight maintenance windows.

Before installation capture service name/account/startup/recovery/SDDL, agent and tenant identity, API-key fingerprint, backend URL, JTL settings, watermarks, failed batches, command/completion history, logs, scheduler and named-pipe settings. Compare the same snapshot after update and rollback. Also test old-agent/new-backend, new-agent/new-backend, upgrade-required capability negotiation, legacy ingest, scheduled sync, and installer repair.

Evidence must include the GitHub Actions run, signed artifact hashes and signatures, installer log, `verify-service.ps1` output, service/ACL/SDDL snapshots, transaction/updater logs, backend System Logs correlation IDs, heartbeat rows with version/Git SHA, rollback evidence, and state-preservation diff. Production enablement is blocked until this matrix passes.
