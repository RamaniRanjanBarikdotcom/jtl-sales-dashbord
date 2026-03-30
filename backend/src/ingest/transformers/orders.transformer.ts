const STATUS_MAP: Record<string, string> = {
  Offen: 'pending',
  'In Bearbeitung': 'processing',
  Versandt: 'shipped',
  Abgeschlossen: 'delivered',
  Storniert: 'cancelled',
  Retour: 'returned',
};

export function postcodeToRegion(postcode: string): string {
  if (!postcode) return 'International';
  const prefix = parseInt(postcode.slice(0, 2), 10);
  if (isNaN(prefix)) return 'International';
  if (prefix <= 19) return 'North-East';
  if (prefix <= 29) return 'North';
  if (prefix <= 39) return 'Central-North';
  if (prefix <= 59) return 'West';
  if (prefix <= 69) return 'Central-West';
  if (prefix <= 79) return 'South-West';
  if (prefix <= 89) return 'South';
  if (prefix <= 99) return 'South-East';
  return 'International';
}

export function transformOrders(row: any, tenantId: string): any {
  const vatRate = 0.19;
  const gross = parseFloat(row.fGesamtsumme) || 0;
  return {
    tenant_id: tenantId,
    jtl_order_id: row.kBestellung,
    order_number: row.cBestellNr,
    order_date: row.dErstellt ? new Date(row.dErstellt) : new Date(),
    customer_id: row.kKunde || null,
    gross_revenue: gross,
    net_revenue: +(gross / (1 + vatRate)).toFixed(2),
    shipping_cost: parseFloat(row.fVersandkostenNetto) || 0,
    status: STATUS_MAP[row.cStatus] || row.cStatus || 'pending',
    channel: (row.channel_name || 'direct').toLowerCase(),
    postcode: row.cPLZ || '',
    region: postcodeToRegion(row.cPLZ || ''),
    jtl_modified_at:        row.dGeaendert ? new Date(row.dGeaendert) : null,
    external_order_number:  row.cExterneAuftragsnummer || null,
    customer_number:        row.cKundenNr || null,
    payment_method:         row.zahlungsart_name || null,
    shipping_method:        row.versandart_name || null,
  };
}
