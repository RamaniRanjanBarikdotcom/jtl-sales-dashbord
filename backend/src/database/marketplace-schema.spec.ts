import { readFileSync } from 'fs';
import { join } from 'path';

describe('marketplace foundation schema', () => {
  const sql = readFileSync(join(process.cwd(), 'init-db/20-marketplace-foundation.sql'), 'utf8');
  const feedbackSql = readFileSync(join(process.cwd(), 'init-db/21-marketplace-feedback-foundation.sql'), 'utf8');

  it('keeps marketplace source orders separate from JTL orders', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS marketplace_orders');
    expect(sql).not.toMatch(/INSERT\s+INTO\s+orders\b/i);
  });

  it('stores source-backed marketplace reviews with deterministic sentiment', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS marketplace_reviews');
    expect(sql).toContain("WHEN rating >= 4 THEN 'positive'");
    expect(sql).toContain("WHEN rating <= 2 THEN 'negative'");
    expect(sql).toContain('UNIQUE (tenant_id, marketplace, external_review_id)');
  });

  it('uses tenant-scoped business uniqueness', () => {
    expect(sql).toContain('UNIQUE (tenant_id, marketplace_account_id, external_order_id)');
    expect(sql).toContain('UNIQUE (tenant_id, marketplace_account_id, external_order_id, external_item_id)');
    expect(sql).toContain('UNIQUE (tenant_id, marketplace_account_id, resource, external_id)');
  });

  it('defaults marketplace accounts and policies to safe states', () => {
    expect(sql).toContain("status varchar(30) NOT NULL DEFAULT 'DRAFT'");
    expect(sql).toContain('shadow_mode boolean NOT NULL DEFAULT true');
    expect(sql).toContain('enabled boolean NOT NULL DEFAULT false');
  });

  it('adds independent feedback sources, capabilities, and typed review datasets', () => {
    expect(feedbackSql).toContain('CREATE TABLE IF NOT EXISTS marketplace_feedback_sources');
    expect(feedbackSql).toContain('CREATE TABLE IF NOT EXISTS marketplace_feedback_capabilities');
    expect(feedbackSql).toContain('CREATE TABLE IF NOT EXISTS marketplace_review_insights');
    expect(feedbackSql).toContain('CREATE TABLE IF NOT EXISTS marketplace_review_trends');
    expect(feedbackSql).toContain('CREATE TABLE IF NOT EXISTS marketplace_rating_aggregates');
  });

  it('extends marketplace reviews additively with source provenance', () => {
    expect(feedbackSql).toContain('ALTER TABLE marketplace_reviews ADD COLUMN IF NOT EXISTS feedback_source_id');
    expect(feedbackSql).toContain('uq_marketplace_review_source_external');
    expect(feedbackSql).toContain('uq_marketplace_review_source_content');
    expect(feedbackSql).not.toMatch(/DROP\s+TABLE\s+marketplace_reviews/i);
  });
});
