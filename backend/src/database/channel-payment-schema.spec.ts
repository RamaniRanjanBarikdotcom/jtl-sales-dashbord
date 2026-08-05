import * as fs from 'fs';
import * as path from 'path';

describe('canonical channel and payment schema', () => {
  const sql = fs.readFileSync(
    path.resolve(__dirname, '../../init-db/19-channel-payment-canonical.sql'),
    'utf8',
  );

  it('is additive and preserves legacy order evidence fields', () => {
    expect(sql).toContain('ALTER TABLE orders ADD COLUMN IF NOT EXISTS source_platform_raw');
    expect(sql).toContain('ALTER TABLE orders ADD COLUMN IF NOT EXISTS canonical_marketplace');
    expect(sql).not.toMatch(/DROP\s+(TABLE|COLUMN)/i);
    expect(sql).not.toMatch(/ALTER\s+TABLE\s+orders\s+RENAME/i);
  });

  it('creates tenant-scoped exact rules with verification gates', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS tenant_channel_payment_rules[\s\S]*tenant_id\s+uuid NOT NULL/i);
    expect(sql).toContain("CHECK (enabled = false OR evidence_status = 'verified')");
    expect(sql).toContain('ux_tenant_channel_payment_rules_exact');
  });

  it('keeps activation disabled and candidate rules inactive', () => {
    expect(sql).toMatch(/channel_enabled\s+boolean NOT NULL DEFAULT false/i);
    expect(sql).toMatch(/payment_enabled\s+boolean NOT NULL DEFAULT false/i);
    expect(sql).toContain("'candidate', false");
  });

  it('marks conflicting verified outputs ambiguous', () => {
    expect(sql).toContain("ELSE 'ambiguous'");
    expect(sql).toContain('COUNT(DISTINCT');
    expect(sql).toContain('MIN(rule.priority) OVER () AS winning_priority');
    expect(sql).toContain('candidate.priority = candidate.winning_priority');
  });

  it('isolates rules by tenant and ignores inactive rules during resolution', () => {
    expect(sql.match(/WHERE rule\.tenant_id = p_tenant_id/g)).toHaveLength(2);
    expect(sql.match(/AND rule\.enabled/g)).toHaveLength(2);
    expect(sql.match(/AND rule\.evidence_status = 'verified'/g)).toHaveLength(2);
  });

  it('keeps channel and payment activation independent', () => {
    expect(sql).toContain('AND settings.channel_enabled');
    expect(sql).toContain('AND settings.payment_enabled');
  });

  it('supports resumable and rollback-safe versioned backfills', () => {
    expect(sql).toContain('checkpoint_order_date');
    expect(sql).toContain('checkpoint_order_id');
    expect(sql).toContain('canonical_backfill_snapshots');
    expect(sql).toContain('canonical_rule_reprocess_queue');
    expect(sql).toContain('channel_rule_version');
    expect(sql).toContain('payment_rule_version');
  });
});
