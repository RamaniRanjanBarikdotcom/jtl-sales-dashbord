# Sync Agent Protocol

Every request requires `Authorization: Bearer <sync-api-key>` and `x-tenant-id`. The backend verifies the key against that exact active tenant.

The agent posts a heartbeat every 30 seconds, atomically claims one allowlisted command, reports progress, renews a 120-second lease when needed, and reports exactly one terminal result. Idempotency is enforced per tenant. Unknown command types are rejected and never mapped to shell execution.
