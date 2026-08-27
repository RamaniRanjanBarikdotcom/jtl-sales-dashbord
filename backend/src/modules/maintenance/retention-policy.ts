export type OperationalRetentionTarget = {
  table: 'sync_log' | 'system_events' | 'audit_logs' | 'sync_runs' | 'sync_run_batches';
  timestampColumn: 'created_at' | 'at' | 'started_at';
  tenantColumn: 'tenant_id';
};

export const OPERATIONAL_RETENTION_TARGETS: readonly OperationalRetentionTarget[] = [
  { table: 'sync_log', timestampColumn: 'created_at', tenantColumn: 'tenant_id' },
  { table: 'system_events', timestampColumn: 'created_at', tenantColumn: 'tenant_id' },
  { table: 'audit_logs', timestampColumn: 'at', tenantColumn: 'tenant_id' },
  { table: 'sync_runs', timestampColumn: 'started_at', tenantColumn: 'tenant_id' },
  { table: 'sync_run_batches', timestampColumn: 'started_at', tenantColumn: 'tenant_id' },
] as const;

export function retentionPreviewSql(target: OperationalRetentionTarget): string {
  return `SELECT COUNT(*)::bigint AS eligible_rows
    FROM ${target.table}
    WHERE ${target.timestampColumn} < now() - ($1::int * interval '1 day')
      AND ($2::uuid IS NULL OR ${target.tenantColumn}::text = $2::text)`;
}

export function boundedRetentionDeleteSql(target: OperationalRetentionTarget): string {
  return `WITH eligible AS (
      SELECT ctid
      FROM ${target.table}
      WHERE ${target.timestampColumn} < now() - ($1::int * interval '1 day')
        AND ($2::uuid IS NULL OR ${target.tenantColumn}::text = $2::text)
      ORDER BY ${target.timestampColumn}
      LIMIT $3::int
      FOR UPDATE SKIP LOCKED
    )
    DELETE FROM ${target.table} target
    USING eligible
    WHERE target.ctid = eligible.ctid
    RETURNING target.${target.tenantColumn}`;
}
