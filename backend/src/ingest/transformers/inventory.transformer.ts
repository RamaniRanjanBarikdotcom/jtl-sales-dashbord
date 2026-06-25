type SourceRow = Record<string, unknown>;
type TransformedInventory = Record<string, unknown>;

export function transformInventory(row: SourceRow, tenantId: string): TransformedInventory {
  const available = parseFloat(String(row.fVerfuegbar ?? 0)) || 0;
  const reserved = parseFloat(String(row.fReserviert ?? 0)) || 0;
  const total = parseFloat(String(row.fGesamt ?? 0)) || 0;
  const reorderPoint = parseFloat(String(row.fMindestbestand ?? 0)) || 0;

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
