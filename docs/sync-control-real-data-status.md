# Sync Control Centre Real-Data Status

## Complete in source

- Real 30-second agent heartbeat with backend-authoritative receipt time.
- Online, degraded, offline and never-connected calculation.
- Machine, version, Git SHA, scheduler, current job/command, JTL/backend connectivity and schedule fields.
- Tenant derived from the active sync API key and explicit tenant ID; inactive tenant/key rejection remains enforced.
- Enabled-agent enforcement and optional minimum agent version.
- Durable tenant-scoped command queue, event history, atomic claim and two-minute renewable lease.
- Lease-expiry transition to interrupted and agent current-command cleanup.
- Active-command idempotency and idempotent completion/failure callbacks.
- Typed allowlisted commands, command-specific permissions, capability checks and protected rollout flags.
- Diagnostics, connection tests, incremental sync, module re-sync, pause and resume handlers.
- Local completed-command history to avoid duplicate execution after acknowledgement timeouts.
- Control polling remains active while scheduled synchronization is paused.
- Real control-plane dashboard, active command panel, history, unavailable/never-connected/offline states and nullable progress.
- Production mock-data startup safeguard.
- Additive migration, automated backend/frontend tests and documentation.

## Preserved

- Existing ingest/data plane and legacy trigger channel.
- Existing orchestrator, JTL read-only queries, watermarks, failed batches and inventory staging protections.
- Existing scheduler ownership mutex and no inbound Windows service endpoint.
- Commands remain disabled by default.

## Requires deployed-environment verification

- Install the rebuilt Windows service/EXE and verify its actual version and SHA.
- Stop/start and five-minute offline/reconnect timing.
- JTL disconnect/reconnect while heartbeat remains available.
- Command queue, claim, progress, completion, lease renewal and offline queue using the installed service.
- Windows reboot during a command and local completed-command replay.
- Safe cancellation at a real batch boundary.
- Tenant-isolation and permission scenarios using production-equivalent accounts.
- Enable commands gradually only after the read-only heartbeat checks pass.
