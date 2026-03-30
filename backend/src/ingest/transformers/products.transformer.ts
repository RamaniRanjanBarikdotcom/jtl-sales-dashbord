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
      category_id: row.kKategorie || null,
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

    if (row.kKategorie && !categoriesMap.has(row.kKategorie)) {
      categoriesMap.set(row.kKategorie, {
        tenant_id: tenantId,
        jtl_category_id: row.kKategorie,
        name: row.category_name || null,
      });
    }
  }

  return { products, categories: Array.from(categoriesMap.values()) };
}
