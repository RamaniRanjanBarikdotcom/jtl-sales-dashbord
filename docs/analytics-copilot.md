# Analytics Copilot

The first release supports a single typed tool: `get_sales_summary`.

- Tenant and user context come only from authenticated request context.
- Relative dates resolve in the tenant timezone.
- Results include metric version, resolved dates, freshness, and query reference.
- The model cannot submit SQL or tenant IDs.
- Provider failures affect only Copilot and return an unavailable state.
- `OPENAI_API_KEY` stays in the backend environment.
