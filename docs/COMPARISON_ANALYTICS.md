# Compare & Analyse

## Deployment

1. Apply `backend/init-db/16-comparison-analytics.sql` with the normal reviewed schema process.
2. Deploy backend and frontend from the same Git SHA.
3. Enable `COMPARISON_CENTRE_ENABLED`.
4. Enable each module flag only after its API smoke test passes:
   - `COMPARISON_CHANNEL_DRILLDOWN_ENABLED`
   - `COMPARISON_PRODUCT_PERFORMANCE_ENABLED`
   - `COMPARISON_INVENTORY_PERFORMANCE_ENABLED`
   - `COMPARISON_CUSTOMER_ANALYSIS_ENABLED`
5. Run a complete inventory sync to capture the first real daily snapshot.

No historical inventory is fabricated. Trend coverage starts with the first snapshot created after deployment.

## Metric Dictionary

| Metric | Definition | Important exclusions |
|---|---|---|
| Net revenue | Sum of `orders.net_revenue`, falling back to gross revenue | Cancelled and zero-value orders |
| Orders | Distinct JTL order IDs | Cancelled orders |
| Average order value | Net revenue divided by order count | Returns zero when there are no orders |
| Gross margin | Revenue minus cost of goods | Cost availability depends on JTL source data |
| Units sold | Sum of order-item quantity | Cancelled orders |
| Stock cover | Current stock divided by average daily units over 30 days | Capped at 999 without demand |
| Dead stock | Stock above zero and no sale within the configured threshold | Default threshold is 90 days |
| New customer | First order falls inside the selected period | Uses synchronized customer first-order date |
| Repeat customer | More than one lifetime order | Uses synchronized customer lifetime totals |
| At-risk customer | Repeat customer with recency over 90 days | Threshold is currently fixed |

The same definitions are available at `GET /api/comparison/metric-definitions`.

## Rollback

Disable the affected comparison flag first. Existing dashboard pages remain independent. Keep the new reporting tables for investigation; do not alter JTL, sync watermarks, or failed batches.
