# AI Analytics Current-State Audit

| Area | Classification |
|---|---|
| Sales service and filters | Already implemented and reusable |
| Products, inventory, customers, regional | Backend available; later Copilot tools remain feature-gated |
| Sync status | Backend available and reusable |
| System Logs | Added in this implementation |
| Tenant context and permissions | Already implemented and authoritative |
| Company switcher | Already implemented |
| Redis and materialized views | Existing analytics infrastructure reused |
| Metric formulas | Existing dashboard services authoritative; sales v1 definition documented |
| Date ranges | Copilot resolves presets on backend using tenant timezone |
| Currency and locale | Added to tenant settings |
| Audit logging | Existing durable audit service reused with central sanitization |
| Arbitrary analytical SQL | Not safely available and intentionally prohibited |
