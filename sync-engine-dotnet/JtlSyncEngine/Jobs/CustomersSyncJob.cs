using System.Threading;
using System.Threading.Tasks;
using JtlSyncEngine.Models;
using JtlSyncEngine.Services;

namespace JtlSyncEngine.Jobs
{
    public class CustomersSyncJob
    {
        private readonly SyncOrchestrator _orchestrator;
        private readonly LogService _log;

        public CustomersSyncJob(SyncOrchestrator orchestrator, LogService log)
        {
            _orchestrator = orchestrator;
            _log = log;
        }

        public async Task ExecuteAsync(SyncModuleStatus status, CancellationToken ct = default)
        {
            _log.Info("CustomersSyncJob", "Executing customers sync job");
            await _orchestrator.SyncCustomersAsync(status, ct);
        }
    }
}
