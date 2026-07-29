using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using JtlSyncEngine.Models;
using JtlSyncEngine.Services;
using JtlSyncEngine.Runtime;
using JtlSyncEngine.Commands;

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
        private readonly ApiClient _apiClient;
        private readonly LogService _log;
        private readonly Dictionary<string, ModuleTimer> _timers = new();
        private Timer? _triggerPollTimer;
        private bool _running;
        private bool _disposed;
        private bool _pollingTriggers;
        private bool _agentStartedEventSent;
        private bool _paused;
        private DateTime _lastControlHeartbeatAt = DateTime.MinValue;
        private string? _activeCommandId;
        private readonly CommandHistoryStore _commandHistory = new();
        private readonly SchedulerOwnership _schedulerOwnership = new();

        public bool IsRunning => _running;

        // Module statuses exposed for binding
        public SyncModuleStatus OrdersStatus { get; } = new() { ModuleName = "Orders" };
        public SyncModuleStatus ProductsStatus { get; } = new() { ModuleName = "Products" };
        public SyncModuleStatus CustomersStatus { get; } = new() { ModuleName = "Customers" };
        public SyncModuleStatus InventoryStatus { get; } = new() { ModuleName = "Inventory" };

        public event Action<string>? ModuleSyncStarted;
        public event Action<string, bool>? ModuleSyncCompleted;

        public SyncScheduler(ConfigService config, SyncOrchestrator orchestrator, ApiClient apiClient, LogService log)
        {
            _config = config;
            _orchestrator = orchestrator;
            _apiClient = apiClient;
            _log = log;
        }

        public void Start(bool fireImmediately = true)
        {
            if (_running) return;
            if (!_schedulerOwnership.TryAcquire())
            {
                _log.Warn("Scheduler", "Scheduler not started: another service or standalone instance owns Global\\JtlSyncEngine-Scheduler");
                return;
            }
            if (!HasValidApiSettings())
            {
                _log.Warn("Scheduler", "Sync scheduler not started: configure a valid Backend API URL, Tenant ID, and Sync API Key first");
                _schedulerOwnership.Release();
                return;
            }
            _running = true;
            _log.Info("Scheduler", "Starting sync scheduler");

            ScheduleModule("orders", _config.Settings.OrdersSyncIntervalMinutes, OrdersStatus,
                (status, ct) => _orchestrator.SyncOrdersAsync(status, ct), fireImmediately);

            ScheduleModule("products", _config.Settings.ProductsSyncIntervalMinutes, ProductsStatus,
                (status, ct) => _orchestrator.SyncProductsAsync(status, ct), fireImmediately);

            ScheduleModule("customers", _config.Settings.CustomersSyncIntervalMinutes, CustomersStatus,
                (status, ct) => _orchestrator.SyncCustomersAsync(status, ct), fireImmediately);

            ScheduleModule("inventory", _config.Settings.InventorySyncIntervalMinutes, InventoryStatus,
                (status, ct) => _orchestrator.SyncInventoryAsync(status, ct), fireImmediately);

            // Poll backend for manual trigger requests every 10 seconds
            _triggerPollTimer = new Timer(async _ => await PollForTriggersAsync(),
                null, TimeSpan.FromSeconds(30), TimeSpan.FromSeconds(10));
            _log.Info("Scheduler", "Trigger polling started (every 10s)");
        }

        private bool HasValidApiSettings()
        {
            return
                Uri.TryCreate(_config.Settings.BackendApiUrl, UriKind.Absolute, out var uri) &&
                (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps) &&
                Guid.TryParse(_config.Settings.TenantId, out _) &&
                !string.IsNullOrWhiteSpace(_config.Secrets.ApiKey);
        }

        private void ScheduleModule(
            string moduleName,
            int intervalMinutes,
            SyncModuleStatus status,
            Func<SyncModuleStatus, CancellationToken, Task> syncFunc,
            bool fireImmediately = false)
        {
            if (_timers.ContainsKey(moduleName))
            {
                _timers[moduleName].Timer?.Dispose();
            }

            var interval = TimeSpan.FromMinutes(Math.Max(1, intervalMinutes));
            // On first start, fire after 15 seconds so data appears immediately
            var initialDelay = fireImmediately ? TimeSpan.FromSeconds(15) : interval;
            var nextFire = DateTime.UtcNow.Add(initialDelay);

            status.NextSyncTime = nextFire;

            var moduleTimer = new ModuleTimer
            {
                ModuleName = moduleName,
                IntervalMinutes = intervalMinutes,
                NextFireTime = nextFire
            };

            moduleTimer.Timer = new Timer(async _ =>
            {
                if (!_running || _disposed || _paused) return;
                if (status.IsRunning) return;

                moduleTimer.NextFireTime = DateTime.UtcNow.Add(interval);
                status.NextSyncTime = moduleTimer.NextFireTime;

                moduleTimer.CurrentCts = new CancellationTokenSource();
                ModuleSyncStarted?.Invoke(moduleName);
                var correlationId = Guid.NewGuid().ToString();
                await SendSyncEventAsync(GetMachineId(), "sync.started", "info", moduleName,
                    "running", $"{moduleName} synchronization started", correlationId);

                try
                {
                    await syncFunc(status, moduleTimer.CurrentCts.Token);
                    ModuleSyncCompleted?.Invoke(moduleName, true);
                    await SendSyncEventAsync(GetMachineId(), "sync.completed", "info", moduleName,
                        "success", $"{moduleName} synchronization completed", correlationId);
                }
                catch (Exception ex)
                {
                    _log.Error("Scheduler", $"Unhandled error in {moduleName} sync", ex);
                    ModuleSyncCompleted?.Invoke(moduleName, false);
                    await SendSyncEventAsync(GetMachineId(), "sync.failed", "error", moduleName,
                        "failed", $"{moduleName} synchronization failed", correlationId,
                        null,new { errorCode = "SCHEDULED_SYNC_FAILED", safeMessage = ex.Message });
                }
                finally
                {
                    moduleTimer.CurrentCts.Dispose();
                    moduleTimer.CurrentCts = null;
                }
            }, null, initialDelay, interval);

            _timers[moduleName] = moduleTimer;
            _log.Info("Scheduler", $"Scheduled {moduleName} every {intervalMinutes} minutes, first run in {(int)initialDelay.TotalSeconds}s");
        }

        private async Task PollForTriggersAsync()
        {
            if (!_running || _disposed || _pollingTriggers) return;
            _pollingTriggers = true;
            try
            {
                var machineId = string.IsNullOrWhiteSpace(_config.Settings.MachineId)
                    ? Environment.MachineName
                    : _config.Settings.MachineId;
                await _apiClient.SendHeartbeatAsync(new HeartbeatRequest
                {
                    MachineId = machineId,
                    MachineName = Environment.MachineName,
                    EngineVersion = typeof(SyncScheduler).Assembly.GetName().Version?.ToString() ?? "unknown",
                    OsVersion = Environment.OSVersion.ToString(),
                    Status = AnyModuleRunning() ? "running" : "idle"
                });
                if (DateTime.UtcNow - _lastControlHeartbeatAt >= TimeSpan.FromSeconds(30))
                {
                    var jtlConnected = false;
                    try
                    {
                        jtlConnected = await _orchestrator.TestJtlConnectionAsync();
                    }
                    catch (Exception connectionError)
                    {
                        _log.Debug("Scheduler",$"JTL heartbeat check failed: {connectionError.Message}");
                    }
                    await _apiClient.SendControlHeartbeatAsync(
                        machineId,
                        _paused ? "paused" : AnyModuleRunning() ? "busy" : "idle",
                        CurrentRunningModule(),
                        jtlConnected ? "connected" : "disconnected",
                        LastSuccessfulSyncAt(),
                        NextScheduledSyncAt(),
                        _activeCommandId);
                    _lastControlHeartbeatAt = DateTime.UtcNow;
                }
                if (!_agentStartedEventSent)
                {
                    await _apiClient.SendAgentEventAsync(new
                    {
                        agentId = machineId,
                        occurredAt = DateTime.UtcNow,
                        severity = "info",
                        eventType = "scheduler.started",
                        status = "running",
                        message = "Sync scheduler started",
                        serviceVersion = BuildIdentity.Version,
                        gitSha = BuildIdentity.GitSha,
                        eventKey = $"scheduler-started-{Environment.ProcessId}-{DateTime.UtcNow:yyyyMMddHHmmss}"
                    });
                    _agentStartedEventSent = true;
                }

                var commandClaim = AnyModuleRunning()
                    ? null
                    : await _apiClient.ClaimCommandAsync(machineId);
                if (commandClaim?.Command is { } command)
                {
                    await ExecuteControlCommandAsync(machineId, command);
                }

                var triggers = await _apiClient.PollTriggersAsync();
                foreach (var trigger in triggers)
                {
                    var mod = trigger.Module?.ToLower();
                    if (string.IsNullOrEmpty(mod)) continue;

                    _log.Info("Scheduler", $"Manual trigger received for {mod} (id={trigger.Id})");
                    var claim = await _apiClient.ClaimTriggerAsync(trigger.Id, machineId);
                    if (!claim.Claimed)
                    {
                        _log.Debug("Scheduler", $"Trigger {trigger.Id} not claimed: {claim.Reason}");
                        continue;
                    }

                    try
                    {
                        await _apiClient.UpdateTriggerStatusAsync(trigger.Id, new TriggerStatusUpdate
                        {
                            Status = "running",
                            ProgressPercent = 0,
                            Message = $"{mod} sync started"
                        });
                        await TriggerNowAsync(mod, trigger.SyncMode);
                        await _apiClient.UpdateTriggerStatusAsync(trigger.Id, new TriggerStatusUpdate
                        {
                            Status = "completed",
                            ProgressPercent = 100,
                            Message = $"{mod} sync completed"
                        });
                        _log.Info("Scheduler", $"Manual trigger for {mod} completed");
                    }
                    catch (Exception ex)
                    {
                        await _apiClient.UpdateTriggerStatusAsync(trigger.Id, new TriggerStatusUpdate
                        {
                            Status = "failed",
                            ErrorMessage = ex.Message
                        }, CancellationToken.None);
                        _log.Error("Scheduler", $"Manual trigger for {mod} failed: {ex.Message}", ex);
                    }
                }
            }
            catch (Exception ex)
            {
                // Non-fatal: polling failure shouldn't crash the scheduler
                _log.Debug("Scheduler", $"Trigger poll error (non-fatal): {ex.Message}");
            }
            finally
            {
                _pollingTriggers = false;
            }
        }

        private async Task ExecuteControlCommandAsync(string agentId, SyncCommandInfo command)
        {
            if (_commandHistory.TryGet(command.Id,out var previousResult))
            {
                await _apiClient.UpdateCommandAsync(command.Id,"complete",
                    new { agentId,message = "Previously completed command acknowledged",result = previousResult });
                return;
            }
            _activeCommandId = command.Id;
            using var leaseCts = new CancellationTokenSource();
            var leaseTask = RenewCommandLeaseAsync(agentId,command.Id,leaseCts.Token);
            try
            {
                await _apiClient.UpdateCommandAsync(command.Id, "progress",
                    new { agentId, progressPercent = 0, message = $"{command.CommandType} started" });
                await SendSyncEventAsync(agentId, "sync.started", "info", null, "running",
                    $"{command.CommandType} started", command.CorrelationId ?? command.Id,
                    command.Id);
                var type = command.CommandType.ToUpperInvariant();
                if (type == "SYNC_ALL_INCREMENTAL" || type == "RUN_DUE_SYNC")
                    await TriggerAllAsync();
                else if (type == "RESYNC_FULL")
                {
                    foreach (var module in new[] { "orders", "products", "customers", "inventory" })
                        await TriggerNowAsync(module, "full");
                }
                else if (type.StartsWith("RESYNC_"))
                    await TriggerNowAsync(type.Substring("RESYNC_".Length).ToLowerInvariant(), "full");
                else if (type == "TEST_BACKEND_CONNECTION")
                {
                    if (!await _apiClient.TestConnectionAsync()) throw new InvalidOperationException("Backend connection test failed");
                }
                else if (type == "TEST_JTL_CONNECTION")
                {
                    if (!await _orchestrator.TestJtlConnectionAsync())
                        throw new InvalidOperationException("JTL connection test failed");
                }
                else if (type == "RUN_DIAGNOSTICS")
                {
                    var backend = await _apiClient.TestConnectionAsync();
                    var jtl = await _orchestrator.TestJtlConnectionAsync();
                    if (!backend || !jtl)
                        throw new InvalidOperationException($"Diagnostics failed (backend={backend}, jtl={jtl})");
                }
                else if (type == "PAUSE_SCHEDULER")
                    PauseScheduledWork();
                else if (type == "RESUME_SCHEDULER")
                    ResumeScheduledWork();
                else
                    throw new InvalidOperationException($"Unsupported command type: {type}");
                var completionResult = new { success = true,type,completedAt = DateTime.UtcNow };
                await _apiClient.UpdateCommandAsync(command.Id, "complete",
                    new { agentId,message = $"{type} completed",result = completionResult });
                _commandHistory.Save(command.Id,completionResult);
                await SendSyncEventAsync(agentId, "sync.completed", "info", null, "success",
                    $"{type} completed", command.CorrelationId ?? command.Id, command.Id);
            }
            catch (Exception ex)
            {
                await _apiClient.UpdateCommandAsync(command.Id, "fail",
                    new { agentId, message = ex.Message, errorCode = "COMMAND_FAILED", errorMessage = ex.Message },
                    CancellationToken.None);
                await SendSyncEventAsync(agentId, "sync.failed", "error", null, "failed",
                    $"{command.CommandType} failed", command.CorrelationId ?? command.Id,
                    command.Id,new { errorCode = "COMMAND_FAILED", safeMessage = ex.Message });
                _log.Error("Scheduler", $"Control command {command.Id} failed: {ex.Message}", ex);
            }
            finally
            {
                leaseCts.Cancel();
                try { await leaseTask; } catch (OperationCanceledException) { }
                _activeCommandId = null;
            }
        }

        private async Task RenewCommandLeaseAsync(string agentId,string commandId,CancellationToken ct)
        {
            using var timer = new PeriodicTimer(TimeSpan.FromSeconds(30));
            while (await timer.WaitForNextTickAsync(ct))
            {
                var lease = await _apiClient.UpdateCommandAsync(
                    commandId,"lease",new { agentId },ct);
                if (lease?.Status == "cancel_requested")
                    CancelAll();
            }
        }

        private string? CurrentRunningModule() =>
            new[]
            {
                ("orders",OrdersStatus),("products",ProductsStatus),
                ("customers",CustomersStatus),("inventory",InventoryStatus),
            }.FirstOrDefault(pair => pair.Item2.IsRunning).Item1;

        private DateTime? LastSuccessfulSyncAt() =>
            new[] { OrdersStatus,ProductsStatus,CustomersStatus,InventoryStatus }
                .Where(status => status.LastSyncTime.HasValue)
                .Select(status => status.LastSyncTime)
                .Max();

        private DateTime? NextScheduledSyncAt() =>
            new[] { OrdersStatus,ProductsStatus,CustomersStatus,InventoryStatus }
                .Where(status => status.NextSyncTime.HasValue)
                .Select(status => status.NextSyncTime)
                .Min();

        public void PauseScheduledWork()
        {
            _paused = true;
            _log.Info("Scheduler","Scheduled synchronization paused; control polling remains active");
        }

        public void ResumeScheduledWork()
        {
            _paused = false;
            _log.Info("Scheduler","Scheduled synchronization resumed");
        }

        private bool AnyModuleRunning()
        {
            return OrdersStatus.IsRunning || ProductsStatus.IsRunning || CustomersStatus.IsRunning || InventoryStatus.IsRunning;
        }

        private string GetMachineId() =>
            string.IsNullOrWhiteSpace(_config.Settings.MachineId)
                ? Environment.MachineName
                : _config.Settings.MachineId;

        private Task SendSyncEventAsync(
            string machineId,
            string eventType,
            string severity,
            string? module,
            string status,
            string message,
            string correlationId,
            string? commandId = null,
            object? metadata = null)
        {
            return _apiClient.SendAgentEventAsync(new
            {
                agentId = machineId,
                occurredAt = DateTime.UtcNow,
                severity,
                eventType,
                module,
                status,
                message,
                correlationId,
                commandId,
                serviceVersion = BuildIdentity.Version,
                gitSha = BuildIdentity.GitSha,
                eventKey = $"{eventType}-{correlationId}",
                metadata
            });
        }

        public async Task TriggerNowAsync(string moduleName, string syncMode = "incremental")
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
                "orders" => (s, ct) => _orchestrator.SyncOrdersAsync(s, ct, syncMode),
                "products" => (s, ct) => _orchestrator.SyncProductsAsync(s, ct, syncMode),
                "customers" => (s, ct) => _orchestrator.SyncCustomersAsync(s, ct, syncMode),
                "inventory" => (s, ct) => _orchestrator.SyncInventoryAsync(s, ct, syncMode),
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
            _triggerPollTimer?.Dispose();
            _triggerPollTimer = null;
            foreach (var kvp in _timers)
            {
                kvp.Value.Timer?.Dispose();
            }
            _timers.Clear();
            _schedulerOwnership.Release();
            _agentStartedEventSent = false;
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
            _schedulerOwnership.Dispose();
        }
    }
}
