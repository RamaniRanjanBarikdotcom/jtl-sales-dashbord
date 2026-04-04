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
  // Support both old TS sync engine (kBestellung/cBestellNr/snake_case names)
  // and new .NET sync engine (kAuftrag/cAuftragsNr/camelCase names)
  const jtlOrderId    = row.kBestellung    ?? row.kAuftrag;
  const orderNumber   = row.cBestellNr     ?? row.cAuftragsNr;
  const channelName   = row.channel_name   ?? row.channelName   ?? 'direct';
  const zahlungsart   = row.zahlungsart_name ?? row.zahlungsartName ?? null;
  const versandart    = row.versandart_name  ?? row.versandartName  ?? null;
  const postcode      = row.cPLZ || '';
  const gross         = parseFloat(row.fGesamtsumme) || 0;
  // Use actual net from JTL if available (fGesamtsummeNetto from .NET engine), else compute
  const net           = parseFloat(row.fGesamtsummeNetto) || +(gross / 1.19).toFixed(2);
  return {
    tenant_id:            tenantId,
    jtl_order_id:         jtlOrderId,
    order_number:         orderNumber,
    order_date:           row.dErstellt ? new Date(row.dErstellt) : new Date(),
    customer_id:          row.kKunde || null,
    gross_revenue:        gross,
    net_revenue:          net,
    shipping_cost:        parseFloat(row.fVersandkostenNetto) || 0,
    status:               STATUS_MAP[row.cStatus] || 'pending',
    channel:              channelName.toLowerCase(),
    postcode:             postcode,
    region:               postcodeToRegion(postcode),
    // JTL's tAuftrag has no dGeaendert column — fall back to dErstellt (has time-of-day)
    // so the heatmap query can extract the hour of order creation.
    jtl_modified_at:      row.dGeaendert
                            ? new Date(row.dGeaendert)
                            : (row.dErstellt ? new Date(row.dErstellt) : null),
    external_order_number: row.cExterneAuftragsnummer || null,
    customer_number:      row.cKundenNr || null,
    payment_method:       zahlungsart,
    shipping_method:      versandart,
  };
}
