import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuditService } from '../../common/audit/audit.service';
import {
  ChannelPaymentActivationDto,
  ChannelPaymentBackfillDto,
  ChannelPaymentPreviewDto,
  ChannelPaymentRuleDecisionDto,
  ChannelPaymentRollbackDto,
} from './channel-payment.dto';

type PreviewRow = {
  sourcePlatform: string | null;
  sourcePayment: string | null;
  sourceShipping: string | null;
  sourceMarketplace: string | null;
  sourceAccount: string | null;
  sourceShop: string | null;
  orderCount: string;
  revenue: string;
  channelCandidates: Array<{ id: string; value: string; evidenceStatus: string }> | null;
  paymentCandidates: Array<{ id: string; value: string; evidenceStatus: string }> | null;
};

type ResolutionStatus = 'resolved' | 'ambiguous' | 'unresolved';

function queryRows<T extends Record<string, unknown>>(result: unknown): T[] {
  if (
    Array.isArray(result)
    && result.length === 2
    && Array.isArray(result[0])
    && typeof result[1] === 'number'
  ) {
    return result[0] as T[];
  }
  return Array.isArray(result) ? result as T[] : [];
}

function postgresDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const match = String(value).match(/^\d{4}-\d{2}-\d{2}/);
  if (!match) throw new Error('Backfill returned an invalid order date');
  return match[0];
}

@Injectable()
export class ChannelPaymentService {
  constructor(
    private readonly db: DataSource,
    private readonly audit: AuditService,
  ) {}

  async settings(tenantId: string) {
    const [settings] = await this.db.query(
      `SELECT tenant_id AS "tenantId",
              channel_shadow_enabled AS "channelShadowEnabled",
              channel_enabled AS "channelEnabled",
              payment_shadow_enabled AS "paymentShadowEnabled",
              payment_enabled AS "paymentEnabled",
              resolution_version AS "resolutionVersion",
              updated_at AS "updatedAt"
       FROM tenant_channel_payment_settings
       WHERE tenant_id = $1`,
      [tenantId],
    );
    return settings ?? {
      tenantId,
      channelShadowEnabled: false,
      channelEnabled: false,
      paymentShadowEnabled: false,
      paymentEnabled: false,
      resolutionVersion: null,
      configured: false,
    };
  }

  async rules(tenantId: string) {
    return this.db.query(
      `SELECT id,
              rule_kind AS "ruleKind",
              exact_platform AS "exactPlatform",
              exact_payment AS "exactPayment",
              exact_shipping AS "exactShipping",
              exact_marketplace_source AS "exactMarketplaceSource",
              exact_account_source AS "exactAccountSource",
              exact_shop_source AS "exactShopSource",
              canonical_marketplace AS "canonicalMarketplace",
              canonical_account AS "canonicalAccount",
              canonical_shop AS "canonicalShop",
              canonical_payment AS "canonicalPayment",
              evidence_status AS "evidenceStatus",
              enabled,
              priority,
              resolution_version AS "resolutionVersion",
              evidence_reference AS "evidenceReference",
              verified_at AS "verifiedAt"
       FROM tenant_channel_payment_rules
       WHERE tenant_id = $1
       ORDER BY enabled DESC, evidence_status, priority, id`,
      [tenantId],
    );
  }

  async preview(tenantId: string, query: ChannelPaymentPreviewDto) {
    const rows = await this.previewRows(tenantId, query);
    return rows.map((row) => this.normalizePreviewRow(row));
  }

  async coverage(tenantId: string, query: ChannelPaymentPreviewDto) {
    const rows = (await this.previewRows(tenantId, query, true))
      .map((row) => this.normalizePreviewRow(row));
    const totals = rows.reduce(
      (result, row) => {
        result.orders += row.orderCount;
        result.revenue += row.revenue;
        result.channels[row.channelStatus] += row.orderCount;
        result.payments[row.paymentStatus] += row.orderCount;
        return result;
      },
      {
        orders: 0,
        revenue: 0,
        channels: { resolved: 0, ambiguous: 0, unresolved: 0 },
        payments: { resolved: 0, ambiguous: 0, unresolved: 0 },
      },
    );
    const classifiedChannels = Object.values(totals.channels).reduce((sum, count) => sum + count, 0);
    const classifiedPayments = Object.values(totals.payments).reduce((sum, count) => sum + count, 0);
    return {
      ...totals,
      combinationCount: rows.length,
      reconciliation: {
        channelOrderDelta: totals.orders - classifiedChannels,
        paymentOrderDelta: totals.orders - classifiedPayments,
        balanced: totals.orders === classifiedChannels && totals.orders === classifiedPayments,
      },
    };
  }

  async decideRule(
    tenantId: string,
    actorId: string,
    ruleId: string,
    dto: ChannelPaymentRuleDecisionDto,
  ) {
    if (dto.confirmation !== 'CONFIRM_JTL_WAWI_RULE_DECISION') {
      throw new BadRequestException('Explicit JTL-Wawi rule confirmation is required');
    }
    if (dto.evidenceStatus === 'rejected' && dto.enabled) {
      throw new BadRequestException('Rejected rules cannot be enabled');
    }
    if (dto.evidenceStatus === 'verified' && dto.evidenceReference.trim().length < 10) {
      throw new BadRequestException('Verified rules require a specific evidence reference');
    }
    const rule = await this.db.transaction(async (manager) => {
      const [updatedRule] = queryRows<{
        id: string;
        ruleKind: string;
        evidenceStatus: string;
        enabled: boolean;
        resolutionVersion: number;
      }>(await manager.query(
        `UPDATE tenant_channel_payment_rules
         SET evidence_status = $4::varchar,
             enabled = $5::boolean,
             evidence_reference = $6,
             verified_by = CASE WHEN $4::varchar = 'verified' THEN $3::uuid ELSE NULL END,
             verified_at = CASE WHEN $4::varchar = 'verified' THEN now() ELSE NULL END,
             resolution_version = resolution_version + 1,
             updated_at = now()
         WHERE id = $1 AND tenant_id = $2
         RETURNING id, rule_kind AS "ruleKind", evidence_status AS "evidenceStatus",
                   enabled, resolution_version AS "resolutionVersion"`,
        [ruleId, tenantId, actorId, dto.evidenceStatus, dto.enabled, dto.evidenceReference.trim()],
      ));
      if (!updatedRule) return null;
      await manager.query(
        `INSERT INTO tenant_channel_payment_settings (tenant_id, resolution_version, updated_by, updated_at)
         VALUES ($1, 2, $2, now())
         ON CONFLICT (tenant_id) DO UPDATE
         SET resolution_version = tenant_channel_payment_settings.resolution_version + 1,
             updated_by = EXCLUDED.updated_by,
             updated_at = now()`,
        [tenantId, actorId],
      );
      await manager.query(
        `INSERT INTO canonical_rule_reprocess_queue (tenant_id, rule_id, rule_version)
         SELECT tenant_id, id, resolution_version
         FROM tenant_channel_payment_rules
         WHERE tenant_id = $1 AND id = $2
         ON CONFLICT (tenant_id, rule_id, rule_version) DO NOTHING`,
        [tenantId, ruleId],
      );
      return updatedRule;
    });
    if (!rule) throw new NotFoundException('Channel/payment rule not found');
    await this.audit.log({
      action: 'channel_payment.rule_decision',
      actorId,
      tenantId,
      targetId: ruleId,
      metadata: {
        evidenceStatus: dto.evidenceStatus,
        enabled: dto.enabled,
        evidenceReference: dto.evidenceReference.trim(),
      },
    });
    return rule;
  }

  async setActivation(
    tenantId: string,
    actorId: string,
    dto: ChannelPaymentActivationDto,
  ) {
    const expectedConfirmation = dto.feature === 'channel'
      ? 'ENABLE_VERIFIED_CANONICAL_CHANNEL'
      : 'ENABLE_VERIFIED_CANONICAL_PAYMENT';
    if (dto.enabled && dto.confirmation !== expectedConfirmation) {
      throw new BadRequestException(`Confirmation must be ${expectedConfirmation}`);
    }
    if (!dto.enabled && dto.confirmation !== 'DISABLE_CANONICAL_RESOLUTION') {
      throw new BadRequestException('Explicit disable confirmation is required');
    }
    if (dto.enabled) {
      const ruleKinds = dto.feature === 'channel' ? ['channel', 'combined'] : ['payment', 'combined'];
      const [{ verified_rules: verifiedRules }] = await this.db.query(
        `SELECT COUNT(*)::int AS verified_rules
         FROM tenant_channel_payment_rules
         WHERE tenant_id = $1
           AND enabled
           AND evidence_status = 'verified'
           AND rule_kind = ANY($2::text[])`,
        [tenantId, ruleKinds],
      );
      if (Number(verifiedRules) === 0) {
        throw new BadRequestException(`No enabled verified ${dto.feature} rules exist`);
      }
    }
    const column = dto.feature === 'channel' ? 'channel_enabled' : 'payment_enabled';
    const [settings] = await this.db.query(
      `INSERT INTO tenant_channel_payment_settings (tenant_id, ${column}, updated_by, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (tenant_id) DO UPDATE
       SET ${column} = EXCLUDED.${column},
           resolution_version = tenant_channel_payment_settings.resolution_version + 1,
           updated_by = EXCLUDED.updated_by,
           updated_at = now()
       RETURNING tenant_id AS "tenantId", channel_enabled AS "channelEnabled",
                 payment_enabled AS "paymentEnabled", resolution_version AS "resolutionVersion"`,
      [tenantId, dto.enabled, actorId],
    );
    await this.audit.log({
      action: 'channel_payment.activation_changed',
      actorId,
      tenantId,
      metadata: { feature: dto.feature, enabled: dto.enabled },
    });
    return settings;
  }

  async backfill(tenantId: string, actorId: string, dto: ChannelPaymentBackfillDto) {
    if (dto.confirmation !== 'APPLY_VERIFIED_CANONICAL_BACKFILL') {
      throw new BadRequestException('Explicit canonical backfill confirmation is required');
    }
    const [settings] = await this.db.query(
      `SELECT channel_enabled, payment_enabled, resolution_version
       FROM tenant_channel_payment_settings
       WHERE tenant_id = $1`,
      [tenantId],
    );
    if (!settings?.channel_enabled && !settings?.payment_enabled) {
      throw new BadRequestException('Canonical channel and payment activation are disabled');
    }
    const [{ unsafe_rules: unsafeRules }] = await this.db.query(
      `SELECT COUNT(*)::int AS unsafe_rules
       FROM tenant_channel_payment_rules
       WHERE tenant_id = $1 AND enabled AND evidence_status <> 'verified'`,
      [tenantId],
    );
    if (Number(unsafeRules) > 0) {
      throw new BadRequestException('Enabled rules must all be verified');
    }

    const [run] = dto.runId
      ? await this.db.query(
          `SELECT id, checkpoint_order_date AS "checkpointOrderDate",
                  checkpoint_order_id AS "checkpointOrderId", processed_rows AS "processedRows"
           FROM canonical_backfill_runs
           WHERE id = $1 AND tenant_id = $2 AND status IN ('running', 'paused', 'failed')`,
          [dto.runId, tenantId],
        )
      : await this.db.query(
          `INSERT INTO canonical_backfill_runs (
             tenant_id, requested_by, requested_limit, resolution_version, status
           ) VALUES ($1, $2, $3, $4, 'running')
           RETURNING id, checkpoint_order_date AS "checkpointOrderDate",
                     checkpoint_order_id AS "checkpointOrderId", processed_rows AS "processedRows"`,
          [tenantId, actorId, dto.limit, settings.resolution_version],
        );
    if (!run) throw new NotFoundException('Resumable canonical backfill run not found');
    let result: {
      runId: string;
      batchRows: number;
      processedRows: number;
      resolvedChannels: number;
      resolvedPayments: number;
      status: 'paused' | 'completed';
    };
    try {
      result = await this.db.transaction(async (manager) => {
        await manager.query(
          `UPDATE canonical_backfill_runs
           SET status = 'running', error_message = NULL, completed_at = NULL
           WHERE id = $1 AND tenant_id = $2`,
          [run.id, tenantId],
        );
        const changed = queryRows<Record<string, unknown>>(await manager.query(
          `WITH pending_rules AS (
             SELECT queue.rule_version, rule.*
             FROM canonical_rule_reprocess_queue queue
             JOIN tenant_channel_payment_rules rule
               ON rule.id = queue.rule_id AND rule.tenant_id = queue.tenant_id
             WHERE queue.tenant_id = $1 AND queue.status = 'pending'
           ), targets AS MATERIALIZED (
             SELECT o.tenant_id, o.jtl_order_id, o.order_date
             FROM orders o
             WHERE o.tenant_id = $1
               AND (
                 (
                   NOT EXISTS (SELECT 1 FROM pending_rules)
                   AND
                   (o.channel_resolution_status <> 'resolved' OR o.payment_resolution_status <> 'resolved')
                   AND ($3::date IS NULL OR (o.order_date, o.jtl_order_id) > ($3::date, $4::bigint))
                 )
                 OR EXISTS (
                   SELECT 1 FROM pending_rules rule
                   WHERE (
                     (rule.rule_kind IN ('channel', 'combined') AND COALESCE(o.channel_rule_version, 0) < rule.rule_version)
                     OR (rule.rule_kind IN ('payment', 'combined') AND COALESCE(o.payment_rule_version, 0) < rule.rule_version)
                   )
                     AND (rule.exact_platform IS NULL OR lower(trim(rule.exact_platform)) = lower(trim(COALESCE(o.source_platform_raw, o.channel, ''))))
                     AND (rule.exact_payment IS NULL OR lower(trim(rule.exact_payment)) = lower(trim(COALESCE(o.source_payment_raw, o.payment_method, ''))))
                     AND (rule.exact_shipping IS NULL OR lower(trim(rule.exact_shipping)) = lower(trim(COALESCE(o.source_shipping_raw, o.shipping_method, ''))))
                     AND (rule.exact_marketplace_source IS NULL OR lower(trim(rule.exact_marketplace_source)) = lower(trim(COALESCE(o.source_marketplace_raw, ''))))
                     AND (rule.exact_account_source IS NULL OR lower(trim(rule.exact_account_source)) = lower(trim(COALESCE(o.source_account_raw, ''))))
                     AND (rule.exact_shop_source IS NULL OR lower(trim(rule.exact_shop_source)) = lower(trim(COALESCE(o.source_shop_raw, ''))))
                 )
               )
             ORDER BY o.order_date, o.jtl_order_id
             LIMIT $2
             FOR UPDATE SKIP LOCKED
           ), snapshots AS (
             INSERT INTO canonical_backfill_snapshots (
               run_id, tenant_id, jtl_order_id, order_date,
               canonical_marketplace, canonical_marketplace_account, canonical_shop,
               canonical_payment_method, channel_resolution_status, payment_resolution_status,
               channel_rule_id, payment_rule_id, channel_rule_version, payment_rule_version,
               canonical_resolution_version, canonical_resolved_at
             )
             SELECT $5::uuid, o.tenant_id, o.jtl_order_id, o.order_date,
                    o.canonical_marketplace, o.canonical_marketplace_account, o.canonical_shop,
                    o.canonical_payment_method, o.channel_resolution_status, o.payment_resolution_status,
                    o.channel_rule_id, o.payment_rule_id, o.channel_rule_version, o.payment_rule_version,
                    o.canonical_resolution_version, o.canonical_resolved_at
             FROM orders o JOIN targets target USING (tenant_id, jtl_order_id, order_date)
             ON CONFLICT (run_id, tenant_id, jtl_order_id, order_date) DO NOTHING
             RETURNING 1
           ), resolved AS (
             SELECT o.tenant_id, o.jtl_order_id, o.order_date, r.*
             FROM orders o
             JOIN targets target USING (tenant_id, jtl_order_id, order_date)
             CROSS JOIN (SELECT COUNT(*) FROM snapshots) snapshot_guard
             LEFT JOIN LATERAL resolve_channel_payment_exact(
               o.tenant_id,
               COALESCE(o.source_platform_raw, o.channel),
               COALESCE(o.source_payment_raw, o.payment_method),
               COALESCE(o.source_shipping_raw, o.shipping_method),
               o.source_marketplace_raw,
               o.source_account_raw,
               o.source_shop_raw
             ) r ON true
           )
           UPDATE orders o
           SET canonical_marketplace = resolved.canonical_marketplace,
               canonical_marketplace_account = resolved.canonical_account,
               canonical_shop = resolved.canonical_shop,
               canonical_payment_method = resolved.canonical_payment,
               channel_resolution_status = resolved.channel_status,
               payment_resolution_status = resolved.payment_status,
               channel_rule_id = resolved.channel_rule_id,
               payment_rule_id = resolved.payment_rule_id,
               channel_rule_version = resolved.channel_rule_version,
               payment_rule_version = resolved.payment_rule_version,
               canonical_resolution_version = resolved.resolution_version,
               canonical_resolved_at = now(),
               updated_at = now()
           FROM resolved
           WHERE o.tenant_id = resolved.tenant_id
             AND o.jtl_order_id = resolved.jtl_order_id
             AND o.order_date = resolved.order_date
           RETURNING o.order_date AS "orderDate",
                     o.jtl_order_id::text AS "orderId",
                     o.channel_rule_id AS "channelRuleId",
                     o.payment_rule_id AS "paymentRuleId"`,
          [tenantId, dto.limit, run.checkpointOrderDate ?? null, run.checkpointOrderId ?? null, run.id],
        ));
        const resolvedChannels = changed.filter((row: Record<string, unknown>) => row.channelRuleId).length;
        const resolvedPayments = changed.filter((row: Record<string, unknown>) => row.paymentRuleId).length;
        const checkpoint = changed.reduce(
          (latest: { orderDate: string | null; orderId: string | null }, row: Record<string, unknown>) => {
            const orderDate = postgresDate(row.orderDate);
            const orderId = String(row.orderId);
            return !latest.orderDate
              || orderDate > latest.orderDate
              || (orderDate === latest.orderDate && BigInt(orderId) > BigInt(latest.orderId ?? '0'))
              ? { orderDate, orderId }
              : latest;
          },
          { orderDate: run.checkpointOrderDate ?? null, orderId: run.checkpointOrderId ?? null },
        );
        const status = changed.length >= dto.limit ? 'paused' : 'completed';
        await manager.query(
          `UPDATE canonical_backfill_runs
           SET processed_rows = processed_rows + $2,
               resolved_channels = resolved_channels + $3,
               resolved_payments = resolved_payments + $4,
               checkpoint_order_date = COALESCE($5::date, checkpoint_order_date),
               checkpoint_order_id = COALESCE($6::bigint, checkpoint_order_id),
               status = $7::varchar,
               completed_at = CASE WHEN $7::varchar = 'completed' THEN now() ELSE NULL END
           WHERE id = $1`,
          [run.id, changed.length, resolvedChannels, resolvedPayments, checkpoint.orderDate, checkpoint.orderId, status],
        );
        await manager.query(
          `UPDATE canonical_rule_reprocess_queue queue
           SET status = 'completed', completed_at = now()
           FROM tenant_channel_payment_rules rule
           WHERE queue.tenant_id = $1
             AND queue.status = 'pending'
             AND rule.id = queue.rule_id
             AND NOT EXISTS (
               SELECT 1 FROM orders o
               WHERE o.tenant_id = queue.tenant_id
                 AND (
                   (rule.rule_kind IN ('channel', 'combined') AND COALESCE(o.channel_rule_version, 0) < queue.rule_version)
                   OR (rule.rule_kind IN ('payment', 'combined') AND COALESCE(o.payment_rule_version, 0) < queue.rule_version)
                 )
                 AND (rule.exact_platform IS NULL OR lower(trim(rule.exact_platform)) = lower(trim(COALESCE(o.source_platform_raw, o.channel, ''))))
                 AND (rule.exact_payment IS NULL OR lower(trim(rule.exact_payment)) = lower(trim(COALESCE(o.source_payment_raw, o.payment_method, ''))))
                 AND (rule.exact_shipping IS NULL OR lower(trim(rule.exact_shipping)) = lower(trim(COALESCE(o.source_shipping_raw, o.shipping_method, ''))))
                 AND (rule.exact_marketplace_source IS NULL OR lower(trim(rule.exact_marketplace_source)) = lower(trim(COALESCE(o.source_marketplace_raw, ''))))
                 AND (rule.exact_account_source IS NULL OR lower(trim(rule.exact_account_source)) = lower(trim(COALESCE(o.source_account_raw, ''))))
                 AND (rule.exact_shop_source IS NULL OR lower(trim(rule.exact_shop_source)) = lower(trim(COALESCE(o.source_shop_raw, ''))))
             )`,
          [tenantId],
        );
        if (status === 'completed') {
          await manager.query(
            `UPDATE tenant_channel_payment_settings
             SET resolution_version = resolution_version + 1,
                 updated_at = now()
             WHERE tenant_id = $1`,
            [tenantId],
          );
        }
        return {
          runId: run.id,
          batchRows: changed.length,
          processedRows: Number(run.processedRows || 0) + changed.length,
          resolvedChannels,
          resolvedPayments,
          status,
        };
      });
    } catch (error) {
      await this.db.query(
        `UPDATE canonical_backfill_runs
         SET status = 'failed', error_message = $2, completed_at = now()
         WHERE id = $1`,
        [run.id, error instanceof Error ? error.message.slice(0, 2000) : 'Unknown backfill error'],
      );
      await this.audit.log({
        action: 'channel_payment.backfill',
        actorId,
        tenantId,
        targetId: run.id,
        outcome: 'failed',
        reason: error instanceof Error ? error.message : 'Unknown backfill error',
        metadata: { requestedLimit: dto.limit },
      });
      throw error;
    }
    await this.audit.log({
      action: 'channel_payment.backfill',
      actorId,
      tenantId,
      targetId: result.runId,
      metadata: result,
    });
    return result;
  }

  async rollback(tenantId: string, actorId: string, dto: ChannelPaymentRollbackDto) {
    if (dto.confirmation !== 'ROLLBACK_CANONICAL_BACKFILL') {
      throw new BadRequestException('Explicit canonical rollback confirmation is required');
    }
    const result = await this.db.transaction(async (manager) => {
      const [run] = await manager.query(
        `UPDATE canonical_backfill_runs
         SET rollback_status = 'running'
         WHERE id = $1 AND tenant_id = $2
           AND status IN ('paused', 'completed', 'failed')
           AND rollback_status IN ('available', 'failed')
         RETURNING id, resolution_version`,
        [dto.runId, tenantId],
      );
      if (!run) throw new NotFoundException('Rollbackable canonical backfill run not found');
      const restored = queryRows<Record<string, unknown>>(await manager.query(
        `UPDATE orders o
         SET canonical_marketplace = snapshot.canonical_marketplace,
             canonical_marketplace_account = snapshot.canonical_marketplace_account,
             canonical_shop = snapshot.canonical_shop,
             canonical_payment_method = snapshot.canonical_payment_method,
             channel_resolution_status = snapshot.channel_resolution_status,
             payment_resolution_status = snapshot.payment_resolution_status,
             channel_rule_id = snapshot.channel_rule_id,
             payment_rule_id = snapshot.payment_rule_id,
             channel_rule_version = snapshot.channel_rule_version,
             payment_rule_version = snapshot.payment_rule_version,
             canonical_resolution_version = snapshot.canonical_resolution_version,
             canonical_resolved_at = snapshot.canonical_resolved_at,
             updated_at = now()
         FROM canonical_backfill_snapshots snapshot
         WHERE snapshot.run_id = $1
           AND snapshot.tenant_id = $2
           AND o.tenant_id = snapshot.tenant_id
           AND o.jtl_order_id = snapshot.jtl_order_id
           AND o.order_date = snapshot.order_date
           AND o.canonical_resolution_version = $3
         RETURNING o.jtl_order_id`,
        [dto.runId, tenantId, run.resolution_version],
      ));
      await manager.query(
        `UPDATE canonical_backfill_runs
         SET status = 'rolled_back', rollback_status = 'completed', completed_at = now()
         WHERE id = $1`,
        [dto.runId],
      );
      return { runId: dto.runId, restoredRows: restored.length, status: 'rolled_back' as const };
    });
    await this.audit.log({
      action: 'channel_payment.backfill_rollback',
      actorId,
      tenantId,
      targetId: dto.runId,
      metadata: result,
    });
    return result;
  }

  private async previewRows(
    tenantId: string,
    query: ChannelPaymentPreviewDto,
    unbounded = false,
  ): Promise<PreviewRow[]> {
    return this.db.query(
      `WITH combinations AS (
         SELECT COALESCE(o.source_platform_raw, o.channel) AS source_platform,
                COALESCE(o.source_payment_raw, o.payment_method) AS source_payment,
                COALESCE(o.source_shipping_raw, o.shipping_method) AS source_shipping,
                o.source_marketplace_raw AS source_marketplace,
                o.source_account_raw AS source_account,
                o.source_shop_raw AS source_shop,
                COUNT(*)::bigint AS order_count,
                COALESCE(SUM(o.net_revenue), 0)::numeric AS revenue
         FROM orders o
         WHERE o.tenant_id = $1
           AND ($2::date IS NULL OR o.order_date >= $2::date)
           AND ($3::date IS NULL OR o.order_date <= $3::date)
         GROUP BY 1, 2, 3, 4, 5, 6
       )
       SELECT combination.source_platform AS "sourcePlatform",
              combination.source_payment AS "sourcePayment",
              combination.source_shipping AS "sourceShipping",
              combination.source_marketplace AS "sourceMarketplace",
              combination.source_account AS "sourceAccount",
              combination.source_shop AS "sourceShop",
              combination.order_count AS "orderCount",
              combination.revenue AS revenue,
              channel_match.candidates AS "channelCandidates",
              payment_match.candidates AS "paymentCandidates"
       FROM combinations combination
       LEFT JOIN LATERAL (
         SELECT jsonb_agg(jsonb_build_object(
           'id', rule.id,
           'value', rule.canonical_marketplace,
           'evidenceStatus', rule.evidence_status
         ) ORDER BY rule.priority, rule.id) AS candidates
         FROM tenant_channel_payment_rules rule
         WHERE rule.tenant_id = $1
           AND rule.evidence_status <> 'rejected'
           AND rule.rule_kind IN ('channel', 'combined')
           AND (rule.exact_platform IS NULL OR lower(trim(rule.exact_platform)) = lower(trim(COALESCE(combination.source_platform, ''))))
           AND (rule.exact_payment IS NULL OR lower(trim(rule.exact_payment)) = lower(trim(COALESCE(combination.source_payment, ''))))
           AND (rule.exact_shipping IS NULL OR lower(trim(rule.exact_shipping)) = lower(trim(COALESCE(combination.source_shipping, ''))))
           AND (rule.exact_marketplace_source IS NULL OR lower(trim(rule.exact_marketplace_source)) = lower(trim(COALESCE(combination.source_marketplace, ''))))
           AND (rule.exact_account_source IS NULL OR lower(trim(rule.exact_account_source)) = lower(trim(COALESCE(combination.source_account, ''))))
           AND (rule.exact_shop_source IS NULL OR lower(trim(rule.exact_shop_source)) = lower(trim(COALESCE(combination.source_shop, ''))))
       ) channel_match ON true
       LEFT JOIN LATERAL (
         SELECT jsonb_agg(jsonb_build_object(
           'id', rule.id,
           'value', rule.canonical_payment,
           'evidenceStatus', rule.evidence_status
         ) ORDER BY rule.priority, rule.id) AS candidates
         FROM tenant_channel_payment_rules rule
         WHERE rule.tenant_id = $1
           AND rule.evidence_status <> 'rejected'
           AND rule.rule_kind IN ('payment', 'combined')
           AND (rule.exact_platform IS NULL OR lower(trim(rule.exact_platform)) = lower(trim(COALESCE(combination.source_platform, ''))))
           AND (rule.exact_payment IS NULL OR lower(trim(rule.exact_payment)) = lower(trim(COALESCE(combination.source_payment, ''))))
           AND (rule.exact_shipping IS NULL OR lower(trim(rule.exact_shipping)) = lower(trim(COALESCE(combination.source_shipping, ''))))
           AND (rule.exact_marketplace_source IS NULL OR lower(trim(rule.exact_marketplace_source)) = lower(trim(COALESCE(combination.source_marketplace, ''))))
           AND (rule.exact_account_source IS NULL OR lower(trim(rule.exact_account_source)) = lower(trim(COALESCE(combination.source_account, ''))))
           AND (rule.exact_shop_source IS NULL OR lower(trim(rule.exact_shop_source)) = lower(trim(COALESCE(combination.source_shop, ''))))
       ) payment_match ON true
       ORDER BY combination.order_count DESC, combination.source_platform, combination.source_payment
       LIMIT COALESCE($4::int, 2147483647)`,
      [tenantId, query.from ?? null, query.to ?? null, unbounded ? null : query.limit ?? 100],
    );
  }

  private normalizePreviewRow(row: PreviewRow): {
    source: Record<string, string | null>;
    orderCount: number;
    revenue: number;
    channelStatus: ResolutionStatus;
    paymentStatus: ResolutionStatus;
    predictedMarketplace: string | null;
    predictedPaymentMethod: string | null;
    channelCandidates: PreviewRow['channelCandidates'];
    paymentCandidates: PreviewRow['paymentCandidates'];
  } {
    const channels = row.channelCandidates ?? [];
    const payments = row.paymentCandidates ?? [];
    const uniqueChannels = [...new Set(channels.map((candidate) => candidate.value).filter(Boolean))];
    const uniquePayments = [...new Set(payments.map((candidate) => candidate.value).filter(Boolean))];
    return {
      source: {
        platform: row.sourcePlatform,
        payment: row.sourcePayment,
        shipping: row.sourceShipping,
        marketplace: row.sourceMarketplace,
        account: row.sourceAccount,
        shop: row.sourceShop,
      },
      orderCount: Number(row.orderCount),
      revenue: Number(row.revenue),
      channelStatus: uniqueChannels.length === 1 ? 'resolved' : uniqueChannels.length > 1 ? 'ambiguous' : 'unresolved',
      paymentStatus: uniquePayments.length === 1 ? 'resolved' : uniquePayments.length > 1 ? 'ambiguous' : 'unresolved',
      predictedMarketplace: uniqueChannels.length === 1 ? uniqueChannels[0] : null,
      predictedPaymentMethod: uniquePayments.length === 1 ? uniquePayments[0] : null,
      channelCandidates: channels,
      paymentCandidates: payments,
    };
  }
}
