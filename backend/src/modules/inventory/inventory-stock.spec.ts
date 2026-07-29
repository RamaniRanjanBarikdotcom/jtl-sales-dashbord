import {
  inventoryAggregationSql,
  inventoryJoinSql,
  resolveInventoryStock,
} from './inventory-stock';

describe('canonical inventory stock', () => {
  it.each([
    [{ available: 3, reserved: 2, total: 5 }, 5],
    [{ available: 4, reserved: 2, total: 6 }, 6],
    [{ available: 4, reserved: 2, total: 0 }, 4],
  ])('uses total stock and preserves component values', (values, expectedTotal) => {
    expect(resolveInventoryStock(values)).toEqual({
      totalStock: expectedTotal,
      availableStock: values.available,
      reservedStock: values.reserved,
    });
  });

  it('aggregates independently per tenant and product', () => {
    const sql = inventoryAggregationSql('$7');
    expect(sql).toContain('WHERE tenant_id = ANY($7::uuid[])');
    expect(sql).toContain('GROUP BY tenant_id, jtl_product_id');
  });

  it('joins inventory to products through tenant and JTL product identity', () => {
    expect(inventoryJoinSql('inv', 'p')).toContain(
      'inv.tenant_id = p.tenant_id',
    );
    expect(inventoryJoinSql('inv', 'p')).toContain(
      'inv.jtl_product_id = p.jtl_product_id',
    );
  });
});
