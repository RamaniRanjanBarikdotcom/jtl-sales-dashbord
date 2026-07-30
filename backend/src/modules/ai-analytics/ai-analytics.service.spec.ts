import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { AiAnalyticsService } from './ai-analytics.service';

function setup(overrides: {
  toolCalls?: unknown[][];
  text?: string | null;
  answerWhenNoToolsOffered?: boolean;
} = {}) {
  // Shaped like the real driver: the period query yields Date boundaries.
  const db = {
    query: jest.fn().mockImplementation((sql: string) =>
      Promise.resolve(/AS start_date/.test(String(sql))
        ? [{ start_date: new Date(Date.UTC(2026,6,30)), end_date: new Date(Date.UTC(2026,6,30)) }]
        : [{ id: 'row-1', timezone: 'Europe/Berlin', currency: 'EUR' }]),
    ),
  };
  const flags = {
    enabled: jest.fn().mockReturnValue(true),
    integer: jest.fn().mockImplementation((_name: string,fallback: number) => fallback),
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const rounds = overrides.toolCalls ?? [[]];
  let round = 0;
  const provider = {
    configured: jest.fn().mockReturnValue(true),
    model: jest.fn().mockReturnValue('gpt-4.1-mini'),
    respond: jest.fn().mockImplementation((_input: unknown, offered: unknown[]) => {
      // Mirrors the real provider: it cannot call a tool it was not offered.
      const noTools = overrides.answerWhenNoToolsOffered && !offered.length;
      const toolCalls = noTools ? [] : (rounds[Math.min(round,rounds.length-1)] ?? []);
      round += 1;
      return Promise.resolve({
        text: toolCalls.length ? null : ('text' in overrides ? overrides.text! : 'Revenue was 100 EUR.'),
        toolCalls,
      });
    }),
  };
  return {
    db,flags,provider,audit,
    service: new AiAnalyticsService(db as never,flags as never,provider as never,audit as never),
  };
}

const ASK = { conversationId: '11111111-1111-1111-1111-111111111111', question: 'What were sales today?' };

describe('AiAnalyticsService', () => {
  it('refuses to answer when the feature flag is off', async () => {
    const { service,flags } = setup();
    flags.enabled.mockReturnValue(false);
    await expect(service.ask('tenant-a','user-a',['*'],ASK))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('refuses callers without a sales tool permission', async () => {
    const { service } = setup();
    await expect(service.ask('tenant-a','user-a',['ai.analytics.use'],ASK))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('never contacts the provider when no key is configured', async () => {
    const { service,provider } = setup();
    provider.configured.mockReturnValue(false);
    await expect(service.ask('tenant-a','user-a',['*'],ASK))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(provider.respond).not.toHaveBeenCalled();
  });

  it('scopes every conversation lookup to the calling tenant and user', async () => {
    const { service,db } = setup();
    db.query.mockResolvedValueOnce([]);
    await expect(service.ask('tenant-a','user-a',['*'],ASK)).rejects.toThrow();
    const [sql,params] = db.query.mock.calls[0];
    expect(String(sql)).toContain('tenant_id=$2');
    expect(params).toEqual([ASK.conversationId,'tenant-a','user-a']);
  });

  it('offers the model only the tools the caller is permitted to use', async () => {
    const { service,provider } = setup();
    await service.ask('tenant-a','user-a',['ai.sales.view'],ASK);
    const offered = provider.respond.mock.calls[0][1].map((tool: { name: string }) => tool.name);
    expect(offered).toEqual([
      'get_sales_summary','get_sales_trend','compare_sales_periods','get_channel_sales',
    ]);
  });

  it('ignores a tenant id supplied by the model and uses the authenticated one', async () => {
    const { service,db } = setup({
      toolCalls: [[{ callId: 'call-1', name: 'get_sales_summary', arguments: { period: 'today', tenantId: 'tenant-b' } }],[]],
    });
    await service.ask('tenant-a','user-a',['*'],ASK);
    const dataQueries = db.query.mock.calls.filter((call) => String(call[0]).includes('FROM orders o'));
    expect(dataQueries.length).toBeGreaterThan(0);
    // The model-supplied tenantId is audited verbatim in ai_tool_calls but must
    // never reach a data query.
    for (const [,params] of dataQueries) {
      expect((params as unknown[])[0]).toBe('tenant-a');
      expect(params).not.toContain('tenant-b');
    }
  });

  it('rejects a tool the caller has no permission for instead of running it', async () => {
    const { service,db } = setup({
      toolCalls: [[{ callId: 'call-1', name: 'execute_sql', arguments: {} }],[]],
    });
    await service.ask('tenant-a','user-a',['*'],ASK);
    const rejected = db.query.mock.calls.find((call) => String(call[0]).includes("status='rejected'"));
    expect(rejected).toBeDefined();
    expect(String(rejected![0])).toContain('TOOL_NOT_PERMITTED');
  });

  it('fails loudly rather than inventing an answer when the model returns none', async () => {
    const { service } = setup({ text: null });
    await expect(service.ask('tenant-a','user-a',['*'],ASK))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('answers on the final tool-free round instead of failing the question', async () => {
    // Tools every round until the budget runs out; the last round offers none,
    // so the mock falls through to returning text.
    const { service,provider,flags } = setup({
      toolCalls: [[{ callId: 'call-1', name: 'get_sales_summary', arguments: { period: 'today' } }]],
      answerWhenNoToolsOffered: true,
    });
    flags.integer.mockReturnValue(2);
    const result = await service.ask('tenant-a','user-a',['*'],ASK);
    expect(result.message).toBeDefined();
    expect(provider.respond).toHaveBeenCalledTimes(3);
    expect(provider.respond.mock.calls[2][1]).toEqual([]);
  });

  describe('status', () => {
    it('distinguishes switched off from not configured', () => {
      const { service,flags,provider } = setup();
      flags.enabled.mockReturnValue(false);
      expect(service.status()).toMatchObject({ ready: false, reason: 'FEATURE_DISABLED' });

      flags.enabled.mockReturnValue(true);
      provider.configured.mockReturnValue(false);
      expect(service.status()).toMatchObject({ ready: false, reason: 'NOT_CONFIGURED' });

      provider.configured.mockReturnValue(true);
      expect(service.status()).toMatchObject({ ready: true, reason: null });
    });

    it('reports booleans only, never the credential', () => {
      const { service } = setup();
      const status = service.status();
      expect(Object.keys(status).sort()).toEqual(['configured','enabled','ready','reason']);
      expect(JSON.stringify(status)).not.toMatch(/sk-|key/i);
    });
  });
});
