import {
  boundedRetentionDeleteSql,
  OPERATIONAL_RETENTION_TARGETS,
  retentionPreviewSql,
} from './retention-policy';

describe('operational retention policy SQL', () => {
  it.each(OPERATIONAL_RETENTION_TARGETS)('builds a read-only tenant-scoped preview for $table', (target) => {
    const sql = retentionPreviewSql(target);
    expect(sql.trim().startsWith('SELECT')).toBe(true);
    expect(sql).toContain(`${target.tenantColumn}::text = $2::text`);
    expect(sql).not.toMatch(/\bDELETE\b|\bUPDATE\b|\bTRUNCATE\b/i);
  });

  it.each(OPERATIONAL_RETENTION_TARGETS)('bounds and locks cleanup batches for $table', (target) => {
    const sql = boundedRetentionDeleteSql(target);
    expect(sql).toContain('LIMIT $3::int');
    expect(sql).toContain('FOR UPDATE SKIP LOCKED');
    expect(sql).toContain(`${target.tenantColumn}::text = $2::text`);
    expect(sql).not.toContain('TRUNCATE');
  });
});
