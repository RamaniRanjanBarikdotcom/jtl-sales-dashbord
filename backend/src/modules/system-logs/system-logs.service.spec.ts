import { NotFoundException } from '@nestjs/common';
import { SystemLogsService } from './system-logs.service';

function setup() {
  const db = { query: jest.fn() };
  const flags = {
    enabled: jest.fn().mockImplementation((name: string) =>
      !['SYSTEM_LOGS_RETENTION_ENABLED'].includes(name)),
    integer: jest.fn().mockImplementation((_name: string, fallback: number) => fallback),
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  return {
    db,flags,audit,
    service: new SystemLogsService(db as any,flags as any,audit as any),
  };
}

describe('SystemLogsService', () => {
  it('sanitizes event metadata and preserves numeric fields', async () => {
    const { service,db } = setup();
    db.query.mockResolvedValue([]);

    await expect(service.emit({
      tenantId: '11111111-1111-4111-8111-111111111111',
      source: 'sync-engine',
      eventType: 'sync.completed',
      severity: 'info',
      message: 'Completed',
      rowsProcessed: 42,
      durationMs: 1200,
      metadata: { apiKey: 'unsafe',nested: { password: 'unsafe' } },
    })).resolves.toBe(true);

    const params = db.query.mock.calls[0][1];
    expect(params[13]).toBe(42);
    expect(params[14]).toBe(1200);
    expect(JSON.parse(params[18])).toEqual({
      apiKey: '[REDACTED]',
      nested: { password: '[REDACTED]' },
    });
  });

  it('does not throw when operational event persistence fails', async () => {
    const { service,db } = setup();
    db.query.mockRejectedValue(new Error('database unavailable'));
    await expect(service.emit({
      source: 'backend',eventType: 'database.connection_failed',
      severity: 'error',message: 'Database unavailable',
    })).resolves.toBe(false);
  });

  it('rejects unregistered event types before writing', async () => {
    const { service,db } = setup();
    await expect(service.emit({
      source: 'backend',eventType: 'developer.free_text_event',
      severity: 'info',message: 'Unsafe type',
    })).resolves.toBe(false);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('always scopes, bounds, filters, sorts, and paginates event queries', async () => {
    const { service,db } = setup();
    db.query.mockResolvedValueOnce([{ id: 1 }]).mockResolvedValueOnce([{ total: 1 }]);
    const result = await service.listEvents(
      { tenantIds: ['11111111-1111-4111-8111-111111111111'],includePlatform: false },
      { severity: 'error',source: 'backend',sortBy: 'durationMs',sortDirection: 'asc',page: 2,limit: 200 },
    );
    const [sql,params] = db.query.mock.calls[0];
    expect(sql).toContain('e.tenant_id=ANY($1::uuid[])');
    expect(sql).toContain('e.severity=');
    expect(sql).toContain('e.source=');
    expect(sql).toContain('e.duration_ms ASC');
    expect(sql).toContain('u.full_name AS actor_name');
    expect(sql).not.toContain('u.name AS actor_name');
    expect(params.at(-2)).toBe(200);
    expect(params.at(-1)).toBe(200);
    expect(result.pagination.total).toBe(1);
  });

  it('does not leak an event outside the resolved tenant scope', async () => {
    const { service,db } = setup();
    db.query.mockResolvedValue([]);
    await expect(service.detail(
      { tenantIds: ['tenant-a'],includePlatform: false },'99',false,
    )).rejects.toBeInstanceOf(NotFoundException);
    expect(db.query.mock.calls[0][1]).toEqual(['99',['tenant-a'],false]);
  });

  it('removes stack traces unless the elevated permission was resolved', async () => {
    const { service,db } = setup();
    db.query.mockResolvedValueOnce([{ id: 1,metadata: { stackTrace: 'private',safeMessage: 'safe' } }]);
    const safe = await service.detail({ tenantIds: ['tenant-a'],includePlatform: false },'1',false);
    expect(safe.metadata).toEqual({ safeMessage: 'safe' });
    db.query.mockResolvedValueOnce([{ id: 1,metadata: { stackTrace: 'allowed' } }]);
    const elevated = await service.detail({ tenantIds: ['tenant-a'],includePlatform: false },'1',true);
    expect(elevated.metadata.stackTrace).toBe('allowed');
  });

  it('audits successful filtered exports', async () => {
    const { service,db,audit,flags } = setup();
    flags.enabled.mockReturnValue(true);
    db.query.mockResolvedValueOnce([{ id: 1,message: 'real event' }]);
    const result = await service.export(
      { tenantIds: ['tenant-a'],includePlatform: false },'user-a',
      { format: 'csv',page: 1,limit: 50,severity: 'error' },'request-a',
    );
    expect(result.content).toContain('real event');
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'logs.export.requested' }));
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'logs.export.completed' }));
  });

  it('requires a registered tenant agent for event ingestion', async () => {
    const { service,db } = setup();
    db.query.mockResolvedValue([]);
    await expect(service.ingestAgentEvent('tenant-a',{
      agentId: 'agent-a',occurredAt: new Date().toISOString(),severity: 'info',
      eventType: 'service.started',message: 'Started',
    })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('retention uses bounded delete batches and records a summary event', async () => {
    const { service,db,flags } = setup();
    flags.enabled.mockReturnValue(true);
    db.query.mockResolvedValue([]);
    await service.runRetention();
    const deleteSql = db.query.mock.calls.map((call) => String(call[0]))
      .filter((sql) => sql.includes('WITH doomed'));
    expect(deleteSql).toHaveLength(4);
    expect(deleteSql.every((sql) => sql.includes('LIMIT 1000'))).toBe(true);
    expect(db.query.mock.calls.some((call) => String(call[0]).includes('INSERT INTO system_events'))).toBe(true);
  });
});
