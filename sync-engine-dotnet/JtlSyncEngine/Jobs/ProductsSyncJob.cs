using System.Threading;
using System.Threading.Tasks;
using JtlSyncEngine.Models;
using JtlSyncEngine.Services;

namespace JtlSyncEngine.Jobs
{
    public class ProductsSyncJob
    {
        private readonly SyncOrchestrator _orchestrator;
        private readonly LogService _log;

        public ProductsSyncJob(SyncOrchestrator orchestrator, LogService log)
        {
            _orchestrator = orchestrator;
            _log = log;
        }

        public async Task ExecuteAsync(SyncModuleStatus status, CancellationToken ct = default)
        {
            _log.Info("ProductsSyncJob", "Executing products sync job");
            await _orchestrator.SyncProductsAsync(status, ct);
        }
    }
}
