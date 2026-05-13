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

-- sync_log
CREATE INDEX IF NOT EXISTS idx_sync_log_status            ON sync_log (tenant_id, status, started_at DESC);

-- sync_watermarks
CREATE INDEX IF NOT EXISTS idx_watermarks_tenant_job      ON sync_watermarks (tenant_id, job_name);

-- tenant_connections
CREATE INDEX IF NOT EXISTS idx_tenant_conn_active         ON tenant_connections (tenant_id, is_active);
CREATE INDEX IF NOT EXISTS idx_role_permissions_role      ON role_permissions (role);
CREATE INDEX IF NOT EXISTS idx_user_permissions_user      ON user_permissions (user_id);

-- ── Scalability: jtl ID lookups (order_items joins on these) ─────────────────
CREATE INDEX IF NOT EXISTS idx_orders_jtl_order_id        ON orders (tenant_id, jtl_order_id);
CREATE INDEX IF NOT EXISTS idx_products_jtl_product_id    ON products (tenant_id, jtl_product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_jtl_product_id   ON inventory (tenant_id, jtl_product_id);

-- ── Scalability: customer stats recomputation (recomputeCustomerStats query) ─
CREATE INDEX IF NOT EXISTS idx_orders_customer_id         ON orders (tenant_id, customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customers_jtl_id           ON customers (tenant_id, jtl_customer_id);

-- ── Scalability: GIN trigram indexes for ILIKE search on large tables ────────
CREATE INDEX IF NOT EXISTS idx_orders_order_number_trgm   ON orders   USING gin (order_number gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_products_name_trgm         ON products USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_customers_email_trgm       ON customers USING gin (email gin_trgm_ops);

-- ── Additional high-cardinality filters/sorts used by dashboard APIs ────────
CREATE INDEX IF NOT EXISTS idx_orders_tenant_date_channel  ON orders (tenant_id, order_date DESC, channel);
CREATE INDEX IF NOT EXISTS idx_orders_tenant_date_region   ON orders (tenant_id, order_date DESC, region);
CREATE INDEX IF NOT EXISTS idx_orders_tenant_ordernr       ON orders (tenant_id, order_number);
CREATE INDEX IF NOT EXISTS idx_products_tenant_name        ON products (tenant_id, name);
CREATE INDEX IF NOT EXISTS idx_products_tenant_article     ON products (tenant_id, article_number);
CREATE INDEX IF NOT EXISTS idx_inventory_tenant_wh         ON inventory (tenant_id, jtl_warehouse_id);
