import * as fs from 'fs';
import * as path from 'path';

describe('comparison analytics schema', () => {
  const sql = fs.readFileSync(
    path.resolve(__dirname, '../../init-db/16-comparison-analytics.sql'),
    'utf8',
  );

  it.each([
    'channel_mappings',
    'inventory_daily_snapshots',
    'analytics_saved_views',
  ])('creates tenant-scoped %s', (table) => {
    expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    expect(sql).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS ${table}[\\s\\S]*?tenant_id`, 'i'));
  });

  it('creates tenant-first snapshot and mapping indexes', () => {
    expect(sql).toContain('idx_channel_mappings_tenant_canonical');
    expect(sql).toContain('idx_inventory_snapshots_tenant_product_date');
    expect(sql).toContain('idx_saved_views_tenant_user');
  });

  it('seeds all comparison permission keys idempotently', () => {
    expect(sql).toContain("'comparison.view'");
    expect(sql).toContain("'comparison.saved_views.manage'");
    expect(sql).toContain('ON CONFLICT (key) DO UPDATE');
  });
});
