# Windows In-Place Update Architecture

## Components and Trust Boundaries

```mermaid
sequenceDiagram
  participant A as Authorized Admin
  participant B as NestJS Backend
  participant S as Portable Sync Engine
  participant H as Trusted Updater Helper
  participant W as Backend Heartbeat Store
  A->>B: Request approved release for tenant agent
  S->>B: Claim with API key + tenant + agent identity
  B-->>S: Signed canonical manifest and backend-relative package path
  S->>B: Stream package (redirects rejected)
  S->>S: Verify RSA signature, SHA-256, Authenticode, identity, paths
  S->>S: Stage payload and back up installed binaries
  S->>H: Start with transaction UUID only
  S->>S: Exit at safe scheduler boundary
  H->>H: Verify HMAC transaction and trusted directories
  H->>H: Replace portable binaries and restart JtlSyncEngine.exe
  S->>W: Fresh heartbeat with target version and Git SHA
  S->>B: Complete request
  B->>W: Verify authoritative heartbeat
  alt health fails
    H->>H: Restore backup and restart previous portable app
    S->>B: Report rollback after old-version heartbeat
  end
```

## State Machine

`approved → claimed → downloading → verifying → staged → waiting_for_window → installing → restarting → verifying_health → completed`

Failure branches:

- Preparation failure: `failed`, local/backend release suppression.
- New-build health failure: `rollback_started → rolled_back`.
- Rollback failure: `failed` with `ROLLBACK_FAILED`; evidence remains under `%AppData%\JTL-Sync`.
- Cancellation is allowed only before installation begins.

## Trust Decisions

- The dashboard selects only a backend release ID and `now` or `maintenance`; it cannot submit URLs, paths, service names, certificates, executables, or commands.
- Agent authentication is the existing API key plus required tenant ID. Tenant is derived by `SyncApiKeyGuard`.
- Package location is a signed backend-relative `/api/sync-agent/releases/.../package` path.
- Downloads use HTTPS, the configured backend/allowlisted hosts, no redirects, bounded size, timeout, streaming, and atomic completion.
- The helper accepts only `--transaction <UUID>`. Paths and executable identity come from a DPAPI/HMAC-protected transaction.
- The scheduler, agent ID, API key, JTL settings, watermarks, logs, and command history remain unchanged in `%AppData%\JTL-Sync`.

## Capability Negotiation

The portable agent heartbeat reports `safeUpdate=true`, `updateProtocolVersion=2`, and `updateHostMode=portable` when the signed helper and manifest key are available. Legacy service hosts report updates as unsupported.
