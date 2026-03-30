import { DataSource } from 'typeorm';

export async function refreshAllMatviews(dataSource: DataSource): Promise<void> {
  try {
    await dataSource.query(`SELECT refresh_all_matviews()`);
  } catch (err: any) {
    // Silently ignore if function/matviews do not exist yet
    console.warn('Could not refresh matviews:', err.message);
  }
}
