import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { SyncControlService } from './sync-control.service';

function setup() {
  const db = { query: jest.fn() };
  const flags = {
    enabled: jest.fn().mockReturnValue(true),
    integer: jest.fn().mockImplementation((_name: string,fallback: number) => fallback),
  };
  const events = { emit: jest.fn().mockResolvedValue(true) };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  return {
    db,flags,events,audit,
    service: new SyncControlService(db as never,flags as never,events as never,audit as never),
  };
}

describe('SyncControlService', () => {
  it('uses backend receipt time and rejects disabled agents', async () => {
    const { service,db } = setup();
    db.query.mockResolvedValueOnce([{ is_enabled: false }]);
    await expect(service.heartbeat('tenant-a',{
      agentId: 'agent-a',displayName: 'Office server',
    })).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('persists real heartbeat identity, connectivity, and schedule fields', async () => {
    const { service,db } = setup();
    db.query.mockResolvedValueOnce([]).mockResolvedValueOnce([{ agent_id: 'agent-a' }]);
    await service.heartbeat('tenant-a',{
      agentId: 'agent-a',displayName: 'Office server',machineName: 'JTL-01',
      serviceVersion: '1.4.0',gitSha: 'abc1234',schedulerState: 'idle',
      jtlConnectionStatus: 'connected',backendConnectionStatus: 'connected',
      lastSuccessfulSyncAt: '2026-07-28T04:25:00Z',
      nextScheduledSyncAt: '2026-07-28T04:55:00Z',
      capabilities: { commands: true,modules: ['inventory'] },
    });
    const [sql,params] = db.query.mock.calls[1];
    expect(sql).toContain('last_heartbeat_at');
    expect(sql).toContain('last_successful_sync_at');
    expect(sql).toContain('next_scheduled_sync_at');
    expect(params).toContain('abc1234');
    expect(params).toContain('2026-07-28T04:55:00Z');
  });

  it('claims a command atomically with a bounded lease', async () => {
    const { service,db } = setup();
    db.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'command-a',command_type: 'RUN_DUE_SYNC' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const result = await service.claim('tenant-a','agent-a');
    const claimSql = String(db.query.mock.calls[1][0]);
    expect(claimSql).toContain('FOR UPDATE SKIP LOCKED');
    expect(claimSql).toContain("status='claimed'");
    expect(result.leaseSeconds).toBe(120);
  });

  it('returns the same result for duplicate completion callbacks', async () => {
    const { service,db } = setup();
    db.query.mockResolvedValueOnce([{ id: 'command-a',status: 'completed' }]);
    const result = await service.finish(
      'tenant-a','agent-a','command-a','completed',{ agentId: 'agent-a' },
    );
    expect(result.status).toBe('completed');
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('marks expired command leases interrupted before status is returned', async () => {
    const { service,db } = setup();
    db.query
      .mockResolvedValueOnce([{ id: 'command-a',agent_id: 'agent-a',command_type: 'RUN_DUE_SYNC' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    await service.status('tenant-a');
    expect(String(db.query.mock.calls[0][0])).toContain("status='interrupted'");
    expect(String(db.query.mock.calls[1][0])).toContain('INSERT INTO sync_command_events');
  });

  it('keeps progress percentage nullable when total work is unknown', async () => {
    const { service,db } = setup();
    db.query.mockResolvedValueOnce([{ id: 'command-a',status: 'running' }])
      .mockResolvedValueOnce([]);
    await service.progress('tenant-a','agent-a','command-a',{
      agentId: 'agent-a',rowsProcessed: 250,message: 'Uploading accepted rows',
    });
    const params = db.query.mock.calls[0][1];
    expect(params[3]).toBeNull();
    expect(String(db.query.mock.calls[0][0])).toContain('COALESCE($4,progress_percent)');
  });

  it('reports an unreachable agent as offline rather than degraded', async () => {
    const { service,db } = setup();
    db.query
      .mockResolvedValueOnce([[],0])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    await service.status('tenant-a');
    const agentSql = String(db.query.mock.calls[1][0]);
    expect(agentSql).toContain('connection_status');
    expect(agentSql).not.toContain('degraded');
    expect(agentSql).toContain("ELSE 'offline'");
  });

  // The postgres driver answers UPDATE ... RETURNING with [rows,rowCount],
  // so these cases feed the real shape rather than a bare row array.
  describe('postgres UPDATE ... RETURNING result shape', () => {
    it('records no interruption events when no lease has expired', async () => {
      const { service,db } = setup();
      db.query
        .mockResolvedValueOnce([[],0])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      await service.status('tenant-a');
      const inserts = db.query.mock.calls
        .filter((call) => String(call[0]).includes('INSERT INTO sync_command_events'));
      expect(inserts).toHaveLength(0);
    });

    it('records one interruption event per expired command', async () => {
      const { service,db } = setup();
      db.query
        .mockResolvedValueOnce([[{ id: 'command-a',agent_id: 'agent-a',command_type: 'RUN_DUE_SYNC' }],1])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      await service.status('tenant-a');
      const insert = db.query.mock.calls
        .find((call) => String(call[0]).includes('INSERT INTO sync_command_events'));
      expect(insert).toBeDefined();
      expect(insert![1][1]).toBe('command-a');
    });

    it('reports no command available when the claim matches nothing', async () => {
      const { service,db } = setup();
      db.query
        .mockResolvedValueOnce([[],0])
        .mockResolvedValueOnce([[],0]);
      await expect(service.claim('tenant-a','agent-a')).resolves.toEqual({ command: null });
    });

    it('rejects progress for a command that is no longer active', async () => {
      const { service,db } = setup();
      db.query.mockResolvedValueOnce([[],0]);
      await expect(service.progress('tenant-a','agent-a','command-a',{
        agentId: 'agent-a',rowsProcessed: 250,
      })).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects lease renewal for a command that is no longer active', async () => {
      const { service,db } = setup();
      db.query.mockResolvedValueOnce([[],0]);
      await expect(service.renew('tenant-a','agent-a','command-a'))
        .rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects cancellation for a command that is no longer cancellable', async () => {
      const { service,db } = setup();
      db.query
        .mockResolvedValueOnce([{ status: 'queued',capabilities: {} }])
        .mockResolvedValueOnce([[],0]);
      await expect(service.cancel('tenant-a','command-a','user-a'))
        .rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
