# Security Threat Model

- **Cross-tenant access:** mitigated by JWT, tenant isolation, membership permission checks, and parameterized tenant filters.
- **Leaked sync key:** mitigated by exact tenant/key pairing, hashing, active-tenant checks, rotation, and audit events.
- **Remote code execution:** no generic shell, PowerShell, process, SQL, or arbitrary command endpoint exists.
- **Prompt injection:** the model sees fixed aggregate JSON only and cannot choose tools, SQL, or tenant IDs outside the allowlisted orchestration path.
- **Secret leakage:** metadata is recursively redacted and bounded before persistence.
- **Replay/duplication:** command idempotency keys and atomic claims prevent duplicate execution.
- **Provider outage:** isolated to Copilot; dashboard and sync paths continue operating.
