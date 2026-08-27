import { DataSource } from 'typeorm';
import { MatviewRefreshCoordinator } from './matview-refresh-coordinator.service';

describe('MatviewRefreshCoordinator', () => {
  function setup(acquired: boolean) {
    const query = jest.fn()
      .mockResolvedValueOnce([{ acquired }])
      .mockResolvedValue([]);
    const runner = {
      connect: jest.fn().mockResolvedValue(undefined),
      query,
      release: jest.fn().mockResolvedValue(undefined),
    };
    const db = { createQueryRunner: jest.fn().mockReturnValue(runner) } as unknown as DataSource;
    return { service: new MatviewRefreshCoordinator(db), runner, query };
  }

  it('refreshes while holding a session advisory lock', async () => {
    const { service, query, runner } = setup(true);

    await expect(service.refresh()).resolves.toMatchObject({ status: 'completed' });

    expect(query.mock.calls[0][0]).toContain('pg_try_advisory_lock');
    expect(query.mock.calls[1][0]).toBe('SELECT refresh_all_matviews()');
    expect(query.mock.calls[2][0]).toContain('pg_advisory_unlock');
    expect(runner.release).toHaveBeenCalled();
  });

  it('does not overlap another refresh owner', async () => {
    const { service, query } = setup(false);

    await expect(service.refresh()).resolves.toMatchObject({ status: 'skipped_locked' });

    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toContain('pg_try_advisory_lock');
  });

  it('uses the same advisory lock for ingest-scoped view refreshes', async () => {
    const { service, query } = setup(true);

    await expect(service.refresh(['mv_product_performance'])).resolves.toMatchObject({ status: 'completed' });

    expect(query.mock.calls[0][0]).toContain('pg_try_advisory_lock');
    expect(query.mock.calls[1][0]).toBe('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_product_performance');
    expect(query.mock.calls[2][0]).toContain('pg_advisory_unlock');
  });

  it('rejects unknown view names while still releasing the lock', async () => {
    const { service, query, runner } = setup(true);

    await expect(service.refresh(['not_a_view'])).resolves.toMatchObject({ status: 'failed' });

    expect(query.mock.calls[1][0]).toContain('pg_advisory_unlock');
    expect(runner.release).toHaveBeenCalled();
  });
});
