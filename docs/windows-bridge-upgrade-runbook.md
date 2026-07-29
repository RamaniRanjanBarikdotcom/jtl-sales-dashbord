# Windows Portable Deployment Runbook

## Purpose

Deploy the click-to-run Sync Engine without an installer or Windows service.

## Build and Sign

1. Set GitHub Actions secrets `WINDOWS_SIGNING_CERT_BASE64`, `WINDOWS_SIGNING_CERT_PASSWORD`, and the backend manifest verification key `SYNC_AGENT_MANIFEST_PUBLIC_KEY_PEM`.
2. Run **Build Sync Engine** with a semantic version higher than the installed version.
3. Confirm backend tests, .NET build/tests, publish, Authenticode signing, and portable packaging succeed.
4. Download `JtlSyncEngine-Portable-win-x64.zip` and record its SHA-256.
5. Verify on Windows:

```powershell
Expand-Archive .\JtlSyncEngine-Portable-win-x64.zip .\JtlSyncEngine
Get-AuthenticodeSignature .\JtlSyncEngine\JtlSyncEngine.exe | Format-List
Get-FileHash .\JtlSyncEngine-Portable-win-x64.zip -Algorithm SHA256
```

## Preflight

```powershell
Get-Process JtlSyncEngine -ErrorAction SilentlyContinue
Copy-Item "$env:APPDATA\JTL-Sync" "D:\JTL-Sync-portable-backup" -Recurse
```

Record the extracted binary path, tenant/agent identity, latest watermarks, and backend heartbeat.

## Install

1. Sign in as the Windows user that will run synchronization.
2. Stop any previous `JtlSyncEngine.exe` process.
3. Extract the ZIP to a normal user-owned folder such as `C:\Tools\JTL-Sync`.
4. Double-click `JtlSyncEngine.exe`.
5. Configure tenant ID, API key, backend URL, and JTL connection.
6. Enable **Start with Windows** if background startup is required.

## Verification

```powershell
Get-Process JtlSyncEngine
Get-AuthenticodeSignature "C:\Tools\JTL-Sync\JtlSyncEngine.exe"
Get-ChildItem "$env:APPDATA\JTL-Sync"
```

Confirm the window opens on manual double-click, the tray process stays running, dashboard heartbeat/version is current, JTL remains read-only, sync succeeds, and Start with Windows launches after user sign-in.

## Bridge Failure

Stop the app, replace the extracted folder with the previous signed portable ZIP, preserve `%AppData%\JTL-Sync`, start the previous executable, and verify the previous heartbeat. Preserve updater logs for investigation.

## Required Windows Pilot Matrix

Run this on an isolated Windows Server x64 pilot with an existing production-like agent, test tenant/API key, approved Authenticode certificate, manifest RSA key pair, and backend release storage:

```powershell
dotnet test .\sync-engine-dotnet\JtlSyncEngine.Core.Tests\JtlSyncEngine.Core.Tests.csproj -c Release
dotnet publish .\sync-engine-dotnet\JtlSyncEngine\JtlSyncEngine.csproj -c Release -r win-x64 --self-contained true
dotnet publish .\sync-engine-dotnet\JtlSyncEngine.Updater\JtlSyncEngine.Updater.csproj -c Release -r win-x64 --self-contained true
```

Expected automated result: all core tests pass and both portable projects publish. Sign the application binaries with the approved certificate, then verify valid, unsigned, tampered, wrong-publisher, wrong-architecture, downgrade, HTTP, redirect, unapproved-host, oversized, traversal, and duplicate-entry packages are rejected before replacement.

Exercise interrupted/partial download, disk/staging/backup failures, active sync and command lease, process-exit timeout, locked file, helper crash, new-version crash, missing/wrong heartbeat, wrong Git SHA, backend/network outage, successful and failed rollback, restart/reboot in every persisted transaction state, duplicate request, bad-release retry suppression, and overnight maintenance windows.

Before replacement capture agent and tenant identity, API-key fingerprint, backend URL, JTL settings, watermarks, failed batches, command/completion history, logs, and scheduler settings. Compare the same snapshot after update and rollback. Also test old-agent/new-backend, new-agent/new-backend, upgrade-required capability negotiation, legacy ingest, scheduled sync, and portable repair.

Evidence must include the GitHub Actions run, signed artifact hashes and signatures, startup/updater logs, transaction records, backend System Logs correlation IDs, heartbeat rows with version/Git SHA, rollback evidence, and state-preservation diff. Production enablement is blocked until this matrix passes.
