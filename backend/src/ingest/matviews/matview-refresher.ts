import { MatviewRefreshCoordinator } from '../../modules/maintenance/matview-refresh-coordinator.service';

export async function refreshAllMatviews(
  coordinator: MatviewRefreshCoordinator,
): Promise<void> {
  const result = await coordinator.refresh();
  if (result.status === 'failed') {
    console.warn('Could not refresh matviews:', result.error);
  }
}
