-- ============================================================
-- Materialized Views + refresh function
-- ============================================================

-- ── mv_monthly_kpis ──────────────────────────────────────────
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_monthly_kpis AS
SELECT
  tenant_id,
  DATE_TRUNC('month', order_date)::date          AS year_month,
  COUNT(*)                                        AS total_orders,
  SUM(gross_revenue)                              AS total_revenue,
  SUM(net_revenue)                                AS total_net_revenue,
  AVG(gross_revenue)                              AS avg_order_value,
  AVG(gross_margin)                               AS avg_margin_pct,
  COUNT(*) FILTER (WHERE status = 'returned')     AS total_returns,
  ROUND(
    COUNT(*) FILTER (WHERE status = 'returned')
    * 100.0 / NULLIF(COUNT(*), 0),
    2
  )                                               AS return_rate,
  COUNT(DISTINCT customer_id)                     AS unique_customers
FROM orders
WHERE status != 'cancelled'
GROUP BY tenant_id, DATE_TRUNC('month', order_date)::date;

CREATE UNIQUE INDEX IF NOT EXISTS uidx_mv_monthly_kpis
  ON mv_monthly_kpis (tenant_id, year_month);

-- ── mv_product_performance ───────────────────────────────────
-- NOTE: order_items.order_id stores jtl_order_id (kAuftrag).
--       order_items.product_id stores jtl_product_id (kArtikel).
--       Join on jtl_order_id / jtl_product_id — NOT the bigserial id columns.
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_product_performance AS
SELECT
  o.tenant_id,
  oi.product_id                                                   AS product_id,
  p.name                                                          AS product_name,
  p.article_number,
  c.name                                                          AS category_name,
  SUM(oi.line_total_gross)                                        AS total_revenue,
  SUM(oi.quantity)                                                AS total_units,
  AVG(
    (oi.unit_price_net - oi.unit_cost) / NULLIF(oi.unit_price_net, 0) * 100
  )                                                               AS margin_pct,
  COUNT(DISTINCT oi.order_id)                                     AS order_count,
  COUNT(*) FILTER (WHERE o.status = 'returned')                   AS return_count
FROM order_items oi
JOIN orders o   ON oi.order_id   = o.jtl_order_id   AND oi.tenant_id = o.tenant_id
JOIN products p ON oi.product_id = p.jtl_product_id  AND p.tenant_id  = o.tenant_id
LEFT JOIN categories c ON p.category_id = c.jtl_category_id AND c.tenant_id = p.tenant_id
WHERE o.status != 'cancelled'
GROUP BY o.tenant_id, oi.product_id, p.name, p.article_number, c.name;

CREATE UNIQUE INDEX IF NOT EXISTS uidx_mv_product_performance
  ON mv_product_performance (tenant_id, product_id);

-- ── mv_daily_summary ─────────────────────────────────────────
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_daily_summary AS
SELECT
  tenant_id,
  order_date                                        AS summary_date,
  COUNT(*)                                          AS total_orders,
  SUM(gross_revenue)                                AS total_revenue,
  AVG(gross_revenue)                                AS avg_order_value,
  COUNT(DISTINCT customer_id)                       AS unique_customers,
  COUNT(*) FILTER (WHERE status = 'returned')       AS total_returns,
  ROUND(
    COUNT(*) FILTER (WHERE status = 'returned')
    * 100.0 / NULLIF(COUNT(*), 0),
    2
  )                                                 AS return_rate
FROM orders
WHERE status != 'cancelled'
GROUP BY tenant_id, order_date;

CREATE UNIQUE INDEX IF NOT EXISTS uidx_mv_daily_summary
  ON mv_daily_summary (tenant_id, summary_date);

-- ── mv_inventory_summary ─────────────────────────────────────
-- NOTE: inventory.product_id is a FK to products.id that is never populated by
--       the sync engine. Use jtl_product_id for the JOIN instead.
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_inventory_summary AS
SELECT
  i.tenant_id,
  i.jtl_product_id,
  p.name                    AS product_name,
  p.article_number,
  SUM(i.available)          AS total_available,
  SUM(i.reserved)           AS total_reserved,
  BOOL_OR(i.is_low_stock)   AS is_low_stock,
  MIN(i.days_of_stock)      AS days_of_stock
FROM inventory i
JOIN products p ON i.jtl_product_id = p.jtl_product_id AND p.tenant_id = i.tenant_id
GROUP BY i.tenant_id, i.jtl_product_id, p.name, p.article_number;

CREATE UNIQUE INDEX IF NOT EXISTS uidx_mv_inventory_summary
  ON mv_inventory_summary (tenant_id, jtl_product_id);

-- ── mv_marketing_summary ─────────────────────────────────────
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_marketing_summary AS
SELECT
  tenant_id,
  platform,
  DATE_TRUNC('month', date)::date             AS month,
  SUM(spend)                                  AS total_spend,
  SUM(conversion_value)                       AS total_revenue,
  SUM(clicks)                                 AS total_clicks,
  SUM(conversions)                            AS total_conversions,
  ROUND(SUM(conversion_value) / NULLIF(SUM(spend), 0), 4)   AS roas,
  ROUND(SUM(spend) / NULLIF(SUM(clicks), 0), 4)             AS cpc
FROM marketing_metrics
GROUP BY tenant_id, platform, DATE_TRUNC('month', date)::date;

CREATE UNIQUE INDEX IF NOT EXISTS uidx_mv_marketing_summary
  ON mv_marketing_summary (tenant_id, platform, month);

-- ── refresh_all_matviews() ────────────────────────────────────
CREATE OR REPLACE FUNCTION refresh_all_matviews()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_monthly_kpis;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_product_performance;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_summary;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_inventory_summary;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_marketing_summary;
END;
$$;
