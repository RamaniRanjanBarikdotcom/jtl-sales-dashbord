import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Marketplace } from '../core/marketplace.enum';
import { FeedbackSourceRegistryService } from './feedback-source-registry.service';
import {
  FeedbackAvailability, FeedbackCoverage, MarketplaceFeedbackResourceType,
  MarketplaceFeedbackSourceType,
} from './marketplace-feedback.types';

type AccountRow = { id: string; tenant_id: string; marketplace: Marketplace; status: string };
type Baseline = { availability: FeedbackAvailability; coverage: FeedbackCoverage; reason: string; message: string };

const RESOURCES = Object.values(MarketplaceFeedbackResourceType);

@Injectable()
export class FeedbackCapabilityService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly registry: FeedbackSourceRegistryService,
  ) {}

  async sources(tenantId: string, accountId: string) {
    const account = await this.account(tenantId, accountId);
    await this.ensureBaseline(account);
    return this.db.query(
      `SELECT id, marketplace, source_key AS "sourceKey", source_type AS "sourceType",
        provider_name AS "providerName", display_name AS "displayName", status, enabled,
        storage_allowed AS "storageAllowed", display_allowed AS "displayAllowed",
        sentiment_allowed AS "sentimentAllowed", retention_days AS "retentionDays", priority,
        last_tested_at AS "lastTestedAt", last_successful_sync_at AS "lastSuccessfulSyncAt",
        last_failed_sync_at AS "lastFailedSyncAt", last_error_code AS "lastErrorCode",
        last_error_message AS "lastErrorMessage"
       FROM marketplace_feedback_sources
       WHERE tenant_id = $1 AND marketplace_account_id = $2
       ORDER BY priority, source_key`,
      [tenantId, accountId],
    );
  }

  async capabilities(tenantId: string, accountId: string) {
    const account = await this.account(tenantId, accountId);
    await this.ensureBaseline(account);
    const rows = await this.capabilityRows(tenantId, accountId);
    return { marketplace: account.marketplace, resources: this.combine(rows), sources: rows };
  }

  async test(tenantId: string, accountId: string) {
    const account = await this.account(tenantId, accountId);
    await this.ensureBaseline(account);
    const sources = await this.db.query<Array<{ id: string; source_key: string; enabled: boolean }>>(
      `SELECT id, source_key, enabled FROM marketplace_feedback_sources
       WHERE tenant_id = $1 AND marketplace_account_id = $2 ORDER BY priority, source_key`,
      [tenantId, accountId],
    );
    const diagnostics: Array<Record<string, unknown>> = [];
    for (const source of sources) {
      const connector = this.registry.find(account.marketplace, source.source_key);
      if (!connector) {
        diagnostics.push({ sourceKey: source.source_key, success: false, errorCode: 'CONNECTOR_NOT_CONFIGURED',
          errorMessage: 'No real feedback connector is registered for this source.' });
        continue;
      }
      const context = { tenantId, accountId, marketplace: account.marketplace, sourceId: source.id };
      const connection = await connector.testConnection(context);
      if (!connection.success) {
        await this.db.query(
          `UPDATE marketplace_feedback_sources SET status = 'NOT_AUTHORIZED', last_tested_at = now(),
             last_error_code = $3, last_error_message = $4, updated_at = now()
           WHERE tenant_id = $1 AND id = $2`,
          [tenantId, source.id, connection.errorCode || 'CONNECTION_FAILED', connection.errorMessage || 'Connection failed'],
        );
        diagnostics.push({ sourceKey: source.source_key, ...connection });
        continue;
      }
      const capabilities = await connector.discoverCapabilities(context);
      for (const [resource, state] of Object.entries(capabilities)) {
        if (!state) continue;
        await this.upsertCapability(tenantId, accountId, source.id, resource as MarketplaceFeedbackResourceType,
          state.availability, state.coverage, state.reasonCode || null, state.message || null, true);
      }
      await this.db.query(
        `UPDATE marketplace_feedback_sources SET status = 'ACTIVE', last_tested_at = now(),
           last_error_code = NULL, last_error_message = NULL, updated_at = now()
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, source.id],
      );
      diagnostics.push({ sourceKey: source.source_key, success: true });
    }
    return { diagnostics, ...(await this.capabilities(tenantId, accountId)) };
  }

  async summary(tenantId: string, accountId: string) {
    const account = await this.account(tenantId, accountId);
    await this.ensureBaseline(account);
    const rows = await this.capabilityRows(tenantId, accountId);
    const resources = this.combine(rows);
    const individual = resources[MarketplaceFeedbackResourceType.INDIVIDUAL_PRODUCT_REVIEWS];
    const insight = resources[MarketplaceFeedbackResourceType.REVIEW_INSIGHTS];
    const rating = resources[MarketplaceFeedbackResourceType.PRODUCT_RATING_AGGREGATE];
    const [reviewFacts] = await this.db.query<Array<Record<string, unknown>>>(
      `SELECT COUNT(*)::int AS count, AVG(rating)::float8 AS "averageRating",
        COUNT(*) FILTER (WHERE sentiment = 'positive')::int AS positive,
        COUNT(*) FILTER (WHERE sentiment = 'neutral')::int AS neutral,
        COUNT(*) FILTER (WHERE sentiment = 'negative')::int AS negative
       FROM marketplace_reviews
       WHERE tenant_id = $1 AND marketplace_account_id = $2 AND visible = true AND deleted_at IS NULL`,
      [tenantId, accountId],
    );
    const [insightFacts] = await this.db.query<Array<Record<string, unknown>>>(
      `SELECT COUNT(DISTINCT jtl_product_id)::int AS "productsAnalyzed",
        COUNT(*) FILTER (WHERE sentiment = 'positive')::int AS "positiveTopicCount",
        COUNT(*) FILTER (WHERE sentiment = 'negative')::int AS "negativeTopicCount"
       FROM marketplace_review_insights WHERE tenant_id = $1 AND marketplace_account_id = $2`,
      [tenantId, accountId],
    );
    const [ratingFacts] = await this.db.query<Array<Record<string, unknown>>>(
      `SELECT COUNT(*)::int AS products, SUM(review_count)::bigint AS "reviewCount"
       FROM marketplace_rating_aggregates WHERE tenant_id = $1 AND marketplace_account_id = $2`,
      [tenantId, accountId],
    );
    const lastSuccess = rows.reduce<Date | null>((latest, row) => {
      const value = row.last_successful_sync_at ? new Date(row.last_successful_sync_at) : null;
      return value && (!latest || value > latest) ? value : latest;
    }, null);
    const measurable = (state: { availability: FeedbackAvailability }, sourceSuccess: boolean) =>
      state.availability === 'AVAILABLE' && sourceSuccess;
    return {
      marketplace: account.marketplace,
      individualReviews: {
        ...individual,
        count: measurable(individual, Boolean(lastSuccess)) ? Number(reviewFacts?.count || 0) : null,
        averageRating: measurable(individual, Boolean(lastSuccess)) && Number(reviewFacts?.count || 0) > 0
          ? Number(reviewFacts?.averageRating) : null,
        positive: measurable(individual, Boolean(lastSuccess)) ? Number(reviewFacts?.positive || 0) : null,
        neutral: measurable(individual, Boolean(lastSuccess)) ? Number(reviewFacts?.neutral || 0) : null,
        negative: measurable(individual, Boolean(lastSuccess)) ? Number(reviewFacts?.negative || 0) : null,
      },
      reviewInsights: {
        ...insight,
        productsAnalyzed: measurable(insight, Boolean(lastSuccess)) ? Number(insightFacts?.productsAnalyzed || 0) : null,
        positiveTopicCount: measurable(insight, Boolean(lastSuccess)) ? Number(insightFacts?.positiveTopicCount || 0) : null,
        negativeTopicCount: measurable(insight, Boolean(lastSuccess)) ? Number(insightFacts?.negativeTopicCount || 0) : null,
      },
      ratingAggregates: {
        ...rating,
        products: measurable(rating, Boolean(lastSuccess)) ? Number(ratingFacts?.products || 0) : null,
        reviewCount: measurable(rating, Boolean(lastSuccess)) ? Number(ratingFacts?.reviewCount || 0) : null,
      },
      freshness: {
        lastAttemptAt: rows.reduce<string | null>((value, row) => value || row.last_tested_at || null, null),
        lastSuccessfulSyncAt: lastSuccess?.toISOString() || null,
        nextScheduledSyncAt: null,
        sourceUpdatedAt: lastSuccess?.toISOString() || null,
        freshnessState: lastSuccess ? 'FRESH' : individual.availability === 'NOT_SUPPORTED' ? 'NOT_APPLICABLE' : 'NOT_SYNCED',
      },
      sources: rows,
    };
  }

  private async ensureBaseline(account: AccountRow): Promise<void> {
    const source = this.baselineSource(account.marketplace);
    const rows = await this.db.query<Array<{ id: string }>>(
      `INSERT INTO marketplace_feedback_sources
         (tenant_id, marketplace_account_id, marketplace, source_key, source_type,
          provider_name, display_name, status, enabled, storage_allowed, display_allowed, sentiment_allowed)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'UNVERIFIED', false, false, false, false)
       ON CONFLICT (tenant_id, marketplace_account_id, source_key)
       DO UPDATE SET updated_at = marketplace_feedback_sources.updated_at
       RETURNING id`,
      [account.tenant_id, account.id, account.marketplace, source.key, source.type, source.provider, source.name],
    );
    const sourceId = rows[0].id;
    for (const resource of RESOURCES) {
      const state = this.baseline(account.marketplace, resource);
      await this.upsertCapability(account.tenant_id, account.id, sourceId, resource,
        state.availability, state.coverage, state.reason, state.message, false);
    }
  }

  private baselineSource(marketplace: Marketplace) {
    const names: Record<Marketplace, { key: string; provider: string; name: string }> = {
      [Marketplace.AMAZON]: { key: 'amazon-customer-feedback', provider: 'Amazon', name: 'Amazon Customer Feedback API' },
      [Marketplace.EBAY]: { key: 'ebay-transaction-feedback', provider: 'eBay', name: 'eBay Transaction Feedback' },
      [Marketplace.KAUFLAND]: { key: 'kaufland-customer-experience', provider: 'Kaufland', name: 'Kaufland Customer Experience' },
      [Marketplace.OTTO]: { key: 'otto-customer-experience', provider: 'OTTO', name: 'OTTO Customer Experience' },
      [Marketplace.MEDIAMARKT]: { key: 'mediamarkt-order-evaluations', provider: 'MediaMarktSaturn', name: 'MediaMarktSaturn Evaluations' },
    };
    return { ...names[marketplace], type: MarketplaceFeedbackSourceType.OFFICIAL_API };
  }

  private baseline(marketplace: Marketplace, resource: MarketplaceFeedbackResourceType): Baseline {
    const unknown = { availability: 'UNKNOWN' as const, coverage: 'UNKNOWN' as const,
      reason: 'CAPABILITY_NOT_VERIFIED', message: 'Test feedback capability after configuring an authorized provider source.' };
    if (marketplace === Marketplace.AMAZON && resource === MarketplaceFeedbackResourceType.INDIVIDUAL_PRODUCT_REVIEWS) {
      return { availability: 'EXTERNAL_SOURCE_REQUIRED', coverage: 'NONE', reason: 'OFFICIAL_API_HAS_NO_COMPLETE_REVIEW_FEED',
        message: 'Complete individual Amazon reviews require a separately authorized review source.' };
    }
    if (marketplace === Marketplace.AMAZON && [MarketplaceFeedbackResourceType.REVIEW_INSIGHTS,
      MarketplaceFeedbackResourceType.REVIEW_TRENDS, MarketplaceFeedbackResourceType.REVIEW_SNIPPETS].includes(resource)) {
      return { ...unknown, coverage: 'INSIGHTS_ONLY' };
    }
    if (marketplace === Marketplace.EBAY && resource === MarketplaceFeedbackResourceType.SELLER_FEEDBACK) {
      return { ...unknown, coverage: 'SELLER_FEEDBACK_ONLY' };
    }
    if (marketplace === Marketplace.EBAY && resource === MarketplaceFeedbackResourceType.PRODUCT_RATING_AGGREGATE) {
      return { ...unknown, coverage: 'AGGREGATE_ONLY' };
    }
    if (marketplace === Marketplace.MEDIAMARKT && resource === MarketplaceFeedbackResourceType.ORDER_EVALUATIONS) {
      return { ...unknown, coverage: 'ORDER_EVALUATION_ONLY' };
    }
    if ([Marketplace.KAUFLAND, Marketplace.OTTO].includes(marketplace) &&
      resource === MarketplaceFeedbackResourceType.INDIVIDUAL_PRODUCT_REVIEWS) {
      return { availability: 'EXTERNAL_SOURCE_REQUIRED', coverage: 'NONE', reason: 'AUTHORIZED_SOURCE_REQUIRED',
        message: 'An authorized external or private marketplace review source is required.' };
    }
    return unknown;
  }

  private async account(tenantId: string, accountId: string): Promise<AccountRow> {
    const [account] = await this.db.query<AccountRow[]>(
      `SELECT id, tenant_id, marketplace, status FROM marketplace_accounts
       WHERE tenant_id = $1 AND id = $2 AND status <> 'DISABLED'`,
      [tenantId, accountId],
    );
    if (!account) throw new NotFoundException('Marketplace account not found');
    return account;
  }

  private capabilityRows(tenantId: string, accountId: string) {
    return this.db.query<Array<Record<string, any>>>(
      `SELECT capability.resource_type, capability.availability, capability.coverage,
        capability.reason_code, capability.message, capability.verified_at,
        source.id AS source_id, source.source_key, source.source_type, source.display_name,
        source.status AS source_status, source.enabled, source.last_tested_at,
        source.last_successful_sync_at, source.last_failed_sync_at
       FROM marketplace_feedback_capabilities capability
       JOIN marketplace_feedback_sources source ON source.id = capability.feedback_source_id
       WHERE capability.tenant_id = $1 AND capability.marketplace_account_id = $2
       ORDER BY source.priority, source.source_key, capability.resource_type`,
      [tenantId, accountId],
    );
  }

  private combine(rows: Array<Record<string, any>>) {
    return Object.fromEntries(RESOURCES.map((resource) => {
      const matches = rows.filter((row) => row.resource_type === resource);
      const selected = matches.find((row) => row.availability === 'AVAILABLE') || matches[0];
      return [resource, selected ? {
        availability: selected.availability,
        coverage: selected.coverage,
        sourceType: selected.source_type,
        lastVerifiedAt: selected.verified_at,
        reasonCode: selected.reason_code,
        message: selected.message,
      } : { availability: 'UNKNOWN', coverage: 'UNKNOWN', reasonCode: 'NO_SOURCE_CONFIGURED' }];
    })) as Record<MarketplaceFeedbackResourceType, any>;
  }

  private upsertCapability(tenantId: string, accountId: string, sourceId: string,
    resource: MarketplaceFeedbackResourceType, availability: FeedbackAvailability,
    coverage: FeedbackCoverage, reasonCode: string | null, message: string | null, overwrite: boolean) {
    return this.db.query(
      `INSERT INTO marketplace_feedback_capabilities
         (tenant_id, marketplace_account_id, feedback_source_id, resource_type,
          availability, coverage, reason_code, message, verified_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CASE WHEN $9 THEN now() ELSE NULL END)
       ON CONFLICT (feedback_source_id, resource_type) DO ${overwrite ? `UPDATE SET
         availability = EXCLUDED.availability, coverage = EXCLUDED.coverage,
         reason_code = EXCLUDED.reason_code, message = EXCLUDED.message,
         verified_at = EXCLUDED.verified_at, updated_at = now()` : 'NOTHING'}`,
      [tenantId, accountId, sourceId, resource, availability, coverage, reasonCode, message, overwrite],
    );
  }
}
