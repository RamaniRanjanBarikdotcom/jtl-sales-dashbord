using System.Threading;
using System.Threading.Tasks;
using JtlSyncEngine.Models;
using JtlSyncEngine.Services;

namespace JtlSyncEngine.Jobs
{
    public class OrdersSyncJob
    {
        private readonly SyncOrchestrator _orchestrator;
        private readonly LogService _log;

        public OrdersSyncJob(SyncOrchestrator orchestrator, LogService log)
        {
            _orchestrator = orchestrator;
            _log = log;
        }

        public async Task ExecuteAsync(SyncModuleStatus status, CancellationToken ct = default)
        {
            _log.Info("OrdersSyncJob", "Executing orders sync job");
            await _orchestrator.SyncOrdersAsync(status, ct);
        }
    }
}
