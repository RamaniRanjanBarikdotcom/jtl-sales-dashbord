import { DataSource } from 'typeorm';

export async function refreshAllMatviews(dataSource: DataSource): Promise<void> {
  try {
    await dataSource.query(`SELECT refresh_all_matviews()`);
  } catch (err: unknown) {
    // Silently ignore if function/matviews do not exist yet
    const message = err instanceof Error ? err.message : 'unknown matview refresh error';
    console.warn('Could not refresh matviews:', message);
  }
}
