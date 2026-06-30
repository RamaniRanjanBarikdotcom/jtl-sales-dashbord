type SourceRow = Record<string, unknown>;
type TransformedInventory = Record<string, unknown>;

function numeric(row: SourceRow, keys: string[], fallback = 0): number {
  for (const key of keys) {
    const value = row[key];
    if (value === null || value === undefined || value === '') continue;
    const parsed = Number.parseFloat(String(value));
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function firstValue(row: SourceRow, keys: string[]): unknown {
  for (const key of keys) {
    const value = row[key];
    if (value !== null && value !== undefined && value !== '') return value;
  }
  return null;
}

export function transformInventory(row: SourceRow, tenantId: string): TransformedInventory {
  const available = numeric(row, ['available', 'Available', 'fVerfuegbar', 'FVerfuegbar']);
  const reserved = numeric(row, ['reserved', 'Reserved', 'fReserviert', 'FReserviert']);
  const total = numeric(row, ['total', 'Total', 'fGesamt', 'FGesamt'], available + reserved);
  const reorderPoint = numeric(row, [
    'reorder_point',
    'reorderPoint',
    'ReorderPoint',
    'fMindestbestand',
    'FMindestbestand',
  ]);

  return {
    tenant_id: tenantId,
    jtl_product_id: firstValue(row, ['jtl_product_id', 'jtlProductId', 'JtlProductId', 'kArtikel', 'KArtikel']),
    jtl_warehouse_id: firstValue(row, [
      'jtl_warehouse_id',
      'jtlWarehouseId',
      'JtlWarehouseId',
      'kWarenLager',
      'KWarenLager',
    ]),
    // warehouse_name = old TS sync engine; warehouseName = .NET sync engine
    warehouse_name: firstValue(row, ['warehouse_name', 'warehouseName', 'WarehouseName']),
    available,
    reserved,
    total,
    reorder_point: reorderPoint,
    is_low_stock: available <= reorderPoint && reorderPoint > 0,
  };
}
