// German display-name → internal status
const STATUS_MAP: Record<string, string> = {
  Offen: 'pending',
  'In Bearbeitung': 'processing',
  Versandt: 'shipped',
  Teilversandt: 'shipped',
  Abgeschlossen: 'delivered',
  Storniert: 'cancelled',
  Retour: 'returned',
};

// JTL Wawi numeric nStatus codes → internal status
const NUMERIC_STATUS_MAP: Record<number, string> = {
  [-1]: 'cancelled',
  1: 'pending',
  2: 'processing',
  3: 'shipped',
  4: 'delivered',
  5: 'shipped',       // Teilversandt (partially shipped)
  6: 'returned',
};

function resolveStatus(row: Record<string, unknown>): string {
  // 0) Check nStorno flag — .NET sync engine sets this to 1 for cancelled orders
  const nStorno = row.nStorno ?? row.nstorno;
  if (nStorno === 1 || nStorno === '1' || nStorno === true) return 'cancelled';

  // 1) Try numeric nStatus first (most reliable from JTL Wawi)
  const nStatus = row.nStatus ?? row.nstatus ?? row.Nstatus;
  if (nStatus != null) {
    const num = Number(nStatus);
    if (!isNaN(num) && NUMERIC_STATUS_MAP[num] !== undefined) {
      return NUMERIC_STATUS_MAP[num];
    }
  }

  // 2) Try German text cStatus / Status
  const cStatus = String(row.cStatus ?? row.Status ?? row.status ?? '').trim();
  if (cStatus && STATUS_MAP[cStatus]) {
    return STATUS_MAP[cStatus];
  }

  // 3) Try case-insensitive match on common English status words
  const lower = cStatus.toLowerCase();
  if (lower === 'cancelled' || lower === 'canceled' || lower === 'storniert') return 'cancelled';
  if (lower === 'returned' || lower === 'retour') return 'returned';
  if (lower === 'shipped' || lower === 'versandt') return 'shipped';
  if (lower === 'delivered' || lower === 'abgeschlossen' || lower === 'completed') return 'delivered';
  if (lower === 'processing' || lower === 'in bearbeitung') return 'processing';

  return 'pending';
}

type SourceRow = Record<string, unknown>;
type TransformedOrder = Record<string, unknown>;

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

export function transformOrders(row: SourceRow, tenantId: string): TransformedOrder {
  // Support both old TS sync engine (kBestellung/cBestellNr/snake_case names)
  // and new .NET sync engine (kAuftrag/cAuftragsNr/camelCase names)
  const jtlOrderId    = row.kBestellung    ?? row.kAuftrag;
  const orderNumber   = row.cBestellNr     ?? row.cAuftragsNr;
  const channelName   = String(row.channel_name   ?? row.channelName   ?? 'direct');
  const zahlungsart   = row.zahlungsart_name ?? row.zahlungsartName ?? null;
  const versandart    = row.versandart_name  ?? row.versandartName  ?? null;
  const postcode      = String(row.cPLZ || row.cplz || '');
  const city          = String(row.cOrt  || row.cort  || '');
  const country       = String(row.cLand || row.cland || '');
  const gross         = parseFloat(String(row.fGesamtsumme ?? 0)) || 0;
  // Use actual net from JTL if available (fGesamtsummeNetto from .NET engine), else compute
  const net           = parseFloat(String(row.fGesamtsummeNetto ?? 0)) || +(gross / 1.19).toFixed(2);
  // JTL returns full name "Deutschland" — treat as Germany for region logic
  const countryLower  = country.toLowerCase().trim();
  const isGermany     = !country || countryLower === '' || countryLower === 'de'
                        || countryLower === 'deutschland' || countryLower === 'germany';
  return {
    tenant_id:            tenantId,
    jtl_order_id:         jtlOrderId,
    order_number:         orderNumber,
    order_date:           row.dErstellt ? new Date(String(row.dErstellt)) : new Date(),
    customer_id:          row.kKunde || null,
    gross_revenue:        gross,
    net_revenue:          net,
    shipping_cost:        parseFloat(String(row.fVersandkostenNetto ?? 0)) || 0,
    status:               resolveStatus(row),
    channel:              channelName.toLowerCase(),
    postcode:             postcode,
    city:                 city,
    country:              country,
    region:               isGermany ? postcodeToRegion(postcode) : 'International',
    // JTL's tAuftrag has no dGeaendert column — fall back to dErstellt (has time-of-day)
    // so the heatmap query can extract the hour of order creation.
    jtl_modified_at:      row.dGeaendert
                            ? new Date(String(row.dGeaendert))
                            : (row.dErstellt ? new Date(String(row.dErstellt)) : null),
    external_order_number: row.cExterneAuftragsnummer || null,
    customer_number:      row.cKundenNr || null,
    payment_method:       zahlungsart,
    shipping_method:      versandart,
  };
}
