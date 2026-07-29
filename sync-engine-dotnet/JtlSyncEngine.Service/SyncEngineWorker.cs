using JtlSyncEngine.Ipc;
using JtlSyncEngine.Jobs;
using JtlSyncEngine.Models;
using JtlSyncEngine.Runtime;
using JtlSyncEngine.Services;
using Microsoft.Extensions.Hosting;

namespace JtlSyncEngine.Service
{
    public sealed class SyncEngineWorker : BackgroundService
    {
        private static readonly TimeSpan[] RetryDelays =
        {
            TimeSpan.FromSeconds(10),
            TimeSpan.FromSeconds(30),
            TimeSpan.FromSeconds(60),
            TimeSpan.FromMinutes(2),
            TimeSpan.FromMinutes(5),
        };

        private ConfigService? _config;
        private LogService? _log;
        private MssqlService? _mssql;
        private ApiClient? _api;
        private SyncScheduler? _scheduler;
        private NamedPipeControlServer? _controlServer;
        private string _runtimeStatus = "starting";
        private string? _runtimeError;

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            RuntimePaths.EnsureCurrentLayout();
            _config = new ConfigService();
            _log = new LogService();
            var watermarks = new WatermarkService(_log);
            _mssql = new MssqlService(_config, _log);
            _api = new ApiClient(_config, _log);
            var orchestrator = new SyncOrchestrator(
                _config,
                _mssql,
                _api,
                watermarks,
                _log);
            _scheduler = new SyncScheduler(_config, orchestrator, _api, _log);
            _controlServer = new NamedPipeControlServer(HandleControlRequestAsync);
            _controlServer.Start(stoppingToken);

            if (ServiceConfigurationGuard.RequiresUserContextMigration())
            {
                _runtimeStatus = "migration_required";
                _runtimeError =
                    "Legacy CurrentUser secrets require migration under the original user account.";
                _log.Warn("Service", _runtimeError);
                await Task.Delay(Timeout.InfiniteTimeSpan, stoppingToken);
                return;
            }

            if (!_config.IsValid)
            {
                _runtimeStatus = "configuration_invalid";
                _runtimeError = string.Join(" ", _config.LoadErrors);
                _log.Error("Service", _runtimeError);
                await Task.Delay(Timeout.InfiniteTimeSpan, stoppingToken);
                return;
            }

            var retryIndex = 0;
            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    _runtimeStatus = "checking_dependencies";
                    var apiOk = await _api.TestConnectionAsync(stoppingToken);
                    var sqlOk = await _mssql.TestConnectionAsync(stoppingToken);
                    if (!apiOk)
                        throw new InvalidOperationException(
                            $"Backend unavailable (backend={apiOk}).");
                    if (!sqlOk)
                        _log.Warn("Service",
                            "JTL SQL is currently unavailable; starting control heartbeat so the dashboard reports it as disconnected.");

                    _runtimeStatus = sqlOk ? "running" : "jtl_disconnected";
                    _runtimeError = sqlOk ? null : "JTL SQL connection is unavailable.";
                    _scheduler.Start(fireImmediately: false);
                    await Task.Delay(Timeout.InfiniteTimeSpan, stoppingToken);
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
                {
                    break;
                }
                catch (Exception exception)
                {
                    _runtimeStatus = "waiting_for_dependencies";
                    _runtimeError = exception.Message;
                    _log.Warn("Service", exception.Message, exception);
                    var delay = RetryDelays[Math.Min(retryIndex, RetryDelays.Length - 1)];
                    retryIndex++;
                    await Task.Delay(delay, stoppingToken);
                }
            }
        }

        private async Task<ServiceControlResponse> HandleControlRequestAsync(
            ServiceControlRequest request,
            CancellationToken cancellationToken)
        {
            if (_scheduler == null || _config == null || _mssql == null || _api == null || _log == null)
                return Failure("Service is still initializing.");

            switch (request.Command)
            {
                case "GetStatus":
                    return Success(new
                    {
                        status = _runtimeStatus,
                        error = _runtimeError,
                        schedulerRunning = _scheduler.IsRunning,
                        currentJob = CurrentJob(),
                    });
                case "GetServiceVersion":
                    return Success(new
                    {
                        version = BuildIdentity.Version,
                        gitSha = BuildIdentity.GitSha,
                        buildTime = BuildIdentity.BuildTime,
                        configurationSchemaVersion = BuildIdentity.ConfigurationSchemaVersion,
                        migrationVersion = BuildIdentity.MigrationVersion,
                    });
                case "GetLastSync":
                    return Success(ModuleStatuses().ToDictionary(
                        pair => pair.Key,
                        pair => pair.Value.LastSyncTime));
                case "GetNextSync":
                    return Success(ModuleStatuses().ToDictionary(
                        pair => pair.Key,
                        pair => pair.Value.NextSyncTime));
                case "GetCurrentJob":
                    return Success(new { module = CurrentJob() });
                case "RunSyncNow":
                    await _scheduler.TriggerNowAsync(
                        request.Payload?.Value<string>("module") ?? "inventory",
                        request.Payload?.Value<string>("syncMode") ?? "incremental");
                    return Success(new { accepted = true });
                case "PauseScheduler":
                    _scheduler.PauseScheduledWork();
                    _runtimeStatus = "paused";
                    return Success(new { paused = true });
                case "ResumeScheduler":
                    _scheduler.ResumeScheduledWork();
                    _runtimeStatus = _scheduler.IsRunning ? "running" : "blocked";
                    return Success(new { resumed = _scheduler.IsRunning });
                case "RunDiagnostics":
                    var backendOk = await _api.TestConnectionAsync(cancellationToken);
                    var jtlSqlOk = await _mssql.TestConnectionAsync(cancellationToken);
                    var includeInventory =
                        request.Payload?.Value<bool?>("inventory") == true;
                    return Success(new
                    {
                        backend = backendOk,
                        jtlSql = jtlSqlOk,
                        inventory = includeInventory && jtlSqlOk
                            ? await _mssql.RunInventoryDiagnosticsAsync(cancellationToken)
                            : null,
                    });
                case "GetRecentLogs":
                    return Success(_log.GetFiltered().TakeLast(200).Select(entry => new
                    {
                        entry.Timestamp,
                        level = entry.Level.ToString(),
                        entry.Module,
                        entry.Message,
                    }));
                case "TestJtlConnection":
                    return Success(new { ok = await _mssql.TestConnectionAsync(cancellationToken) });
                case "TestBackendConnection":
                    return Success(new { ok = await _api.TestConnectionAsync(cancellationToken) });
                case "GetSettings":
                    return Success(_config.Settings);
                case "SaveSettings":
                    var settings = request.Payload?["settings"]?.ToObject<AppSettings>();
                    var secrets = request.Payload?["secrets"]?.ToObject<SecretSettings>();
                    if (settings == null || secrets == null)
                        return Failure("Settings and secrets payloads are required.");
                    _config.Save(settings, secrets);
                    return Success(new { saved = true });
                default:
                    return Failure($"Unsupported command '{request.Command}'.");
            }
        }

        private Dictionary<string, SyncModuleStatus> ModuleStatuses() => new()
        {
            ["orders"] = _scheduler!.OrdersStatus,
            ["products"] = _scheduler.ProductsStatus,
            ["customers"] = _scheduler.CustomersStatus,
            ["inventory"] = _scheduler.InventoryStatus,
        };

        private string? CurrentJob() => ModuleStatuses()
            .FirstOrDefault(pair => pair.Value.IsRunning)
            .Key;

        private static ServiceControlResponse Success(object data) => new()
        {
            Success = true,
            Data = data,
        };

        private static ServiceControlResponse Failure(string error) => new()
        {
            Success = false,
            Error = error,
        };

        public override async Task StopAsync(CancellationToken cancellationToken)
        {
            _runtimeStatus = "stopping";
            _scheduler?.Stop();
            if (_controlServer != null)
                await _controlServer.DisposeAsync();
            _log?.Dispose();
            await base.StopAsync(cancellationToken);
        }
    }
}
