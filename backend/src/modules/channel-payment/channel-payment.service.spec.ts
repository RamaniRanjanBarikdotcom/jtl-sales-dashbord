import { BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuditService } from '../../common/audit/audit.service';
import { ChannelPaymentService } from './channel-payment.service';

describe('ChannelPaymentService', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';
  const query = jest.fn();
  const transaction = jest.fn();
  const audit = { log: jest.fn() } as unknown as AuditService;
  const service = new ChannelPaymentService(
    { query, transaction } as unknown as DataSource,
    audit,
  );

  beforeEach(() => {
    query.mockReset();
    transaction.mockReset();
    (audit.log as jest.Mock).mockReset();
  });

  it('scopes preview combinations and candidate rules to one tenant', async () => {
    query.mockResolvedValueOnce([]);

    await service.preview(tenantId, { from: '2026-07-01', to: '2026-07-31', limit: 20 });

    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][1]).toEqual([tenantId, '2026-07-01', '2026-07-31', 20]);
    expect(query.mock.calls[0][0]).toContain('WHERE o.tenant_id = $1');
    expect(query.mock.calls[0][0]).toContain('WHERE rule.tenant_id = $1');
  });

  it('keeps conflicting candidate outputs ambiguous', async () => {
    query.mockResolvedValueOnce([{
      sourcePlatform: 'other',
      sourcePayment: 'Unknown',
      sourceShipping: null,
      sourceMarketplace: null,
      sourceAccount: null,
      sourceShop: null,
      orderCount: '4',
      revenue: '100',
      channelCandidates: [
        { id: '1', value: 'Otto', evidenceStatus: 'candidate' },
        { id: '2', value: 'Kaufland', evidenceStatus: 'candidate' },
      ],
      paymentCandidates: null,
    }]);

    const [row] = await service.preview(tenantId, {});

    expect(row.channelStatus).toBe('ambiguous');
    expect(row.predictedMarketplace).toBeNull();
    expect(row.paymentStatus).toBe('unresolved');
  });

  it('builds coverage from all combinations without a row limit', async () => {
    query.mockResolvedValueOnce([]);

    const result = await service.coverage(tenantId, {});

    expect(query.mock.calls[0][1]).toEqual([tenantId, null, null, null]);
    expect(result.reconciliation.balanced).toBe(true);
  });

  it('requires an explicit confirmation before any backfill query', async () => {
    await expect(service.backfill(tenantId, 'actor', { limit: 10, confirmation: 'wrong' }))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(query).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it('does not verify a rule without explicit JTL-Wawi confirmation', async () => {
    await expect(service.decideRule(tenantId, 'actor', '22222222-2222-4222-8222-222222222222', {
      evidenceStatus: 'verified',
      enabled: true,
      evidenceReference: 'JTL order trace 42',
      confirmation: 'wrong',
    })).rejects.toThrow('confirmation is required');
    expect(query).not.toHaveBeenCalled();
  });

  it('blocks channel activation when no enabled verified rules exist', async () => {
    query.mockResolvedValueOnce([{ verified_rules: 0 }]);

    await expect(service.setActivation(tenantId, 'actor', {
      feature: 'channel',
      enabled: true,
      confirmation: 'ENABLE_VERIFIED_CANONICAL_CHANNEL',
    })).rejects.toThrow('No enabled verified channel rules exist');

    expect(query).toHaveBeenCalledTimes(1);
  });

  it('casts reused rule-decision parameters for PostgreSQL', async () => {
    const managerQuery = jest.fn()
      .mockResolvedValueOnce([[
        {
          id: 'rule-1',
          ruleKind: 'channel',
          evidenceStatus: 'verified',
          enabled: true,
          resolutionVersion: 2,
        },
      ], 1])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    transaction.mockImplementationOnce(
      async (callback: (manager: { query: jest.Mock }) => unknown) => callback({ query: managerQuery }),
    );

    await service.decideRule('tenant-1', 'actor-1', 'rule-1', {
      evidenceStatus: 'verified',
      enabled: true,
      evidenceReference: 'JTL-Wawi trace reference',
      confirmation: 'CONFIRM_JTL_WAWI_RULE_DECISION',
    });

    const decisionSql = managerQuery.mock.calls[0][0] as string;
    expect(decisionSql).toContain('evidence_status = $4::varchar');
    expect(decisionSql).toContain('enabled = $5::boolean');
    expect(decisionSql).toContain("CASE WHEN $4::varchar = 'verified'");
    expect(managerQuery.mock.calls[2][0]).toContain('SELECT tenant_id, id, resolution_version');
    expect(managerQuery.mock.calls[2][1]).toEqual(['tenant-1', 'rule-1']);
  });

  it('blocks backfill while both canonical features are disabled', async () => {
    query.mockResolvedValueOnce([{ channel_enabled: false, payment_enabled: false }]);

    await expect(service.backfill(tenantId, 'actor', {
      limit: 10,
      confirmation: 'APPLY_VERIFIED_CANONICAL_BACKFILL',
    })).rejects.toThrow('activation are disabled');

    expect(transaction).not.toHaveBeenCalled();
  });

  it('activates channel without changing payment activation', async () => {
    query
      .mockResolvedValueOnce([{ verified_rules: 1 }])
      .mockResolvedValueOnce([{
        tenantId,
        channelEnabled: true,
        paymentEnabled: false,
        resolutionVersion: 2,
      }]);

    await service.setActivation(tenantId, 'actor', {
      feature: 'channel',
      enabled: true,
      confirmation: 'ENABLE_VERIFIED_CANONICAL_CHANNEL',
    });

    const activationSql = query.mock.calls[1][0] as string;
    expect(activationSql).toContain('(tenant_id, channel_enabled, updated_by, updated_at)');
    expect(activationSql).toContain('SET channel_enabled = EXCLUDED.channel_enabled');
    expect(activationSql).not.toContain('SET payment_enabled = EXCLUDED.payment_enabled');
  });

  it('resumes from a tenant-scoped checkpoint and limits rule reprocessing to affected rows', async () => {
    query
      .mockResolvedValueOnce([{ channel_enabled: true, payment_enabled: false, resolution_version: 4 }])
      .mockResolvedValueOnce([{ unsafe_rules: 0 }])
      .mockResolvedValueOnce([{
        id: '33333333-3333-4333-8333-333333333333',
        checkpointOrderDate: '2026-07-01',
        checkpointOrderId: '100',
        processedRows: 10,
      }]);
    const managerQuery = jest.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([[
        {
          orderDate: new Date('2026-07-02T00:00:00.000Z'),
          orderId: '101',
          channelRuleId: '44444444-4444-4444-8444-444444444444',
          paymentRuleId: null,
        },
      ], 1])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    transaction.mockImplementationOnce(async (callback: (manager: { query: jest.Mock }) => unknown) => callback({ query: managerQuery }));

    const result = await service.backfill(tenantId, 'actor', {
      runId: '33333333-3333-4333-8333-333333333333',
      limit: 50,
      confirmation: 'APPLY_VERIFIED_CANONICAL_BACKFILL',
    });

    expect(query.mock.calls[2][0]).toContain("status IN ('running', 'paused', 'failed')");
    const backfillSql = managerQuery.mock.calls[1][0] as string;
    expect(backfillSql).toContain('NOT EXISTS (SELECT 1 FROM pending_rules)');
    expect(backfillSql).toContain('COALESCE(o.channel_rule_version, 0) < rule.rule_version');
    expect(backfillSql).toContain('o.order_date AS "orderDate"');
    expect(backfillSql).toContain('o.jtl_order_id::text AS "orderId"');
    expect(backfillSql).toContain('USING (tenant_id, jtl_order_id, order_date)');
    expect(backfillSql).toContain('o.order_date = resolved.order_date');
    expect(managerQuery.mock.calls[1][1]).toEqual([
      tenantId,
      50,
      '2026-07-01',
      '100',
      '33333333-3333-4333-8333-333333333333',
    ]);
    const progressSql = managerQuery.mock.calls[2][0] as string;
    expect(progressSql).toContain('status = $7::varchar');
    expect(progressSql).toContain("CASE WHEN $7::varchar = 'completed'");
    expect(managerQuery.mock.calls[2][1][4]).toBe('2026-07-02');
    expect(result.processedRows).toBe(11);
    expect(result.status).toBe('completed');
  });

  it('restores canonical values from a tenant-scoped snapshot during rollback', async () => {
    const managerQuery = jest.fn()
      .mockResolvedValueOnce([{ id: 'run-1', resolution_version: 8 }])
      .mockResolvedValueOnce([[
        { jtl_order_id: '101' },
        { jtl_order_id: '102' },
      ], 2])
      .mockResolvedValueOnce([]);
    transaction.mockImplementationOnce(async (callback: (manager: { query: jest.Mock }) => unknown) => callback({ query: managerQuery }));

    const result = await service.rollback(tenantId, 'actor', {
      runId: '33333333-3333-4333-8333-333333333333',
      confirmation: 'ROLLBACK_CANONICAL_BACKFILL',
    });

    const restoreSql = managerQuery.mock.calls[1][0] as string;
    expect(restoreSql).toContain('FROM canonical_backfill_snapshots snapshot');
    expect(restoreSql).toContain('snapshot.tenant_id = $2');
    expect(restoreSql).toContain('o.order_date = snapshot.order_date');
    expect(restoreSql).toContain('o.canonical_resolution_version = $3');
    expect(result).toEqual({
      runId: '33333333-3333-4333-8333-333333333333',
      restoredRows: 2,
      status: 'rolled_back',
    });
  });
});
