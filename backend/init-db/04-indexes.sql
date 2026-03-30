-- ============================================================
-- Additional indexes for query performance
-- ============================================================

-- products
CREATE INDEX IF NOT EXISTS idx_products_tenant            ON products (tenant_id);
CREATE INDEX IF NOT EXISTS idx_products_tenant_active     ON products (tenant_id, is_active);
CREATE INDEX IF NOT EXISTS idx_products_category          ON products (tenant_id, category_id);

-- categories
CREATE INDEX IF NOT EXISTS idx_categories_tenant          ON categories (tenant_id);
CREATE INDEX IF NOT EXISTS idx_categories_parent          ON categories (parent_id);

-- customers
CREATE INDEX IF NOT EXISTS idx_customers_tenant           ON customers (tenant_id);
CREATE INDEX IF NOT EXISTS idx_customers_tenant_segment   ON customers (tenant_id, segment);
CREATE INDEX IF NOT EXISTS idx_customers_email            ON customers (tenant_id, email);

-- inventory
CREATE INDEX IF NOT EXISTS idx_inventory_tenant           ON inventory (tenant_id);
CREATE INDEX IF NOT EXISTS idx_inventory_low_stock        ON inventory (tenant_id, is_low_stock) WHERE is_low_stock = true;
CREATE INDEX IF NOT EXISTS idx_inventory_product          ON inventory (tenant_id, jtl_product_id);

-- marketing
CREATE INDEX IF NOT EXISTS idx_mktg_campaigns_tenant      ON marketing_campaigns (tenant_id);
CREATE INDEX IF NOT EXISTS idx_mktg_campaigns_platform    ON marketing_campaigns (tenant_id, platform);
CREATE INDEX IF NOT EXISTS idx_mktg_metrics_tenant_date   ON marketing_metrics (tenant_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_mktg_metrics_campaign      ON marketing_metrics (tenant_id, campaign_id);

-- sync_log
CREATE INDEX IF NOT EXISTS idx_sync_log_status            ON sync_log (tenant_id, status, started_at DESC);

-- sync_watermarks
CREATE INDEX IF NOT EXISTS idx_watermarks_tenant_job      ON sync_watermarks (tenant_id, job_name);

-- tenant_connections
CREATE INDEX IF NOT EXISTS idx_tenant_conn_active         ON tenant_connections (tenant_id, is_active);
