export function transformInventory(row: any, tenantId: string): any {
  const available = parseFloat(row.fVerfuegbar) || 0;
  const reserved = parseFloat(row.fReserviert) || 0;
  const total = parseFloat(row.fGesamt) || 0;
  const reorderPoint = parseFloat(row.fMindestbestand) || 0;

  return {
    tenant_id: tenantId,
    jtl_product_id: row.kArtikel,
    jtl_warehouse_id: row.kWarenLager,
    // warehouse_name = old TS sync engine; warehouseName = .NET sync engine
    warehouse_name: row.warehouse_name ?? row.warehouseName ?? null,
    available,
    reserved,
    total,
    reorder_point: reorderPoint,
    is_low_stock: available <= reorderPoint && reorderPoint > 0,
  };
}
