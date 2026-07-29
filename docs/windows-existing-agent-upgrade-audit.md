# Windows Existing Agent Upgrade Audit

## Installed Baseline

- Product: JTL Sync Engine, x64, .NET 8 Windows Service plus WPF management UI.
- Service identity: `JtlSyncEngine`; display name `JTL Sync Engine`; delayed automatic start.
- Default account: `NT AUTHORITY\LocalService`; an existing custom account is preserved by the bridge installer.
- Default binary path: `%ProgramFiles%\JTL Sync Engine`.
- Persistent state: `%ProgramData%\JTL-Sync`; installer upgrades never delete this directory.
- Installer identity: Inno Setup `AppId={C89F1AB0-6DF3-49F1-A292-C6AC780B4260}` remains stable.
- Scheduler ownership remains guarded by the existing single-owner mutex.

| Requirement | Current implementation | Exact file | Action | Security concern | Implementation | Required verification |
|---|---|---|---|---|---|---|
| Existing service | Worker Service | `sync-engine-dotnet/JtlSyncEngine.Service/SyncEngineWorker.cs` | Extend | No second service | Update coordinator hosted here | Service count remains one |
| Existing scheduler | Scheduler and ownership mutex | `sync-engine-dotnet/JtlSyncEngine/Jobs/SyncScheduler.cs` | Reuse | Never interrupt active state writes | `IsSafeUpdateBoundary` | Busy-sync update waits |
| Version identity | Assembly metadata | `sync-engine-dotnet/JtlSyncEngine.Core/Runtime/BuildIdentity.cs` | Reuse | Health must match target | Heartbeat and transaction checks | Version/SHA mismatch rolls back |
| Heartbeat | Existing agent heartbeat | `sync-engine-dotnet/JtlSyncEngine/Services/ApiClient.cs` | Extend | Backend receipt is authoritative | Update capabilities and build identity | Fresh heartbeat required |
| Named pipe | Existing restricted control channel | `sync-engine-dotnet/JtlSyncEngine/Ipc` | Extend | UI must not replace files | `GetUpdateStatus` | Unauthorized identity rejected |
| ProgramData | Shared runtime layout | `sync-engine-dotnet/JtlSyncEngine.Core/Runtime/RuntimePaths.cs` | Extend | Transactions require restricted ACL | `updates/*` directories | ACL inspection on pilot |
| Installer | Inno Setup | `sync-engine-dotnet/installer/JtlSyncEngine.iss` | Extend | Bridge needs elevation | Safe stop, helper install, verify | In-place upgrade pilot |
| Service install | PowerShell bridge | `sync-engine-dotnet/service-tools/install-service.ps1` | Harden | Preserve account; no broad write ACL | Service SID scoped modify/control | Compare service account/SDDL |
| Release API | Missing before this change | `backend/src/modules/agent-releases` | Create | Tenant and API-key isolation | Release/request module | Cross-tenant rejection |
| Release database | Missing before this change | `backend/init-db/15-agent-updates.sql` | Create | Non-destructive migration | Releases, requests, bad releases | Migration/schema check |
| Dashboard controls | Sync page existed | `web/src/app/dashboard/sync/page.tsx` | Extend | Permission and capability gating | Real update status/actions | Role and feature-flag tests |
| Signed routine update | Missing before this change | `sync-engine-dotnet/JtlSyncEngine.Core/Updates` | Create | No URL/path/command injection | Manifest, downloader, staging, backup | Security test suite |
| Privileged helper | Missing before this change | `sync-engine-dotnet/JtlSyncEngine.Updater` | Create | Must not be generic execution | Transaction-ID-only helper | Invalid argument/path tests |
| CI package | Service/UI artifacts existed | `.github/workflows/build-sync-engine.yml` | Extend | Package must be Authenticode signed | Optional signed update artifact | Signed Windows workflow run |

## Bridge Assumption

The first updater-capable release requires one authorised administrator-assisted installer run. Routine updates then execute under the existing service identity and its narrowly scoped service SID rights. Production signing certificates, the Windows service-control test, and the pilot upgrade are external deployment requirements.
