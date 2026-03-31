import { postcodeToRegion } from './orders.transformer';

const COUNTRY_NAME_TO_ISO: Record<string, string> = {
  deutschland: 'DE',
  germany: 'DE',
  österreich: 'AT',
  oesterreich: 'AT',
  austria: 'AT',
  schweiz: 'CH',
  switzerland: 'CH',
  frankreich: 'FR',
  france: 'FR',
  italien: 'IT',
  italy: 'IT',
  spanien: 'ES',
  spain: 'ES',
  niederlande: 'NL',
  netherlands: 'NL',
  belgien: 'BE',
  belgium: 'BE',
  polen: 'PL',
  poland: 'PL',
  tschechien: 'CZ',
  'tschechische republik': 'CZ',
  'czech republic': 'CZ',
  ungarn: 'HU',
  hungary: 'HU',
  rumänien: 'RO',
  romania: 'RO',
  luxemburg: 'LU',
  luxembourg: 'LU',
  dänemark: 'DK',
  denmark: 'DK',
  schweden: 'SE',
  sweden: 'SE',
  finnland: 'FI',
  finland: 'FI',
  norwegen: 'NO',
  norway: 'NO',
  portugal: 'PT',
  griechenland: 'GR',
  greece: 'GR',
  slowakei: 'SK',
  slovakia: 'SK',
  slowenien: 'SI',
  slovenia: 'SI',
  kroatien: 'HR',
  croatia: 'HR',
  bulgarien: 'BG',
  bulgaria: 'BG',
  litauen: 'LT',
  lithuania: 'LT',
  lettland: 'LV',
  latvia: 'LV',
  estland: 'EE',
  estonia: 'EE',
  irland: 'IE',
  ireland: 'IE',
  'vereinigtes königreich': 'GB',
  'united kingdom': 'GB',
  grossbritannien: 'GB',
  'great britain': 'GB',
  'vereinigte staaten': 'US',
  'united states': 'US',
  usa: 'US',
  kanada: 'CA',
  canada: 'CA',
  australien: 'AU',
  australia: 'AU',
  japan: 'JP',
  china: 'CN',
  russland: 'RU',
  russia: 'RU',
  türkei: 'TR',
  turkey: 'TR',
};

function countryToIso(cLand: string | null | undefined): string {
  if (!cLand) return 'DE';
  const trimmed = cLand.trim();
  // Already a 2-letter ISO code
  if (/^[A-Z]{2}$/.test(trimmed)) return trimmed;
  // Try lookup by lowercase
  const iso = COUNTRY_NAME_TO_ISO[trimmed.toLowerCase()];
  if (iso) return iso;
  // Fall back to first 2 chars uppercased if they look like letters
  if (/^[a-zA-Z]{2}/.test(trimmed)) return trimmed.slice(0, 2).toUpperCase();
  return 'DE';
}

function calcRfmScore(
  daysSinceLastOrder: number,
  totalOrders: number,
  ltv: number,
): string {
  // Recency
  let r = 1;
  if (daysSinceLastOrder <= 30) r = 5;
  else if (daysSinceLastOrder <= 90) r = 4;
  else if (daysSinceLastOrder <= 180) r = 3;
  else if (daysSinceLastOrder <= 365) r = 2;

  // Frequency
  let f = 1;
  if (totalOrders >= 20) f = 5;
  else if (totalOrders >= 10) f = 4;
  else if (totalOrders >= 5) f = 3;
  else if (totalOrders >= 2) f = 2;

  // Monetary
  let m = 1;
  if (ltv >= 10000) m = 5;
  else if (ltv >= 5000) m = 4;
  else if (ltv >= 2000) m = 3;
  else if (ltv >= 500) m = 2;

  return `${r}${f}${m}`;
}

function assignSegment(
  rfm: string,
  ltv: number,
  totalOrders: number,
): string {
  const r = parseInt(rfm[0]);
  const f = parseInt(rfm[1]);

  if (r === 1) return 'Churned';
  if (r === 2) return 'At-Risk';
  if (ltv >= 5000 && r >= 4) return 'VIP';
  if (ltv >= 1000 && f >= 3) return 'Regular';
  if (f === 1 && r >= 4) return 'New';
  return 'Casual';
}

export function transformCustomers(row: any, tenantId: string): any {
  const totalOrders = parseInt(row.total_orders) || 0;
  const totalRevenue = parseFloat(row.total_revenue) || 0;
  const lastOrderDate = row.last_order_date
    ? new Date(row.last_order_date)
    : null;
  const today = new Date();
  const daysSince = lastOrderDate
    ? Math.floor(
        (today.getTime() - lastOrderDate.getTime()) / (1000 * 60 * 60 * 24),
      )
    : null;

  const ltv = totalRevenue;
  const rfm =
    daysSince !== null
      ? calcRfmScore(daysSince, totalOrders, ltv)
      : null;
  const segment =
    rfm ? assignSegment(rfm, ltv, totalOrders) : null;

  return {
    tenant_id: tenantId,
    jtl_customer_id: row.kKunde,
    email: row.cMail || null,
    first_name: row.cVorname || null,
    last_name: row.cNachname || null,
    company: row.cFirma || null,
    postcode: row.cPLZ || null,
    city: row.cOrt || null,
    country_code: countryToIso(row.cLand),
    region: postcodeToRegion(row.cPLZ || ''),
    total_orders: totalOrders,
    total_revenue: totalRevenue,
    ltv,
    days_since_last_order: daysSince,
    rfm_score: rfm,
    segment,
    jtl_modified_at: row.dGeaendert
      ? new Date(row.dGeaendert)
      : null,
  };
}
