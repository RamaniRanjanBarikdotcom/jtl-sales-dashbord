import { postcodeToRegion } from './orders.transformer';

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
    country_code: row.cLand || 'DE',
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
