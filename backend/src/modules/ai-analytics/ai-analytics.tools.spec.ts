import { readFileSync } from 'fs';
import { join } from 'path';
import { PERIOD_PRESETS, SALES_TOOLS, findTool, toIsoDate, toolsFor } from './ai-analytics.tools';

const TOOLS_SQL = readFileSync(join(__dirname,'ai-analytics.tools.ts'),'utf8');

function ctx(rows: Record<string, unknown>[] = [{}]) {
  const db = { query: jest.fn().mockResolvedValue(rows) };
  return { db, ctx: { db: db as never, tenantId: 'tenant-a' } };
}

describe('sales tools', () => {
  it('exposes no tool that could execute caller-supplied SQL', () => {
    const forbidden = ['execute_sql','run_query','query_database','generate_sql','run_postgres'];
    for (const name of forbidden) expect(findTool(name)).toBeUndefined();
    for (const tool of SALES_TOOLS) expect(tool.parameters).toHaveProperty('additionalProperties',false);
  });

  it('accepts only the enumerated period presets as arguments', () => {
    for (const tool of SALES_TOOLS) {
      const period = (tool.parameters as any).properties?.period;
      if (period) expect(period.enum).toEqual([...PERIOD_PRESETS]);
    }
  });

  it('classifies cancelled orders exactly as the sales dashboard does', () => {
    // Drift here means the Copilot quotes revenue the dashboard never shows.
    const statuses = (source: string) =>
      source.match(/IN\s*\(\s*'cancelled'[^)]*\)/)![0]
        .match(/'([a-z]+)'/g)!.map((token) => token.replace(/'/g,'')).sort();
    const dashboard = statuses(readFileSync(join(__dirname,'..','sales','sales.service.ts'),'utf8'));
    expect(statuses(TOOLS_SQL)).toEqual(dashboard);
    expect(dashboard).toContain('annulliert');
  });

  it('falls back to a safe preset when the model sends an unknown period', async () => {
    const { db, ctx: context } = ctx([{ timezone: 'Europe/Berlin', currency: 'EUR', start_date: '2026-07-29', end_date: '2026-07-29' }]);
    const { resolvePeriod } = await import('./ai-analytics.tools');
    const period = await resolvePeriod(context,"'; DROP TABLE orders; --");
    expect(period.preset).toBe('today');
    expect(db.query.mock.calls[1][1][0]).toBe('today');
  });

  describe('period boundaries', () => {
    // The pg driver returns a Date for a date column. String(Date) produced
    // "Thu Jul 30 2026 00:00:00 GMT+0000 (Coordinated Universal Time)", which
    // Postgres rejects as a ::date parameter, so every tool call failed.
    it('normalises a driver Date into a value Postgres accepts', () => {
      const midnight = new Date(Date.UTC(2026,6,30));
      expect(String(midnight)).not.toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(toIsoDate(midnight)).toBe('2026-07-30');
      expect(toIsoDate('2026-07-30')).toBe('2026-07-30');
      expect(toIsoDate('2026-07-30T00:00:00.000Z')).toBe('2026-07-30');
    });

    it('rejects a boundary it cannot parse instead of passing junk to SQL', () => {
      expect(() => toIsoDate('not a date')).toThrow();
    });

    it('selects the boundaries as text so the driver cannot hand back a Date', () => {
      const selects = TOOLS_SQL.match(/END\)::text AS (start_date|end_date)/g) ?? [];
      expect(selects).toHaveLength(2);
    });

    it('feeds plain YYYY-MM-DD dates into the data query', async () => {
      const db = { query: jest.fn() };
      db.query
        .mockResolvedValueOnce([{ timezone: 'Europe/Berlin', currency: 'EUR' }])
        // Mirrors the real driver returning Date objects.
        .mockResolvedValueOnce([{ start_date: new Date(Date.UTC(2026,6,30)), end_date: new Date(Date.UTC(2026,6,30)) }])
        .mockResolvedValueOnce([{ revenue: 0, orders: 0, units: 0 }])
        .mockResolvedValueOnce([{ last_success_at: null }]);
      const result = await findTool('get_sales_summary')!.run({ db: db as never, tenantId: 'tenant-a' },{ period: 'today' });
      expect(result.period).toMatchObject({ from: '2026-07-30', to: '2026-07-30' });
      const dataCall = db.query.mock.calls.find((call) => String(call[0]).includes('FROM orders o'))!;
      for (const bound of [dataCall[1][1],dataCall[1][2]]) expect(bound).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('sends the model plain dates for trend buckets, not Date.toString output', async () => {
      const db = { query: jest.fn() };
      db.query
        .mockResolvedValueOnce([{ timezone: 'Europe/Berlin', currency: 'EUR' }])
        .mockResolvedValueOnce([{ start_date: '2026-07-01', end_date: '2026-07-31' }])
        // date_trunc(...)::date comes back as a Date, exactly like the boundaries.
        .mockResolvedValueOnce([{ bucket: new Date(Date.UTC(2026,6,1)), revenue: 10, orders: 2 }])
        .mockResolvedValueOnce([{ last_success_at: null }]);
      const result = await findTool('get_sales_trend')!.run(
        { db: db as never, tenantId: 'tenant-a' },{ period: 'this_month', granularity: 'day' },
      );
      expect((result.points as Array<{ bucket: string }>)[0].bucket).toBe('2026-07-01');
    });
  });

  it('reports no average order value rather than zero when nothing sold', async () => {
    const { ctx: context } = ctx([{ timezone: 'Europe/Berlin', currency: 'EUR', start_date: '2026-07-29', end_date: '2026-07-29', revenue: 0, orders: 0, units: 0 }]);
    const result = await findTool('get_sales_summary')!.run(context,{ period: 'today' });
    expect(result.averageOrderValue).toBeNull();
    expect(result.revenue).toBe(0);
  });

  it('reports no percentage change against an empty baseline', async () => {
    const { ctx: context } = ctx([{ timezone: 'Europe/Berlin', currency: 'EUR', start_date: '2026-07-29', end_date: '2026-07-29', revenue: 0, orders: 0, units: 0 }]);
    const result = await findTool('compare_sales_periods')!.run(context,{ period: 'today', comparePeriod: 'yesterday' });
    expect((result.change as any).revenuePercent).toBeNull();
  });

  it('scopes every query to the supplied tenant', async () => {
    const { db, ctx: context } = ctx([{ timezone: 'Europe/Berlin', currency: 'EUR', start_date: '2026-07-29', end_date: '2026-07-29' }]);
    await findTool('get_channel_sales')!.run(context,{ period: 'today', limit: 500 });
    const data = db.query.mock.calls.find((call) => String(call[0]).includes('FROM orders o'))!;
    expect(data[1][0]).toBe('tenant-a');
    expect(data[1][3]).toBe(20); // clamped from 500
  });

  it('hides every tool from a caller without the sales permission', () => {
    expect(toolsFor(['ai.analytics.use'])).toHaveLength(0);
    expect(toolsFor(['*'])).toHaveLength(SALES_TOOLS.length);
  });
});
