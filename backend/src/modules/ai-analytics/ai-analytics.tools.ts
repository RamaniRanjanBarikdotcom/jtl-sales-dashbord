import { DataSource } from 'typeorm';

export const PERIOD_PRESETS = [
  'today','yesterday','this_week','last_week','this_month','last_month','this_year',
] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];

export const SALES_METRIC = {
  metricDefinitionId: 'sales.net_revenue.non_cancelled_orders.v1',
  metricLabel: 'Revenue from non-cancelled orders',
  metricVersion: 1,
};

// Must stay identical to activeStatusPredicate/normalizedStatusExpr in
// sales.service.ts. If the Copilot classifies statuses differently it will
// quote figures the dashboard never shows, which the safety policy forbids.
const NON_CANCELLED = `LOWER(TRIM(COALESCE(o.status,''))) NOT IN
  ('cancelled','canceled','storniert','storno','annulliert','void','voided')`;

export interface ToolContext {
  db: DataSource;
  tenantId: string;
}

export interface ResolvedPeriod {
  preset: PeriodPreset;
  from: string;
  to: string;
  timezone: string;
  currency: string;
}

function isPreset(value: unknown): value is PeriodPreset {
  return PERIOD_PRESETS.includes(value as PeriodPreset);
}

// The pg driver hands back a JS Date for a date column, and String(Date) yields
// "Thu Jul 30 2026 00:00:00 GMT+0000 (Coordinated Universal Time)", which
// Postgres cannot cast back to date. Every tool then failed and the Copilot
// answered "not available" for every question.
export function toIsoDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0,10);
  const text = String(value);
  const match = text.match(/^\d{4}-\d{2}-\d{2}/);
  if (match) return match[0];
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) throw new Error('Unrecognised period boundary');
  return parsed.toISOString().slice(0,10);
}

export async function resolvePeriod(ctx: ToolContext, preset: unknown): Promise<ResolvedPeriod> {
  const safePreset: PeriodPreset = isPreset(preset) ? preset : 'today';
  const settings = await ctx.db.query(
    `SELECT timezone,currency FROM tenants WHERE id=$1`, [ctx.tenantId],
  );
  const timezone = settings[0]?.timezone || 'Europe/Berlin';
  // Cast to text in SQL so the boundaries arrive as 'YYYY-MM-DD' rather than as
  // driver Date objects that cannot be fed back into a ::date parameter.
  const bounds = await ctx.db.query(
    `SELECT
       (CASE $1
         WHEN 'yesterday'  THEN (now() AT TIME ZONE $2)::date - 1
         WHEN 'this_week'  THEN date_trunc('week',now() AT TIME ZONE $2)::date
         WHEN 'last_week'  THEN date_trunc('week',now() AT TIME ZONE $2)::date - 7
         WHEN 'this_month' THEN date_trunc('month',now() AT TIME ZONE $2)::date
         WHEN 'last_month' THEN (date_trunc('month',now() AT TIME ZONE $2) - interval '1 month')::date
         WHEN 'this_year'  THEN date_trunc('year',now() AT TIME ZONE $2)::date
         ELSE (now() AT TIME ZONE $2)::date END)::text AS start_date,
       (CASE $1
         WHEN 'yesterday'  THEN (now() AT TIME ZONE $2)::date - 1
         WHEN 'last_week'  THEN date_trunc('week',now() AT TIME ZONE $2)::date - 1
         WHEN 'last_month' THEN date_trunc('month',now() AT TIME ZONE $2)::date - 1
         ELSE (now() AT TIME ZONE $2)::date END)::text AS end_date`,
    [safePreset,timezone],
  );
  return {
    preset: safePreset,
    from: toIsoDate(bounds[0].start_date),
    to: toIsoDate(bounds[0].end_date),
    timezone,
    currency: settings[0]?.currency || 'EUR',
  };
}

async function freshness(ctx: ToolContext): Promise<string | null> {
  const rows = await ctx.db.query(
    `SELECT MAX(last_success_at) AS last_success_at FROM tenant_connections WHERE tenant_id=$1`,
    [ctx.tenantId],
  );
  return rows[0]?.last_success_at ?? null;
}

async function summarise(ctx: ToolContext, period: ResolvedPeriod) {
  const rows = await ctx.db.query(
    `SELECT COALESCE(SUM(o.gross_revenue),0)::numeric AS revenue,
            COUNT(o.id)::int AS orders,
            COALESCE(SUM(items.units),0)::numeric AS units
     FROM orders o
     LEFT JOIN LATERAL (
       SELECT COALESCE(SUM(oi.quantity),0) AS units
       FROM order_items oi WHERE oi.tenant_id=o.tenant_id AND oi.order_id=o.jtl_order_id
     ) items ON true
     WHERE o.tenant_id=$1 AND o.order_date BETWEEN $2::date AND $3::date AND ${NON_CANCELLED}`,
    [ctx.tenantId,period.from,period.to],
  );
  const row = rows[0] ?? {};
  const revenue = Number(row.revenue ?? 0);
  const orders = Number(row.orders ?? 0);
  return {
    revenue,
    orders,
    units: Number(row.units ?? 0),
    // No orders means there is no average to report. Reporting 0 would read as
    // "we sold something worth nothing" rather than "nothing was sold".
    averageOrderValue: orders === 0 ? null : Number((revenue / orders).toFixed(2)),
  };
}

export interface AiTool {
  name: string;
  description: string;
  permission: string;
  parameters: Record<string, unknown>;
  run: (ctx: ToolContext, args: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

function periodProperty(description: string) {
  return { type: 'string', enum: [...PERIOD_PRESETS], description };
}

export const SALES_TOOLS: AiTool[] = [
  {
    name: 'get_sales_summary',
    description: 'Total revenue, order count, units sold and average order value for one period.',
    permission: 'ai.sales.view',
    parameters: {
      type: 'object', additionalProperties: false, required: ['period'],
      properties: { period: periodProperty('The reporting period to summarise.') },
    },
    async run(ctx, args) {
      const period = await resolvePeriod(ctx,args.period);
      return {
        period, currency: period.currency, metric: SALES_METRIC,
        ...(await summarise(ctx,period)),
        freshness: await freshness(ctx),
      };
    },
  },
  {
    name: 'get_sales_trend',
    description: 'Revenue and order count broken down by day, week or month within one period.',
    permission: 'ai.sales.view',
    parameters: {
      type: 'object', additionalProperties: false, required: ['period','granularity'],
      properties: {
        period: periodProperty('The reporting period to break down.'),
        granularity: { type: 'string', enum: ['day','week','month'], description: 'Bucket size.' },
      },
    },
    async run(ctx, args) {
      const period = await resolvePeriod(ctx,args.period);
      const granularity = ['day','week','month'].includes(String(args.granularity))
        ? String(args.granularity) : 'day';
      const rows = await ctx.db.query(
        `SELECT date_trunc($4,o.order_date)::date AS bucket,
                COALESCE(SUM(o.gross_revenue),0)::numeric AS revenue,
                COUNT(o.id)::int AS orders
         FROM orders o
         WHERE o.tenant_id=$1 AND o.order_date BETWEEN $2::date AND $3::date AND ${NON_CANCELLED}
         GROUP BY bucket ORDER BY bucket`,
        [ctx.tenantId,period.from,period.to,granularity],
      );
      return {
        period, granularity, currency: period.currency, metric: SALES_METRIC,
        // Buckets are driver Dates too. String() would hand the model
        // "Wed Jul 01 2026 00:00:00 GMT+0000 (...)" for every point to reason over.
        points: rows.map((row: Record<string, unknown>) => ({
          bucket: toIsoDate(row.bucket), revenue: Number(row.revenue), orders: Number(row.orders),
        })),
        freshness: await freshness(ctx),
      };
    },
  },
  {
    name: 'compare_sales_periods',
    description: 'Compare revenue, orders and units between two periods and report the change.',
    permission: 'ai.sales.view',
    parameters: {
      type: 'object', additionalProperties: false, required: ['period','comparePeriod'],
      properties: {
        period: periodProperty('The period of interest.'),
        comparePeriod: periodProperty('The baseline period to compare against.'),
      },
    },
    async run(ctx, args) {
      const [current,baseline] = await Promise.all([
        resolvePeriod(ctx,args.period), resolvePeriod(ctx,args.comparePeriod),
      ]);
      const [currentTotals,baselineTotals] = await Promise.all([
        summarise(ctx,current), summarise(ctx,baseline),
      ]);
      // A percentage change from a zero baseline is undefined, not infinite growth.
      const change = (now: number, before: number) =>
        before === 0 ? null : Number((((now - before) / before) * 100).toFixed(2));
      return {
        currency: current.currency, metric: SALES_METRIC,
        current: { period: current, ...currentTotals },
        baseline: { period: baseline, ...baselineTotals },
        change: {
          revenuePercent: change(currentTotals.revenue,baselineTotals.revenue),
          ordersPercent: change(currentTotals.orders,baselineTotals.orders),
          revenueAbsolute: Number((currentTotals.revenue - baselineTotals.revenue).toFixed(2)),
          ordersAbsolute: currentTotals.orders - baselineTotals.orders,
        },
        freshness: await freshness(ctx),
      };
    },
  },
  {
    name: 'get_channel_sales',
    description: 'Revenue and order count grouped by sales channel for one period.',
    permission: 'ai.sales.view',
    parameters: {
      type: 'object', additionalProperties: false, required: ['period','limit'],
      properties: {
        period: periodProperty('The reporting period.'),
        limit: { type: 'integer', minimum: 1, maximum: 20, description: 'How many channels to return.' },
      },
    },
    async run(ctx, args) {
      const period = await resolvePeriod(ctx,args.period);
      const limit = Math.min(20,Math.max(1,Number(args.limit) || 10));
      const rows = await ctx.db.query(
        `SELECT COALESCE(NULLIF(o.channel,''),'Unknown') AS channel,
                COALESCE(SUM(o.gross_revenue),0)::numeric AS revenue,
                COUNT(o.id)::int AS orders
         FROM orders o
         WHERE o.tenant_id=$1 AND o.order_date BETWEEN $2::date AND $3::date AND ${NON_CANCELLED}
         GROUP BY 1 ORDER BY revenue DESC LIMIT $4`,
        [ctx.tenantId,period.from,period.to,limit],
      );
      return {
        period, currency: period.currency, metric: SALES_METRIC,
        channels: rows.map((row: Record<string, unknown>) => ({
          channel: String(row.channel), revenue: Number(row.revenue), orders: Number(row.orders),
        })),
        freshness: await freshness(ctx),
      };
    },
  },
];

export function toolsFor(permissions: string[]): AiTool[] {
  const granted = new Set(permissions);
  if (granted.has('*')) return SALES_TOOLS;
  return SALES_TOOLS.filter((tool) => granted.has(tool.permission));
}

export function findTool(name: string): AiTool | undefined {
  return SALES_TOOLS.find((tool) => tool.name === name);
}
