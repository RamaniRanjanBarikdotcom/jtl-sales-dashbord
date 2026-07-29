-- Tenant-integrity migration for existing databases.
-- Orders are partitioned by order_date, so PostgreSQL cannot create a native
-- UNIQUE (tenant_id, jtl_order_id) constraint on the partitioned parent.

CREATE UNIQUE INDEX IF NOT EXISTS uq_products_tenant_jtl_product
  ON products (tenant_id, jtl_product_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_tenant_jtl_customer
  ON customers (tenant_id, jtl_customer_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_tenant_product_warehouse
  ON inventory (tenant_id, jtl_product_id, jtl_warehouse_id);

CREATE INDEX IF NOT EXISTS idx_orders_tenant_jtl_order
  ON orders (tenant_id, jtl_order_id);

CREATE OR REPLACE FUNCTION prevent_duplicate_tenant_jtl_order()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended(NEW.tenant_id::text || ':' || NEW.jtl_order_id::text, 0)
  );

  IF EXISTS (
    SELECT 1
    FROM orders existing
    WHERE existing.tenant_id = NEW.tenant_id
      AND existing.jtl_order_id = NEW.jtl_order_id
      AND (TG_OP = 'INSERT' OR existing.id <> NEW.id)
  ) THEN
    RAISE EXCEPTION
      'duplicate JTL order ID % for tenant %',
      NEW.jtl_order_id,
      NEW.tenant_id
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orders_tenant_jtl_unique ON orders;

CREATE TRIGGER trg_orders_tenant_jtl_unique
BEFORE INSERT OR UPDATE OF tenant_id, jtl_order_id
ON orders
FOR EACH ROW
EXECUTE FUNCTION prevent_duplicate_tenant_jtl_order();
