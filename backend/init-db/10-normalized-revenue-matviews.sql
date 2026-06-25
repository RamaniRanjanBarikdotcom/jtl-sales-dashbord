-- ============================================================
-- Normalize revenue/order matviews so totals exclude cancelled
-- order aliases while cancelled revenue remains separate.
-- Safe to rerun.
-- ============================================================

CREATE OR REPLACE FUNCTION normalized_order_status(raw_status text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN LOWER(TRIM(COALESCE(raw_status, ''))) IN (
      'cancelled', 'canceled', 'storno', 'storniert', 'annulliert', 'void', 'voided'
    ) THEN 'cancelled'
    WHEN LOWER(TRIM(COALESCE(raw_status, ''))) IN (
      'returned', 'retour', 'retoure', 'retourniert', 'refund', 'refunded'
    ) THEN 'returned'
    WHEN LOWER(TRIM(COALESCE(raw_status, ''))) IN ('', 'unknown', 'n/a', '-') THEN 'unknown'
    ELSE LOWER(TRIM(COALESCE(raw_status, '')))
  END
$$;

DROP MATERIALIZED VIEW IF EXISTS mv_product_performance;
DROP MATERIALIZED VIEW IF EXISTS mv_monthly_kpis;
DROP MATERIALIZED VIEW IF EXISTS mv_daily_summary;

CREATE MATERIALIZED VIEW mv_monthly_kpis AS
SELECT
  tenant_id,
  DATE_TRUNC('month', order_date)::date AS year_month,
  COUNT(*) FILTER (WHERE normalized_order_status(status) <> 'cancelled') AS total_orders,
  COALESCE(SUM(gross_revenue) FILTER (WHERE normalized_order_status(status) <> 'cancelled'), 0) AS total_revenue,
  COALESCE(SUM(net_revenue) FILTER (WHERE normalized_order_status(status) <> 'cancelled'), 0) AS total_net_revenue,
  COALESCE(AVG(gross_revenue) FILTER (WHERE normalized_order_status(status) <> 'cancelled'), 0) AS avg_order_value,
  COALESCE(AVG(gross_margin) FILTER (WHERE normalized_order_status(status) <> 'cancelled'), 0) AS avg_margin_pct,
  COUNT(*) FILTER (WHERE normalized_order_status(status) = 'returned') AS total_returns,
  COALESCE(
    ROUND(
      COUNT(*) FILTER (WHERE normalized_order_status(status) = 'returned')
      * 100.0 / NULLIF(COUNT(*) FILTER (WHERE normalized_order_status(status) <> 'cancelled'), 0),
      2
    ),
    0
  ) AS return_rate,
  COUNT(DISTINCT customer_id) FILTER (WHERE normalized_order_status(status) <> 'cancelled') AS unique_customers
FROM orders
GROUP BY tenant_id, DATE_TRUNC('month', order_date)::date;

CREATE UNIQUE INDEX IF NOT EXISTS uidx_mv_monthly_kpis
  ON mv_monthly_kpis (tenant_id, year_month);

CREATE MATERIALIZED VIEW mv_product_performance AS
SELECT
  o.tenant_id,
  oi.product_id AS product_id,
  p.name AS product_name,
  p.article_number,
  c.name AS category_name,
  COALESCE(
    SUM(oi.line_total_gross) FILTER (WHERE normalized_order_status(o.status) <> 'cancelled'),
    0
  ) AS total_revenue,
  COALESCE(
    SUM(oi.quantity) FILTER (WHERE normalized_order_status(o.status) <> 'cancelled'),
    0
  ) AS total_units,
  COALESCE(
    AVG((oi.unit_price_net - oi.unit_cost) / NULLIF(oi.unit_price_net, 0) * 100)
      FILTER (WHERE normalized_order_status(o.status) <> 'cancelled'),
    0
  ) AS margin_pct,
  COUNT(DISTINCT oi.order_id) FILTER (WHERE normalized_order_status(o.status) <> 'cancelled') AS order_count,
  COUNT(*) FILTER (WHERE normalized_order_status(o.status) = 'returned') AS return_count
FROM order_items oi
JOIN orders o ON oi.order_id = o.jtl_order_id AND oi.tenant_id = o.tenant_id
JOIN products p ON oi.product_id = p.jtl_product_id AND p.tenant_id = o.tenant_id
LEFT JOIN categories c ON p.category_id = c.jtl_category_id AND c.tenant_id = p.tenant_id
GROUP BY o.tenant_id, oi.product_id, p.name, p.article_number, c.name;

CREATE UNIQUE INDEX IF NOT EXISTS uidx_mv_product_performance
  ON mv_product_performance (tenant_id, product_id);

CREATE MATERIALIZED VIEW mv_daily_summary AS
SELECT
  tenant_id,
  order_date AS summary_date,
  COUNT(*) FILTER (WHERE normalized_order_status(status) <> 'cancelled') AS total_orders,
  COALESCE(SUM(gross_revenue) FILTER (WHERE normalized_order_status(status) <> 'cancelled'), 0) AS total_revenue,
  COALESCE(AVG(gross_revenue) FILTER (WHERE normalized_order_status(status) <> 'cancelled'), 0) AS avg_order_value,
  COUNT(DISTINCT customer_id) FILTER (WHERE normalized_order_status(status) <> 'cancelled') AS unique_customers,
  COUNT(*) FILTER (WHERE normalized_order_status(status) = 'returned') AS total_returns,
  COALESCE(
    ROUND(
      COUNT(*) FILTER (WHERE normalized_order_status(status) = 'returned')
      * 100.0 / NULLIF(COUNT(*) FILTER (WHERE normalized_order_status(status) <> 'cancelled'), 0),
      2
    ),
    0
  ) AS return_rate
FROM orders
GROUP BY tenant_id, order_date;

CREATE UNIQUE INDEX IF NOT EXISTS uidx_mv_daily_summary
  ON mv_daily_summary (tenant_id, summary_date);

CREATE OR REPLACE FUNCTION refresh_all_matviews()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_monthly_kpis;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_product_performance;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_summary;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_inventory_summary;
END;
$$;
