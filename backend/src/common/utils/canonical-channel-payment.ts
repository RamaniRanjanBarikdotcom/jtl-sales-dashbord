import { DataSource } from 'typeorm';

export interface CanonicalSchemaCapabilities {
  schemaAvailable: boolean;
  orderColumnsAvailable: boolean;
  settingsTableAvailable: boolean;
  rulesTableAvailable: boolean;
  backfillTablesAvailable: boolean;
  resolverFunctionAvailable: boolean;
  marketplaceSchema20Available: boolean;
  marketplaceSchema21Available: boolean;
  checkedAt: string;
}

const unavailableCapabilities: CanonicalSchemaCapabilities = {
  schemaAvailable: false,
  orderColumnsAvailable: false,
  settingsTableAvailable: false,
  rulesTableAvailable: false,
  backfillTablesAvailable: false,
  resolverFunctionAvailable: false,
  marketplaceSchema20Available: false,
  marketplaceSchema21Available: false,
  checkedAt: new Date(0).toISOString(),
};

let currentCapabilities = unavailableCapabilities;

export function setCanonicalSchemaCapabilities(
  capabilities: CanonicalSchemaCapabilities,
): void {
  currentCapabilities = Object.freeze({ ...capabilities });
}

export function getCanonicalSchemaCapabilities(): CanonicalSchemaCapabilities {
  return currentCapabilities;
}

export function resetCanonicalSchemaCapabilities(): void {
  currentCapabilities = unavailableCapabilities;
}

export function canonicalOrderColumn(column: string, canonical: string): string {
  const match = column.match(/^(?:([A-Za-z_][A-Za-z0-9_]*)\.)?(channel|payment_method)$/);
  if (!match) return column;

  if (!currentCapabilities.schemaAvailable) return column;

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

export function sourcePlatformOrderColumn(column: string): string {
  const match = column.match(/^(?:([A-Za-z_][A-Za-z0-9_]*)\.)?channel$/);
  if (!match || !currentCapabilities.schemaAvailable) return column;
  const prefix = match[1] ? `${match[1]}.` : 'orders.';
  return `COALESCE(NULLIF(TRIM(${prefix}source_platform_raw), ''), ${column})`;
}

export async function canonicalCacheNamespace(
  db: DataSource,
  tenantIds: string[],
): Promise<string> {
  if (!currentCapabilities.schemaAvailable) return 'legacy:schema0';
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
