import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { DataSource } from 'typeorm';
import { Marketplace } from '../core/marketplace.enum';
import { MarketplaceResource } from '../core/marketplace-resource.enum';
import { MarketplaceSyncJobV1, RawMarketplaceFeedback, RawMarketplaceOrder } from '../core/marketplace.types';
import { ConnectorRegistryService } from '../core/connector-registry.service';

@Injectable()
export class MarketplaceShadowSyncService {
  constructor(
    private readonly config: ConfigService,
    @InjectDataSource() private readonly db: DataSource,
    private readonly connectors: ConnectorRegistryService,
  ) {}

  async process(job: MarketplaceSyncJobV1): Promise<{ records: number; pages: number }> {
    const connector = this.connectors.get(job.marketplace);
    const accountRows = await this.db.query<Array<{
      external_merchant_id: string | null; region_code: string | null; currency_code: string | null;
    }>>(
      `SELECT external_merchant_id, region_code, currency_code
       FROM marketplace_accounts
       WHERE id = $1 AND tenant_id = $2 AND marketplace = $3 AND status = 'ACTIVE'`,
      [job.marketplaceAccountId, job.tenantId, job.marketplace],
    );
    const account = accountRows[0];
    if (!account) throw new Error('Active marketplace account not found');

    const cursorRows = await this.db.query<Array<{ committed_cursor: string | null }>>(
      `SELECT committed_cursor FROM marketplace_sync_cursors
       WHERE id = $1 AND tenant_id = $2 AND marketplace_account_id = $3 AND resource = $4`,
      [job.cursorId, job.tenantId, job.marketplaceAccountId, job.resource],
    );
    let pageToken = cursorRows[0]?.committed_cursor ?? undefined;
    let records = 0;
    let pages = 0;

    while (pages < 100) {
      const context = {
        account: {
          tenantId: job.tenantId, accountId: job.marketplaceAccountId, marketplace: job.marketplace,
          externalMerchantId: account.external_merchant_id, regionCode: account.region_code,
          currencyCode: account.currency_code,
        },
        resource: job.resource, syncRunId: job.syncRunId, cursorId: job.cursorId,
        windowStart: job.windowStart, windowEnd: job.windowEnd, pageToken,
      };
      const page = job.resource === MarketplaceResource.ORDERS
        ? await this.fetchOrders(connector.fetchOrders?.bind(connector), context)
        : this.reviewResource(job.resource)
          ? await this.fetchReviews(job.resource, connector, context)
          : (() => { throw new Error(`Shadow processor does not support resource ${job.resource}`); })();
      if (job.resource === MarketplaceResource.ORDERS) {
        await this.commitOrderPage(job, page.items as RawMarketplaceOrder[], page.nextPageToken ?? pageToken ?? null);
      } else {
        await this.commitReviewPage(job, page.items as RawMarketplaceFeedback[], page.nextPageToken ?? pageToken ?? null);
      }
      records += page.items.length;
      pages += 1;
      if (!page.hasMore) break;
      if (!page.nextPageToken || page.nextPageToken === pageToken) throw new Error('Connector returned a non-advancing cursor');
      pageToken = page.nextPageToken;
    }
    if (pages >= 100) throw new Error('Marketplace page safety limit reached');
    await this.db.query(
      `UPDATE marketplace_sync_runs SET status = 'COMPLETED', completed_at = now(), records_seen = $2,
         records_written = $2 WHERE id = $1 AND tenant_id = $3`,
      [job.syncRunId, records, job.tenantId],
    );
    return { records, pages };
  }

  async recordFailure(job: MarketplaceSyncJobV1, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message.slice(0, 500) : 'Marketplace sync failed';
    await this.db.transaction(async (manager) => {
      await manager.query(
        `UPDATE marketplace_sync_runs SET status = 'FAILED', completed_at = now(), safe_error = $2
         WHERE id = $1 AND tenant_id = $3`,
        [job.syncRunId, message, job.tenantId],
      );
      await manager.query(
        `INSERT INTO marketplace_sync_failures
           (tenant_id, marketplace_account_id, sync_run_id, resource, failure_class,
            safe_error_code, safe_error_message)
         VALUES ($1, $2, $3, $4, 'INVALID_REQUEST', 'SHADOW_CONNECTOR_FAILURE', $5)`,
        [job.tenantId, job.marketplaceAccountId, job.syncRunId, job.resource, message],
      );
    });
  }

  private async commitOrderPage(job: MarketplaceSyncJobV1, items: RawMarketplaceOrder[], nextCursor: string | null) {
    await this.db.transaction(async (manager) => {
      for (const item of items) {
        const payload = JSON.stringify(item);
        const payloadHash = createHash('sha256').update(payload).digest('hex');
        const orderedAt = typeof item.orderedAt === 'string' ? item.orderedAt : new Date().toISOString();
        const rawRows = await manager.query<Array<{ id: string }>>(
          `INSERT INTO marketplace_raw_entities
             (tenant_id, marketplace_account_id, marketplace, resource, external_id, payload_hash,
              payload, connector_version, normalizer_version)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, 'mock-v1', 'order-v1')
           ON CONFLICT (tenant_id, marketplace_account_id, resource, external_id)
           DO UPDATE SET payload_hash = EXCLUDED.payload_hash, payload = EXCLUDED.payload,
             connector_version = EXCLUDED.connector_version, normalizer_version = EXCLUDED.normalizer_version,
             last_seen_at = now()
           RETURNING id`,
          [job.tenantId, job.marketplaceAccountId, job.marketplace, job.resource,
            item.externalOrderId, payloadHash, payload],
        );
        void rawRows;
        const orderRows = await manager.query<Array<{ id: string }>>(
          `INSERT INTO marketplace_orders
             (tenant_id, marketplace_account_id, marketplace, external_order_id, status,
              currency_code, gross_total, ordered_at, canonical_state)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'SOURCE_ONLY')
           ON CONFLICT (tenant_id, marketplace_account_id, external_order_id)
           DO UPDATE SET status = EXCLUDED.status, currency_code = EXCLUDED.currency_code,
             gross_total = EXCLUDED.gross_total, ordered_at = EXCLUDED.ordered_at, updated_at = now()
           RETURNING id`,
          [job.tenantId, job.marketplaceAccountId, job.marketplace, item.externalOrderId,
            typeof item.status === 'string' ? item.status : null,
            typeof item.currencyCode === 'string' ? item.currencyCode : null,
            typeof item.grossTotal === 'number' || typeof item.grossTotal === 'string' ? item.grossTotal : null,
            orderedAt],
        );
        await manager.query(
          `INSERT INTO marketplace_order_links (tenant_id, marketplace_order_id, status, evidence)
           VALUES ($1, $2, 'UNRESOLVED', '{"source":"shadow"}'::jsonb)
           ON CONFLICT (tenant_id, marketplace_order_id) DO NOTHING`,
          [job.tenantId, orderRows[0].id],
        );
      }
      await manager.query(
        `UPDATE marketplace_sync_cursors SET committed_cursor = $2, version = version + 1,
           window_end = COALESCE($3::timestamptz, window_end), updated_at = now()
         WHERE id = $1 AND tenant_id = $4 AND marketplace_account_id = $5 AND resource = $6`,
        [job.cursorId, nextCursor, job.windowEnd ?? null, job.tenantId, job.marketplaceAccountId, job.resource],
      );
    });
  }

  private async commitReviewPage(job: MarketplaceSyncJobV1, items: RawMarketplaceFeedback[], nextCursor: string | null) {
    const channelRows = await this.db.query<Array<{ canonical_channel_id: string }>>(
      `SELECT COALESCE(cm.canonical_channel_id, 'marketplace-' || LOWER($2)) AS canonical_channel_id
       FROM marketplace_accounts account
       LEFT JOIN LATERAL (
         SELECT mapping.canonical_channel_id
         FROM channel_mappings mapping
         WHERE mapping.tenant_id = account.tenant_id
           AND LOWER(mapping.canonical_channel) = LOWER(account.marketplace)
         ORDER BY mapping.updated_at DESC
         LIMIT 1
       ) cm ON true
       WHERE account.id = $1 AND account.tenant_id = $3`,
      [job.marketplaceAccountId, job.marketplace, job.tenantId],
    );
    const channelId = channelRows[0]?.canonical_channel_id ?? `marketplace-${job.marketplace.toLowerCase()}`;
    await this.db.transaction(async (manager) => {
      for (const item of items) {
        const externalReviewId = this.requiredString(item.externalFeedbackId, 'externalFeedbackId');
        const rating = this.rating(item.rating ?? item.score ?? item.stars);
        const reviewedAt = this.dateValue(item.reviewedAt ?? item.createdAt ?? item.submittedAt);
        const payload = JSON.stringify(item);
        const payloadHash = createHash('sha256').update(payload).digest('hex');
        await manager.query(
          `INSERT INTO marketplace_raw_entities
             (tenant_id, marketplace_account_id, marketplace, resource, external_id, payload_hash,
              payload, connector_version, normalizer_version)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, 'connector-v1', 'review-v1')
           ON CONFLICT (tenant_id, marketplace_account_id, resource, external_id)
           DO UPDATE SET payload_hash = EXCLUDED.payload_hash, payload = EXCLUDED.payload,
             connector_version = EXCLUDED.connector_version, normalizer_version = EXCLUDED.normalizer_version,
             last_seen_at = now()`,
          [job.tenantId, job.marketplaceAccountId, job.marketplace, job.resource,
            externalReviewId, payloadHash, payload],
        );
        await manager.query(
          `INSERT INTO marketplace_reviews
             (tenant_id, marketplace_account_id, marketplace, canonical_channel_id,
              external_review_id, external_product_id, sku, rating, title, review_text,
              reviewed_at, verified_purchase, source_payload_hash)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
           ON CONFLICT (tenant_id, marketplace, external_review_id)
           DO UPDATE SET marketplace_account_id = EXCLUDED.marketplace_account_id,
             canonical_channel_id = EXCLUDED.canonical_channel_id,
             external_product_id = EXCLUDED.external_product_id, sku = EXCLUDED.sku,
             rating = EXCLUDED.rating, title = EXCLUDED.title, review_text = EXCLUDED.review_text,
             reviewed_at = EXCLUDED.reviewed_at, verified_purchase = EXCLUDED.verified_purchase,
             source_payload_hash = EXCLUDED.source_payload_hash, updated_at = now()`,
          [job.tenantId, job.marketplaceAccountId, job.marketplace, channelId,
            externalReviewId, this.optionalString(item.externalProductId ?? item.productId ?? item.asin),
            this.optionalString(item.sku), rating,
            this.optionalString(item.title ?? item.subject),
            this.optionalString(item.reviewText ?? item.text ?? item.comment), reviewedAt,
            typeof item.verifiedPurchase === 'boolean' ? item.verifiedPurchase : null, payloadHash],
        );
      }
      await manager.query(
        `UPDATE marketplace_sync_cursors SET committed_cursor = $2, version = version + 1,
           window_end = COALESCE($3::timestamptz, window_end), updated_at = now()
         WHERE id = $1 AND tenant_id = $4 AND marketplace_account_id = $5 AND resource = $6`,
        [job.cursorId, nextCursor, job.windowEnd ?? null, job.tenantId, job.marketplaceAccountId, job.resource],
      );
    });
  }

  private reviewResource(resource: MarketplaceResource): boolean {
    return [MarketplaceResource.PRODUCT_REVIEWS, MarketplaceResource.SELLER_FEEDBACK,
      MarketplaceResource.ORDER_EVALUATIONS].includes(resource);
  }

  private async fetchOrders(fetcher: ((context: any) => Promise<any>) | undefined, context: any) {
    if (!fetcher) throw new Error('Connector does not support orders');
    return fetcher(context);
  }

  private async fetchReviews(resource: MarketplaceResource, connector: any, context: any) {
    const fetcher = resource === MarketplaceResource.PRODUCT_REVIEWS ? connector.fetchReviews
      : resource === MarketplaceResource.SELLER_FEEDBACK ? connector.fetchSellerFeedback
        : connector.fetchOrderEvaluations;
    if (!fetcher) throw new Error(`Connector does not support ${resource}`);
    return fetcher.call(connector, context);
  }

  private requiredString(value: unknown, field: string): string {
    const normalized = this.optionalString(value);
    if (!normalized) throw new Error(`Connector review is missing ${field}`);
    return normalized;
  }

  private optionalString(value: unknown): string | null {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const normalized = String(value).trim();
    return normalized || null;
  }

  private rating(value: unknown): number {
    const rating = Number(value);
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) throw new Error('Connector review rating must be between 1 and 5');
    return rating;
  }

  private dateValue(value: unknown): string {
    const date = new Date(typeof value === 'string' || typeof value === 'number' ? value : Date.now());
    if (Number.isNaN(date.valueOf())) throw new Error('Connector review date is invalid');
    return date.toISOString();
  }

}
