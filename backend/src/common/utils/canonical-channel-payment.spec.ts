import { DataSource } from 'typeorm';
import {
  canonicalCacheNamespace,
  canonicalOrderColumn,
} from './canonical-channel-payment';

describe('canonical channel and payment SQL helpers', () => {
  it('returns legacy evidence when the feature is disabled', () => {
    const sql = canonicalOrderColumn('o.channel', 'canonical_marketplace');
    expect(sql).toContain('ELSE o.channel');
  });

  it('returns explicit unresolved and ambiguous buckets when enabled', () => {
    const sql = canonicalOrderColumn('o.channel', 'canonical_marketplace');
    expect(sql).toContain("WHEN o.channel_resolution_status = 'ambiguous' THEN 'Ambiguous'");
    expect(sql).toContain("ELSE 'Unresolved'");
  });

  it('keeps channel and payment feature gates separate', () => {
    expect(canonicalOrderColumn('o.channel', 'canonical_marketplace')).toContain('canonical_settings.channel_enabled');
    expect(canonicalOrderColumn('o.payment_method', 'canonical_payment_method')).toContain('canonical_settings.payment_enabled');
  });

  it('applies canonical logic to unqualified order columns', () => {
    const channelSql = canonicalOrderColumn('channel', 'canonical_marketplace');
    const paymentSql = canonicalOrderColumn('payment_method', 'canonical_payment_method');

    expect(channelSql).toContain('canonical_settings.tenant_id = orders.tenant_id');
    expect(channelSql).toContain("WHEN orders.channel_resolution_status = 'resolved'");
    expect(channelSql).toContain('THEN TRIM(orders.canonical_marketplace)');
    expect(paymentSql).toContain('canonical_settings.payment_enabled');
    expect(paymentSql).toContain('THEN TRIM(orders.canonical_payment_method)');
  });

  it('includes canonical mode and resolution version in cache namespace', async () => {
    const query = jest.fn().mockResolvedValue([{ canonical_cache_namespace: 'tenant:1:0:9' }]);
    const namespace = await canonicalCacheNamespace(
      { query } as unknown as DataSource,
      ['11111111-1111-4111-8111-111111111111'],
    );
    expect(namespace).toBe('tenant:1:0:9');
    expect(query.mock.calls[0][0]).toContain('settings.channel_enabled');
    expect(query.mock.calls[0][0]).toContain('settings.payment_enabled');
    expect(query.mock.calls[0][0]).toContain('settings.resolution_version');
  });
});
