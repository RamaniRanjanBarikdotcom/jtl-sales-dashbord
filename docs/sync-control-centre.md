# Sync Control Centre

The existing trigger channel remains compatible. The new durable channel uses `sync_agents`, `sync_commands`, and `sync_command_events`.

- Heartbeat interval: 30 seconds.
- Online: heartbeat within 90 seconds.
- Degraded: 90 seconds to 5 minutes.
- Offline: older than 5 minutes.
- Claim: atomic `FOR UPDATE SKIP LOCKED`.
- Lease: 120 seconds; agent may renew through the lease endpoint.
- Remote commands are allowlisted and disabled by default.
- Cancellation is cooperative; no arbitrary process termination is exposed.

## Authoritative sources

- Engine liveness is calculated from backend receipt time in `sync_agents.last_heartbeat_at`.
- Build, machine, scheduler, current job, connectivity and next schedule are reported by the installed agent.
- Data-sync history comes from `sync_runs`; it is not inferred from heartbeat state.
- Commands and progress come only from `sync_commands` and `sync_command_events`.
- Missing heartbeat, sync, progress or connectivity values remain visibly unavailable.

## Safety and rollout

- `SYNC_CONTROL_STATUS_ENABLED=true` permits read-only status.
- `SYNC_CONTROL_COMMANDS_ENABLED=false` keeps command creation and agent claiming disabled.
- `SYNC_CONTROL_MODULE_RESYNC_ENABLED=false` separately protects module re-sync.
- `SYNC_CONTROL_ADVANCED_COMMANDS_ENABLED=false` protects full-company operations.
- Production startup rejects `USE_MOCK_SYNC_DATA=true`.
- The agent polls outbound over HTTPS; no inbound Windows port is exposed.
- Only allowlisted typed commands are accepted. Arbitrary SQL, shell, PowerShell and file access are absent.

## Deployment order

1. Apply migration `14-sync-control-production.sql`.
2. Deploy backend and frontend with status enabled and commands disabled.
3. Build and install the new Windows service/EXE.
4. Verify real heartbeat, machine, version, SHA, JTL and backend connectivity.
5. Enable base commands, then module re-sync commands independently.
