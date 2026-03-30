using System.Threading;
using System.Threading.Tasks;
using JtlSyncEngine.Models;
using JtlSyncEngine.Services;

namespace JtlSyncEngine.Jobs
{
    public class InventorySyncJob
    {
        private readonly SyncOrchestrator _orchestrator;
        private readonly LogService _log;

        public InventorySyncJob(SyncOrchestrator orchestrator, LogService log)
        {
            _orchestrator = orchestrator;
            _log = log;
        }

        public async Task ExecuteAsync(SyncModuleStatus status, CancellationToken ct = default)
        {
            _log.Info("InventorySyncJob", "Executing inventory sync job");
            await _orchestrator.SyncInventoryAsync(status, ct);
        }
    }
}
