# Windows In-Place Update Architecture

## Components and Trust Boundaries

```mermaid
sequenceDiagram
  participant A as Authorized Admin
  participant B as NestJS Backend
  participant S as Existing Windows Service
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
  H->>H: Replace service binaries and restart same service
  S->>W: Fresh heartbeat with target version and Git SHA
  S->>B: Complete request
  B->>W: Verify authoritative heartbeat
  alt health fails
    H->>H: Restore backup and restart previous service
    S->>B: Report rollback after old-version heartbeat
  end
```

## State Machine

`approved → claimed → downloading → verifying → staged → waiting_for_window → installing → restarting → verifying_health → completed`

Failure branches:

- Preparation failure: `failed`, local/backend release suppression.
- New-build health failure: `rollback_started → rolled_back`.
- Rollback failure: `failed` with `ROLLBACK_FAILED`; evidence remains under ProgramData.
- Cancellation is allowed only before installation begins.

## Trust Decisions

- The dashboard selects only a backend release ID and `now` or `maintenance`; it cannot submit URLs, paths, service names, certificates, executables, or commands.
- Agent authentication is the existing API key plus required tenant ID. Tenant is derived by `SyncApiKeyGuard`.
- Package location is a signed backend-relative `/api/sync-agent/releases/.../package` path.
- Downloads use HTTPS, the configured backend/allowlisted hosts, no redirects, bounded size, timeout, streaming, and atomic completion.
- The helper accepts only `--transaction <UUID>`. Paths and the service name come from a DPAPI/HMAC-protected transaction.
- The existing service, scheduler, agent ID, API key, JTL settings, watermarks, logs, and command history remain unchanged.

## Capability Negotiation

The new agent heartbeat reports `safeUpdate=true` and `updateProtocolVersion=2`. Backend and UI hide update actions for legacy agents. Feature flags remain off until the signed bridge pilot is approved.
