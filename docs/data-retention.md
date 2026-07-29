# Data Retention

Audit logs are append-only. System-event and Copilot retention must be configured and executed by an approved maintenance job; no user-facing delete API is provided. Recommended initial values are 90 days for system events, 365 days for audit events, and 30 days for expired AI query results. Confirm legal and customer requirements before production deletion.
