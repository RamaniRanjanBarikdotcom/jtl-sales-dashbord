using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using JtlSyncEngine.Models;
using JtlSyncEngine.Services;

namespace JtlSyncEngine.Jobs
{
    public class ModuleTimer
    {
        public string ModuleName { get; set; } = "";
        public Timer? Timer { get; set; }
        public DateTime NextFireTime { get; set; }
        public int IntervalMinutes { get; set; }
        public CancellationTokenSource? CurrentCts { get; set; }
    }

    public class SyncScheduler : IDisposable
    {
        private readonly ConfigService _config;
        private readonly SyncOrchestrator _orchestrator;
        private readonly LogService _log;
        private readonly Dictionary<string, ModuleTimer> _timers = new();
        private bool _running;
        private bool _disposed;

        // Module statuses exposed for binding
        public SyncModuleStatus OrdersStatus { get; } = new() { ModuleName = "Orders" };
        public SyncModuleStatus ProductsStatus { get; } = new() { ModuleName = "Products" };
        public SyncModuleStatus CustomersStatus { get; } = new() { ModuleName = "Customers" };
        public SyncModuleStatus InventoryStatus { get; } = new() { ModuleName = "Inventory" };

        public event Action<string>? ModuleSyncStarted;
        public event Action<string, bool>? ModuleSyncCompleted;

        public SyncScheduler(ConfigService config, SyncOrchestrator orchestrator, LogService log)
        {
            _config = config;
            _orchestrator = orchestrator;
            _log = log;
        }

        public void Start()
        {
            if (_running) return;
            _running = true;
            _log.Info("Scheduler", "Starting sync scheduler");

            ScheduleModule("orders", _config.Settings.OrdersSyncIntervalMinutes, OrdersStatus,
                (status, ct) => _orchestrator.SyncOrdersAsync(status, ct));

            ScheduleModule("products", _config.Settings.ProductsSyncIntervalMinutes, ProductsStatus,
                (status, ct) => _orchestrator.SyncProductsAsync(status, ct));

            ScheduleModule("customers", _config.Settings.CustomersSyncIntervalMinutes, CustomersStatus,
                (status, ct) => _orchestrator.SyncCustomersAsync(status, ct));

            ScheduleModule("inventory", _config.Settings.InventorySyncIntervalMinutes, InventoryStatus,
                (status, ct) => _orchestrator.SyncInventoryAsync(status, ct));
        }

        private void ScheduleModule(
            string moduleName,
            int intervalMinutes,
            SyncModuleStatus status,
            Func<SyncModuleStatus, CancellationToken, Task> syncFunc)
        {
            if (_timers.ContainsKey(moduleName))
            {
                _timers[moduleName].Timer?.Dispose();
            }

            var interval = TimeSpan.FromMinutes(Math.Max(1, intervalMinutes));
            var nextFire = DateTime.UtcNow.Add(interval);

            status.NextSyncTime = nextFire;

            var moduleTimer = new ModuleTimer
            {
                ModuleName = moduleName,
                IntervalMinutes = intervalMinutes,
                NextFireTime = nextFire
            };

            moduleTimer.Timer = new Timer(async _ =>
            {
                if (!_running || _disposed) return;
                if (status.IsRunning) return;

                moduleTimer.NextFireTime = DateTime.UtcNow.Add(interval);
                status.NextSyncTime = moduleTimer.NextFireTime;

                moduleTimer.CurrentCts = new CancellationTokenSource();
                ModuleSyncStarted?.Invoke(moduleName);

                try
                {
                    await syncFunc(status, moduleTimer.CurrentCts.Token);
                    ModuleSyncCompleted?.Invoke(moduleName, true);
                }
                catch (Exception ex)
                {
                    _log.Error("Scheduler", $"Unhandled error in {moduleName} sync", ex);
                    ModuleSyncCompleted?.Invoke(moduleName, false);
                }
                finally
                {
                    moduleTimer.CurrentCts.Dispose();
                    moduleTimer.CurrentCts = null;
                }
            }, null, interval, interval);

            _timers[moduleName] = moduleTimer;
            _log.Info("Scheduler", $"Scheduled {moduleName} every {intervalMinutes} minutes, next at {nextFire:HH:mm:ss}");
        }

        public async Task TriggerNowAsync(string moduleName)
        {
            if (!_timers.TryGetValue(moduleName, out var moduleTimer)) return;
            if (moduleTimer.CurrentCts != null) return; // Already running

            SyncModuleStatus? status = moduleName switch
            {
                "orders" => OrdersStatus,
                "products" => ProductsStatus,
                "customers" => CustomersStatus,
                "inventory" => InventoryStatus,
                _ => null
            };
            if (status == null) return;

            Func<SyncModuleStatus, CancellationToken, Task>? syncFunc = moduleName switch
            {
                "orders" => (s, ct) => _orchestrator.SyncOrdersAsync(s, ct),
                "products" => (s, ct) => _orchestrator.SyncProductsAsync(s, ct),
                "customers" => (s, ct) => _orchestrator.SyncCustomersAsync(s, ct),
                "inventory" => (s, ct) => _orchestrator.SyncInventoryAsync(s, ct),
                _ => null
            };
            if (syncFunc == null) return;

            moduleTimer.CurrentCts = new CancellationTokenSource();
            ModuleSyncStarted?.Invoke(moduleName);

            try
            {
                await syncFunc(status, moduleTimer.CurrentCts.Token);
                ModuleSyncCompleted?.Invoke(moduleName, true);
            }
            catch (Exception ex)
            {
                _log.Error("Scheduler", $"Manual trigger failed for {moduleName}", ex);
                ModuleSyncCompleted?.Invoke(moduleName, false);
            }
            finally
            {
                moduleTimer.CurrentCts?.Dispose();
                moduleTimer.CurrentCts = null;
            }
        }

        public async Task TriggerAllAsync()
        {
            _log.Info("Scheduler", "Manual trigger: all modules");
            await Task.WhenAll(
                TriggerNowAsync("orders"),
                TriggerNowAsync("products"),
                TriggerNowAsync("customers"),
                TriggerNowAsync("inventory")
            );
        }

        public void CancelAll()
        {
            foreach (var kvp in _timers)
            {
                kvp.Value.CurrentCts?.Cancel();
            }
        }

        public void Restart()
        {
            Stop();
            Start();
        }

        public void Stop()
        {
            _running = false;
            CancelAll();
            foreach (var kvp in _timers)
            {
                kvp.Value.Timer?.Dispose();
            }
            _timers.Clear();
            _log.Info("Scheduler", "Sync scheduler stopped");
        }

        public void UpdateNextSyncDisplays()
        {
            // Trigger property change for NextSyncDisplay (time-based computed property)
            OrdersStatus.NextSyncTime = OrdersStatus.NextSyncTime;
            ProductsStatus.NextSyncTime = ProductsStatus.NextSyncTime;
            CustomersStatus.NextSyncTime = CustomersStatus.NextSyncTime;
            InventoryStatus.NextSyncTime = InventoryStatus.NextSyncTime;
        }

        public void Dispose()
        {
            if (_disposed) return;
            _disposed = true;
            Stop();
        }
    }
}
