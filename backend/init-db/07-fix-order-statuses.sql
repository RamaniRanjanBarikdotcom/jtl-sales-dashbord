-- ============================================================
-- Fix order statuses: mark zero-revenue orders as 'cancelled'
-- This is a one-time migration to correct orders that were
-- ingested before the status mapping was fixed.
-- After running this, trigger a full re-sync from JTL to get
-- accurate statuses from the nStatus field.
-- ============================================================

-- Orders with gross_revenue = 0 AND net_revenue = 0 are almost
-- certainly cancelled in JTL (JTL zeroes out totals on cancellation).
UPDATE orders
SET status = 'cancelled', updated_at = now()
WHERE status = 'pending'
  AND gross_revenue = 0
  AND COALESCE(net_revenue, 0) = 0;

-- Refresh materialized views so dashboard picks up the changes
REFRESH MATERIALIZED VIEW CONCURRENTLY mv_monthly_kpis;
REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_summary;
REFRESH MATERIALIZED VIEW CONCURRENTLY mv_product_performance;
