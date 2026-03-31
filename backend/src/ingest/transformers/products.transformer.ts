export function transformProducts(
  rows: any[],
  tenantId: string,
): { products: any[]; categories: any[] } {
  const products: any[] = [];
  const categoriesMap = new Map<number, any>();

  for (const row of rows) {
    products.push({
      tenant_id: tenantId,
      jtl_product_id: row.kArtikel,
      article_number: row.cArtNr || null,
      name: row.cName || 'Unknown',
      // kKategorie = old TS sync engine; kWarengruppe = .NET sync engine (JTL column name)
      category_id: row.kKategorie ?? row.kWarengruppe ?? null,
      ean: row.cBarcode || null,
      unit_cost: parseFloat(row.fEKNetto) || null,
      list_price_net: parseFloat(row.fVKNetto) || null,
      list_price_gross: parseFloat(row.fVKBrutto) || null,
      weight_kg:       parseFloat(row.fGewicht) || null,
      stock_quantity:  parseFloat(row.fVerfuegbar) || 0,
      jtl_modified_at: row.dMod
        ? new Date(row.dMod)
        : null,
    });

    const catKey = row.kKategorie ?? row.kWarengruppe;
    if (catKey && !categoriesMap.has(catKey)) {
      const catId = row.kKategorie ?? row.kWarengruppe;
      categoriesMap.set(catId, {
        tenant_id: tenantId,
        jtl_category_id: catId,
        name: row.category_name ?? row.categoryName ?? null,
      });
    }
  }

  return { products, categories: Array.from(categoriesMap.values()) };
}
