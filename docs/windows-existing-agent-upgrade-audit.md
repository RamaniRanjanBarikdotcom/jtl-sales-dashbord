# Windows Existing Agent Upgrade Audit

## Portable Baseline

- Product: JTL Sync Engine, x64, self-contained .NET 8 WPF application.
- Startup: extract `JtlSyncEngine-Portable-win-x64.zip` and double-click `JtlSyncEngine.exe`.
- Runtime account: the signed-in Windows user; no elevation is required.
- Binary path: any normal user-owned extracted folder.
- Persistent state: `%AppData%\JTL-Sync`; replacing the extracted binaries does not delete configuration or watermarks.
- Scheduler ownership remains guarded by the existing single-owner mutex.
- Legacy Windows service source remains only for compatibility and is not included in the normal GitHub artifact.

| Requirement | Current implementation | Exact file | Action | Security concern | Implementation | Required verification |
|---|---|---|---|---|---|---|
| Portable host | WPF application | `sync-engine-dotnet/JtlSyncEngine/App.xaml.cs` | Reuse | One scheduler owner | Scheduler and portable update loop | Double-click opens and syncs |
| Existing scheduler | Scheduler and ownership mutex | `sync-engine-dotnet/JtlSyncEngine/Jobs/SyncScheduler.cs` | Reuse | Never interrupt active state writes | `IsSafeUpdateBoundary` | Busy-sync update waits |
| Version identity | Assembly metadata | `sync-engine-dotnet/JtlSyncEngine.Core/Runtime/BuildIdentity.cs` | Reuse | Health must match target | Heartbeat and transaction checks | Version/SHA mismatch rolls back |
| Heartbeat | Existing agent heartbeat | `sync-engine-dotnet/JtlSyncEngine/Services/ApiClient.cs` | Extend | Backend receipt is authoritative | Update capabilities and build identity | Fresh heartbeat required |
| AppData | Current-user runtime layout | `sync-engine-dotnet/JtlSyncEngine.Core/Runtime/RuntimePaths.cs` | Reuse | Transactions require protected integrity | `updates/*` directories | Current-user state survives replacement |
| Release API | Missing before this change | `backend/src/modules/agent-releases` | Create | Tenant and API-key isolation | Release/request module | Cross-tenant rejection |
| Release database | Missing before this change | `backend/init-db/15-agent-updates.sql` | Create | Non-destructive migration | Releases, requests, bad releases | Migration/schema check |
| Dashboard controls | Sync page existed | `web/src/app/dashboard/sync/page.tsx` | Extend | Permission and capability gating | Real update status/actions | Role and feature-flag tests |
| Signed routine update | Missing before this change | `sync-engine-dotnet/JtlSyncEngine.Core/Updates` | Create | No URL/path/command injection | Manifest, downloader, staging, backup | Security test suite |
| Privileged helper | Missing before this change | `sync-engine-dotnet/JtlSyncEngine.Updater` | Create | Must not be generic execution | Transaction-ID-only helper | Invalid argument/path tests |
| CI package | Portable/UI artifact | `.github/workflows/build-sync-engine.yml` | Extend | Package must be Authenticode signed | Portable ZIP and optional signed update ZIP | Signed Windows workflow run |

## Migration Assumption

No bridge installer is required. Stop or disable a legacy service once, extract the portable ZIP to a user-owned folder, and run `JtlSyncEngine.exe`. Re-enter or migrate approved configuration into `%AppData%\JTL-Sync`, then verify tenant identity, JTL connectivity, heartbeat, and one safe sync.
