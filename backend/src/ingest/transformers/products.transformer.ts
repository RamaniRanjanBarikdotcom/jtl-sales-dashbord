type SourceRow = Record<string, unknown>;

interface TransformedProduct {
  tenant_id: string;
  jtl_product_id: unknown;
  article_number: string | null;
  name: string;
  category_id: unknown;
  ean: string | null;
  unit_cost: number | null;
  list_price_net: number | null;
  list_price_gross: number | null;
  weight_kg: number | null;
  stock_quantity: number;
  jtl_modified_at: Date | null;
}

interface TransformedCategory {
  tenant_id: string;
  jtl_category_id: unknown;
  name: string | null;
}

export function transformProducts(
  rows: SourceRow[],
  tenantId: string,
): { products: TransformedProduct[]; categories: TransformedCategory[] } {
  const products: TransformedProduct[] = [];
  const categoriesMap = new Map<string, TransformedCategory>();

  for (const row of rows) {
    products.push({
      tenant_id: tenantId,
      jtl_product_id: row.kArtikel,
      article_number: row.cArtNr != null && String(row.cArtNr).trim() !== '' ? String(row.cArtNr) : null,
      name: row.cName != null && String(row.cName).trim() !== '' ? String(row.cName) : 'Unknown',
      // kKategorie = old TS sync engine; kWarengruppe = .NET sync engine (JTL column name)
      category_id: row.kKategorie ?? row.kWarengruppe ?? null,
      ean: row.cBarcode != null && String(row.cBarcode).trim() !== '' ? String(row.cBarcode) : null,
      unit_cost:        parseFloat(String(row.fEKNetto  ?? row.fekNetto  ?? '')) || null,
      list_price_net:   parseFloat(String(row.fVKNetto  ?? row.fvkNetto  ?? '')) || null,
      list_price_gross: parseFloat(String(row.fVKBrutto ?? row.fvkBrutto ?? '')) || null,
      weight_kg:        parseFloat(String(row.fGewicht ?? '')) || null,
      stock_quantity:   parseFloat(String(row.fVerfuegbar ?? 0)) || 0,
      jtl_modified_at: row.dMod
        ? new Date(String(row.dMod))
        : null,
    });

    const catKey = row.kKategorie ?? row.kWarengruppe;
    const catKeyString = catKey == null ? '' : String(catKey);
    if (catKey != null && catKeyString !== '' && !categoriesMap.has(catKeyString)) {
      const catId = row.kKategorie ?? row.kWarengruppe;
      categoriesMap.set(catKeyString, {
        tenant_id: tenantId,
        jtl_category_id: catId,
        name: (row.category_name ?? row.categoryName ?? null) as string | null,
      });
    }
  }

  return { products, categories: Array.from(categoriesMap.values()) };
}
