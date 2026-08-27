import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  CanonicalSchemaCapabilities,
  getCanonicalSchemaCapabilities,
  setCanonicalSchemaCapabilities,
} from '../common/utils/canonical-channel-payment';

type CapabilityRow = {
  settings_table: boolean;
  rules_table: boolean;
  backfill_runs_table: boolean;
  backfill_snapshots_table: boolean;
  resolver_function: boolean;
  order_columns: number;
  marketplace_accounts_table: boolean;
  marketplace_sync_runs_table: boolean;
  marketplace_raw_entities_table: boolean;
  marketplace_feedback_sources_table: boolean;
  marketplace_feedback_capabilities_table: boolean;
  marketplace_review_insights_table: boolean;
};

const REQUIRED_ORDER_COLUMNS = [
  'source_platform_raw',
  'source_payment_raw',
  'source_shipping_raw',
  'source_marketplace_raw',
  'source_account_raw',
  'source_shop_raw',
  'source_external_order_raw',
  'canonical_marketplace',
  'canonical_marketplace_account',
  'canonical_shop',
  'canonical_payment_method',
  'channel_resolution_status',
  'payment_resolution_status',
  'channel_rule_id',
  'payment_rule_id',
  'channel_rule_version',
  'payment_rule_version',
  'canonical_resolution_version',
  'canonical_resolved_at',
] as const;

@Injectable()
export class CanonicalChannelPaymentSchemaService
  implements OnApplicationBootstrap
{
  private readonly logger = new Logger(
    CanonicalChannelPaymentSchemaService.name,
  );

  constructor(private readonly db: DataSource) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.refresh();
  }

  current(): CanonicalSchemaCapabilities {
    return getCanonicalSchemaCapabilities();
  }

  supportsCanonicalOrderIngest(): boolean {
    const capabilities = this.current();
    return capabilities.schemaAvailable && capabilities.resolverFunctionAvailable;
  }

  async refresh(): Promise<CanonicalSchemaCapabilities> {
    try {
      const [row] = await this.db.query<CapabilityRow[]>(
        `SELECT
           to_regclass('public.tenant_channel_payment_settings') IS NOT NULL AS settings_table,
           to_regclass('public.tenant_channel_payment_rules') IS NOT NULL AS rules_table,
           to_regclass('public.canonical_backfill_runs') IS NOT NULL AS backfill_runs_table,
           to_regclass('public.canonical_backfill_snapshots') IS NOT NULL AS backfill_snapshots_table,
           to_regprocedure('public.resolve_channel_payment_exact(uuid,text,text,text,text,text,text)') IS NOT NULL AS resolver_function,
           (SELECT COUNT(*)::int
              FROM information_schema.columns
             WHERE table_schema = 'public'
               AND table_name = 'orders'
               AND column_name = ANY($1::text[])) AS order_columns,
           to_regclass('public.marketplace_accounts') IS NOT NULL AS marketplace_accounts_table,
           to_regclass('public.marketplace_sync_runs') IS NOT NULL AS marketplace_sync_runs_table,
           to_regclass('public.marketplace_raw_entities') IS NOT NULL AS marketplace_raw_entities_table,
           to_regclass('public.marketplace_feedback_sources') IS NOT NULL AS marketplace_feedback_sources_table,
           to_regclass('public.marketplace_feedback_capabilities') IS NOT NULL AS marketplace_feedback_capabilities_table,
           to_regclass('public.marketplace_review_insights') IS NOT NULL AS marketplace_review_insights_table`,
        [REQUIRED_ORDER_COLUMNS],
      );

      const orderColumnsAvailable =
        Number(row?.order_columns ?? 0) === REQUIRED_ORDER_COLUMNS.length;
      const settingsTableAvailable = Boolean(row?.settings_table);
      const rulesTableAvailable = Boolean(row?.rules_table);
      const resolverFunctionAvailable = Boolean(row?.resolver_function);
      const capabilities: CanonicalSchemaCapabilities = {
        orderColumnsAvailable,
        settingsTableAvailable,
        rulesTableAvailable,
        resolverFunctionAvailable,
        backfillTablesAvailable: Boolean(
          row?.backfill_runs_table && row?.backfill_snapshots_table,
        ),
        schemaAvailable:
          orderColumnsAvailable &&
          settingsTableAvailable &&
          rulesTableAvailable &&
          resolverFunctionAvailable,
        marketplaceSchema20Available: Boolean(
          row?.marketplace_accounts_table &&
            row?.marketplace_sync_runs_table &&
            row?.marketplace_raw_entities_table,
        ),
        marketplaceSchema21Available: Boolean(
          row?.marketplace_feedback_sources_table &&
            row?.marketplace_feedback_capabilities_table &&
            row?.marketplace_review_insights_table,
        ),
        checkedAt: new Date().toISOString(),
      };

      setCanonicalSchemaCapabilities(capabilities);
      this.logger.log(
        `Schema capabilities: canonical=${capabilities.schemaAvailable}, marketplace20=${capabilities.marketplaceSchema20Available}, marketplace21=${capabilities.marketplaceSchema21Available}`,
      );
      return capabilities;
    } catch (error) {
      const capabilities: CanonicalSchemaCapabilities = {
        ...getCanonicalSchemaCapabilities(),
        schemaAvailable: false,
        orderColumnsAvailable: false,
        settingsTableAvailable: false,
        rulesTableAvailable: false,
        backfillTablesAvailable: false,
        resolverFunctionAvailable: false,
        marketplaceSchema20Available: false,
        marketplaceSchema21Available: false,
        checkedAt: new Date().toISOString(),
      };
      setCanonicalSchemaCapabilities(capabilities);
      this.logger.warn(
        `Schema capability detection failed; legacy mode remains active: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      return capabilities;
    }
  }
}
