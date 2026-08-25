import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { AuditService } from '../../../common/audit/audit.service';
import { MarketplaceCredential } from '../credentials/marketplace-credential.entity';
import { CredentialEncryptionService } from '../credentials/credential-encryption.service';
import { ConnectorRegistryService } from '../core/connector-registry.service';
import { MarketplaceFeatureService } from '../core/marketplace-feature.service';
import { MarketplaceSyncCursor } from '../sync/marketplace-sync-cursor.entity';
import { MarketplaceSyncRun } from '../sync/marketplace-sync-run.entity';
import { MarketplaceJobService } from '../queues/marketplace-job.service';
import {
  CreateMarketplaceAccountDto,
  QueueMarketplaceSyncDto,
  RotateMarketplaceCredentialDto,
  UpdateMarketplaceAccountDto,
} from './marketplace-account.dto';
import { MarketplaceAccount } from './marketplace-account.entity';
import { Marketplace } from '../core/marketplace.enum';
import { MarketplaceResource } from '../core/marketplace-resource.enum';
import { MarketplaceCapabilities } from '../core/marketplace.types';

@Injectable()
export class MarketplaceAccountService {
  constructor(
    @InjectRepository(MarketplaceAccount) private readonly accounts: Repository<MarketplaceAccount>,
    @InjectRepository(MarketplaceCredential) private readonly credentials: Repository<MarketplaceCredential>,
    @InjectRepository(MarketplaceSyncCursor) private readonly cursors: Repository<MarketplaceSyncCursor>,
    @InjectRepository(MarketplaceSyncRun) private readonly runs: Repository<MarketplaceSyncRun>,
    private readonly encryption: CredentialEncryptionService,
    private readonly connectors: ConnectorRegistryService,
    private readonly jobs: MarketplaceJobService,
    private readonly features: MarketplaceFeatureService,
    private readonly audit: AuditService,
  ) {}

  async list(tenantId: string) {
    this.features.assertApiEnabled();
    const rows = await this.accounts.find({ where: { tenant_id: tenantId }, order: { created_at: 'DESC' } });
    return rows.map((row) => this.safe(row));
  }

  async create(tenantId: string, actorId: string, dto: CreateMarketplaceAccountDto) {
    this.features.assertApiEnabled();
    this.validateCredentials(dto.marketplace, dto.credentials);
    if (dto.externalMerchantId) {
      const duplicate = await this.accounts.findOne({ where: {
        tenant_id: tenantId, marketplace: dto.marketplace, external_merchant_id: dto.externalMerchantId,
      } });
      if (duplicate) throw new ConflictException('Marketplace account already exists');
    }
    const account = await this.accounts.save(this.accounts.create({
      tenant_id: tenantId,
      marketplace: dto.marketplace,
      display_name: dto.displayName.trim(),
      external_merchant_id: dto.externalMerchantId?.trim() || null,
      region_code: dto.regionCode?.trim().toUpperCase() || null,
      currency_code: dto.currencyCode?.trim().toUpperCase() || null,
      status: 'DRAFT',
      shadow_mode: true,
      created_by: actorId,
    }));
    await this.storeCredential(tenantId, account.id, actorId, dto.credentials, null);
    await this.audit.log({ action: 'marketplace.account.created', actorId, tenantId, targetId: account.id,
      metadata: { marketplace: account.marketplace, mode: 'SHADOW' } });
    return this.safe(account);
  }

  async update(tenantId: string, actorId: string, id: string, dto: UpdateMarketplaceAccountDto) {
    this.features.assertApiEnabled();
    const account = await this.find(tenantId, id);
    if (dto.displayName !== undefined) account.display_name = dto.displayName.trim();
    if (dto.regionCode !== undefined) account.region_code = dto.regionCode.trim().toUpperCase() || null;
    if (dto.currencyCode !== undefined) account.currency_code = dto.currencyCode.trim().toUpperCase() || null;
    if (dto.paused !== undefined) account.status = dto.paused ? 'PAUSED' : 'DRAFT';
    const saved = await this.accounts.save(account);
    await this.audit.log({ action: 'marketplace.account.updated', actorId, tenantId, targetId: id,
      metadata: { status: saved.status } });
    return this.safe(saved);
  }

  async rotateCredential(tenantId: string, actorId: string, id: string, dto: RotateMarketplaceCredentialDto) {
    this.features.assertApiEnabled();
    const account = await this.find(tenantId, id);
    this.validateCredentials(account.marketplace, dto.credentials);
    await this.storeCredential(tenantId, id, actorId, dto.credentials, dto.expiresAt ? new Date(dto.expiresAt) : null);
    await this.audit.log({ action: 'marketplace.credential.rotated', actorId, tenantId, targetId: id });
    return { rotated: true };
  }

  async testConnection(tenantId: string, actorId: string, id: string) {
    this.features.assertApiEnabled();
    const account = await this.find(tenantId, id);
    const connector = this.connectors.get(account.marketplace);
    const result = await connector.testConnection({
      tenantId, accountId: account.id, marketplace: account.marketplace,
      externalMerchantId: account.external_merchant_id,
      regionCode: account.region_code, currencyCode: account.currency_code,
    });
    account.last_connection_test_at = new Date();
    account.last_connection_status = result.success ? 'CONNECTED' : 'FAILED';
    account.last_safe_error = result.success ? null : result.errorMessage?.slice(0, 500) || 'Connection failed';
    account.status = result.success ? 'ACTIVE' : account.status;
    await this.accounts.save(account);
    if (result.capabilities) await this.storeCapabilities(tenantId, account.id, result.capabilities);
    await this.audit.log({ action: 'marketplace.connection.tested', actorId, tenantId, targetId: id,
      outcome: result.success ? 'success' : 'failure', metadata: { marketplace: account.marketplace } });
    return { ...result, account: this.safe(account) };
  }

  async queueSync(tenantId: string, actorId: string, id: string, dto: QueueMarketplaceSyncDto) {
    this.features.assertQueueEnabled();
    const account = await this.find(tenantId, id);
    if (account.status !== 'ACTIVE') throw new ConflictException('Marketplace account is not active');
    let cursor = await this.cursors.findOne({ where: {
      tenant_id: tenantId, marketplace_account_id: id, resource: dto.resource,
    } });
    if (!cursor) cursor = await this.cursors.save(this.cursors.create({
      tenant_id: tenantId, marketplace_account_id: id, resource: dto.resource, committed_cursor: null,
    }));
    const run = await this.runs.save(this.runs.create({
      tenant_id: tenantId, marketplace_account_id: id, marketplace: account.marketplace,
      resource: dto.resource, trigger: 'MANUAL', status: 'QUEUED', shadow_mode: true,
      protocol_version: 1, requested_by: actorId,
    }));
    let queued: { queue: string; jobId: string };
    try {
      queued = await this.jobs.enqueue({
        protocolVersion: 1, tenantId, marketplaceAccountId: id, marketplace: account.marketplace,
        resource: dto.resource, syncRunId: run.id, cursorId: cursor.id, trigger: 'MANUAL',
        requestedAt: new Date().toISOString(), windowStart: dto.windowStart, windowEnd: dto.windowEnd,
      });
    } catch (error) {
      run.status = 'FAILED';
      run.completed_at = new Date();
      run.safe_error = 'Marketplace queue unavailable';
      await this.runs.save(run);
      throw error;
    }
    await this.audit.log({ action: 'marketplace.sync.queued', actorId, tenantId, targetId: run.id,
      metadata: { accountId: id, resource: dto.resource, queue: queued.queue, shadowMode: true } });
    return { syncRunId: run.id, status: run.status, shadowMode: true, ...queued };
  }

  async recentRuns(tenantId: string, accountId: string) {
    this.features.assertApiEnabled();
    await this.find(tenantId, accountId);
    return this.runs.find({ where: { tenant_id: tenantId, marketplace_account_id: accountId },
      order: { created_at: 'DESC' }, take: 50 });
  }

  async reconciliationSummary(tenantId: string, accountId: string) {
    this.features.assertApiEnabled();
    await this.find(tenantId, accountId);
    const rows = await this.runs.manager.query<Array<Record<string, unknown>>>(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE link.status = 'MATCHED')::int AS matched,
         COUNT(*) FILTER (WHERE link.status = 'UNRESOLVED')::int AS unresolved,
         COUNT(*) FILTER (WHERE link.status = 'CONFLICT')::int AS conflicts,
         COUNT(*) FILTER (WHERE link.status = 'IGNORED')::int AS ignored,
         COUNT(*) FILTER (WHERE link.status = 'SEPARATE')::int AS separate
       FROM marketplace_orders marketplace_order
       LEFT JOIN marketplace_order_links link
         ON link.tenant_id = marketplace_order.tenant_id
        AND link.marketplace_order_id = marketplace_order.id
       WHERE marketplace_order.tenant_id = $1 AND marketplace_order.marketplace_account_id = $2`,
      [tenantId, accountId],
    );
    const summary = rows[0] ?? {};
    const total = Number(summary.total ?? 0);
    const matched = Number(summary.matched ?? 0);
    return { ...summary, matchRate: total > 0 ? Number(((matched / total) * 100).toFixed(2)) : null,
      canonicalReadsEnabled: false, mode: 'SHADOW' };
  }

  private async find(tenantId: string, id: string): Promise<MarketplaceAccount> {
    const account = await this.accounts.findOne({ where: { id, tenant_id: tenantId } });
    if (!account) throw new NotFoundException('Marketplace account not found');
    return account;
  }

  private async storeCredential(tenantId: string, accountId: string, actorId: string,
    payload: Record<string, unknown>, expiresAt: Date | null): Promise<void> {
    const encrypted = this.encryption.encrypt(payload);
    const existing = await this.credentials.findOne({ where: { tenant_id: tenantId, marketplace_account_id: accountId } });
    await this.credentials.save(this.credentials.create({
      ...existing,
      id: existing?.id ?? randomUUID(), tenant_id: tenantId, marketplace_account_id: accountId,
      encrypted_payload: encrypted, encryption_key_id: this.encryption.currentKeyId(), encryption_version: 1,
      expires_at: expiresAt, rotated_by: actorId,
    }));
  }

  private validateCredentials(marketplace: Marketplace, credentials: Record<string, unknown>): void {
    if (marketplace !== Marketplace.AMAZON) return;
    const clientId = typeof credentials.clientId === 'string' ? credentials.clientId.trim() : '';
    const clientSecret = typeof credentials.clientSecret === 'string' ? credentials.clientSecret.trim() : '';
    if (!clientId || !clientSecret) {
      throw new ConflictException('Amazon Client ID and Client Secret are required');
    }
  }

  private async storeCapabilities(
    tenantId: string,
    accountId: string,
    capabilities: Partial<MarketplaceCapabilities>,
  ): Promise<void> {
    const resources: Array<[keyof MarketplaceCapabilities, MarketplaceResource]> = [
      ['orders', MarketplaceResource.ORDERS],
      ['orderItems', MarketplaceResource.ORDER_ITEMS],
      ['products', MarketplaceResource.PRODUCTS],
      ['listings', MarketplaceResource.LISTINGS],
      ['inventory', MarketplaceResource.INVENTORY],
      ['returns', MarketplaceResource.RETURNS],
      ['refunds', MarketplaceResource.REFUNDS],
      ['invoices', MarketplaceResource.INVOICES],
      ['financials', MarketplaceResource.FINANCIALS],
      ['advertising', MarketplaceResource.ADVERTISING],
      ['productReviews', MarketplaceResource.PRODUCT_REVIEWS],
      ['sellerFeedback', MarketplaceResource.SELLER_FEEDBACK],
      ['orderEvaluations', MarketplaceResource.ORDER_EVALUATIONS],
      ['supportCases', MarketplaceResource.SUPPORT_CASES],
    ];
    for (const [key, resource] of resources) {
      const level = capabilities[key];
      if (!level) continue;
      await this.runs.manager.query(
        `INSERT INTO marketplace_capabilities
           (tenant_id, marketplace_account_id, resource, level, source, reason)
         VALUES ($1, $2, $3, $4, 'CONNECTION_TEST', NULL)
         ON CONFLICT (tenant_id, marketplace_account_id, resource)
         DO UPDATE SET level = EXCLUDED.level, source = EXCLUDED.source,
           reason = EXCLUDED.reason, updated_at = now()`,
        [tenantId, accountId, resource, level],
      );
    }
  }

  private safe(account: MarketplaceAccount) {
    return {
      id: account.id, marketplace: account.marketplace, displayName: account.display_name,
      externalMerchantId: account.external_merchant_id, regionCode: account.region_code,
      currencyCode: account.currency_code, status: account.status, shadowMode: account.shadow_mode,
      lastConnectionTestAt: account.last_connection_test_at,
      lastConnectionStatus: account.last_connection_status, lastSafeError: account.last_safe_error,
      createdAt: account.created_at, updatedAt: account.updated_at,
    };
  }
}
