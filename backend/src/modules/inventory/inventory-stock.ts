export type InventoryStockValues = {
  total: number;
  available: number;
  reserved: number;
};

export function resolveInventoryStock(values: InventoryStockValues) {
  return {
    totalStock: values.total > 0 ? values.total : values.available,
    availableStock: values.available,
    reservedStock: values.reserved,
  };
}

export function inventoryAggregationSql(tenantParameter = '$1') {
  return `
    SELECT
      tenant_id,
      jtl_product_id,
      CASE
        WHEN COALESCE(SUM(total), 0) > 0 THEN COALESCE(SUM(total), 0)
        ELSE COALESCE(SUM(available), 0)
      END AS total_available,
      COALESCE(SUM(available), 0) AS on_hand_available,
      COALESCE(SUM(reserved), 0) AS total_reserved,
      COALESCE(MAX(reorder_point), 0) AS reorder_point
    FROM inventory
    WHERE tenant_id = ANY(${tenantParameter}::uuid[])
    GROUP BY tenant_id, jtl_product_id
  `;
}

export function inventoryJoinSql(
  inventoryAlias: string,
  productAlias: string,
) {
  return `${inventoryAlias}.tenant_id = ${productAlias}.tenant_id
    AND ${inventoryAlias}.jtl_product_id = ${productAlias}.jtl_product_id`;
}
