import { DataSource } from 'typeorm';

export function canonicalOrderColumn(column: string, canonical: string): string {
  const match = column.match(/^(?:([A-Za-z_][A-Za-z0-9_]*)\.)?(channel|payment_method)$/);
  if (!match) return column;

  const prefix = match[1] ? `${match[1]}.` : 'orders.';
  const isChannel = match[2] === 'channel';
  const enabledColumn = isChannel ? 'channel_enabled' : 'payment_enabled';
  const statusColumn = isChannel ? 'channel_resolution_status' : 'payment_resolution_status';

  return `CASE
    WHEN EXISTS (
      SELECT 1
      FROM tenant_channel_payment_settings canonical_settings
      WHERE canonical_settings.tenant_id = ${prefix}tenant_id
        AND canonical_settings.${enabledColumn}
    ) THEN CASE
      WHEN ${prefix}${statusColumn} = 'resolved'
        AND NULLIF(TRIM(${prefix}${canonical}), '') IS NOT NULL
      THEN TRIM(${prefix}${canonical})
      WHEN ${prefix}${statusColumn} = 'ambiguous' THEN 'Ambiguous'
      ELSE 'Unresolved'
    END
    ELSE ${column}
  END`;
}

export async function canonicalCacheNamespace(
  db: DataSource,
  tenantIds: string[],
): Promise<string> {
  try {
    const rows = await db.query(
      `SELECT COALESCE(
         STRING_AGG(
           requested.tenant_id::text || ':' ||
           COALESCE(settings.channel_enabled::int, 0)::text || ':' ||
           COALESCE(settings.payment_enabled::int, 0)::text || ':' ||
           COALESCE(settings.resolution_version, 0)::text,
           ',' ORDER BY requested.tenant_id
         ),
         'legacy:0:0:0'
       ) AS canonical_cache_namespace
       FROM UNNEST($1::uuid[]) requested(tenant_id)
       LEFT JOIN tenant_channel_payment_settings settings
         ON settings.tenant_id = requested.tenant_id`,
      [tenantIds],
    );
    const namespace = rows?.[0]?.canonical_cache_namespace;
    return typeof namespace === 'string' && namespace ? namespace : 'legacy:0:0:0';
  } catch {
    return 'legacy:0:0:0';
  }
}
