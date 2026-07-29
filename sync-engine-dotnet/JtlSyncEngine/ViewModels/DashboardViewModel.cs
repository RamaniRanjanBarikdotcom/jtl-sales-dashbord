using System;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Input;
using JtlSyncEngine.Helpers;
using JtlSyncEngine.Ipc;
using JtlSyncEngine.Jobs;
using JtlSyncEngine.Models;
using JtlSyncEngine.Services;
using Newtonsoft.Json.Linq;

namespace JtlSyncEngine.ViewModels
{
    public class DashboardViewModel : BaseViewModel
    {
        private readonly SyncScheduler _scheduler;
        private readonly MssqlService _mssql;
        private readonly ApiClient _apiClient;
        private readonly LogService _log;
        private readonly NamedPipeControlClient? _serviceClient;

        private bool _isSqlConnected;
        private bool _isApiConnected;
        private string _connectionStatusText = "Checking connections...";
        private bool _isCheckingConnections;

        public SyncModuleStatus OrdersStatus => _scheduler.OrdersStatus;
        public SyncModuleStatus ProductsStatus => _scheduler.ProductsStatus;
        public SyncModuleStatus CustomersStatus => _scheduler.CustomersStatus;
        public SyncModuleStatus InventoryStatus => _scheduler.InventoryStatus;

        public bool IsSqlConnected
        {
            get => _isSqlConnected;
            set
            {
                SetProperty(ref _isSqlConnected, value);
                OnPropertyChanged(nameof(SqlDotColor));
            }
        }

        public bool IsApiConnected
        {
            get => _isApiConnected;
            set
            {
                SetProperty(ref _isApiConnected, value);
                OnPropertyChanged(nameof(ApiDotColor));
            }
        }

        public string ConnectionStatusText
        {
            get => _connectionStatusText;
            set => SetProperty(ref _connectionStatusText, value);
        }

        public bool IsCheckingConnections
        {
            get => _isCheckingConnections;
            set => SetProperty(ref _isCheckingConnections, value);
        }

        public string SqlDotColor => _isSqlConnected ? "#34d399" : "#f87171";
        public string ApiDotColor => _isApiConnected ? "#34d399" : "#f87171";

        public ICommand SyncOrdersNowCommand { get; }
        public ICommand SyncProductsNowCommand { get; }
        public ICommand SyncCustomersNowCommand { get; }
        public ICommand SyncInventoryNowCommand { get; }
        public ICommand SyncAllNowCommand { get; }
        public ICommand CheckConnectionsCommand { get; }

        public DashboardViewModel(
            SyncScheduler scheduler,
            MssqlService mssql,
            ApiClient apiClient,
            LogService log,
            NamedPipeControlClient? serviceClient = null)
        {
            _scheduler = scheduler;
            _mssql = mssql;
            _apiClient = apiClient;
            _log = log;
            _serviceClient = serviceClient;

            SyncOrdersNowCommand = new AsyncRelayCommand(
                () => TriggerNowAsync("orders"),
                () => !OrdersStatus.IsRunning);

            SyncProductsNowCommand = new AsyncRelayCommand(
                () => TriggerNowAsync("products"),
                () => !ProductsStatus.IsRunning);

            SyncCustomersNowCommand = new AsyncRelayCommand(
                () => TriggerNowAsync("customers"),
                () => !CustomersStatus.IsRunning);

            SyncInventoryNowCommand = new AsyncRelayCommand(
                () => TriggerNowAsync("inventory"),
                () => !InventoryStatus.IsRunning);

            SyncAllNowCommand = new AsyncRelayCommand(
                TriggerAllAsync,
                () => !OrdersStatus.IsRunning && !ProductsStatus.IsRunning
                      && !CustomersStatus.IsRunning && !InventoryStatus.IsRunning);

            CheckConnectionsCommand = new AsyncRelayCommand(
                CheckConnectionsAsync,
                () => !_isCheckingConnections);
        }

        public async Task CheckConnectionsAsync()
        {
            IsCheckingConnections = true;
            ConnectionStatusText = "Checking connections...";

            try
            {
                if (_serviceClient != null)
                {
                    var response = await _serviceClient.SendAsync(
                        new ServiceControlRequest { Command = "RunDiagnostics" });
                    var data = response.Data == null ? null : JObject.FromObject(response.Data);
                    IsSqlConnected = response.Success && data?.Value<bool>("jtlSql") == true;
                    IsApiConnected = response.Success && data?.Value<bool>("backend") == true;
                    ConnectionStatusText = response.Success
                        ? "Connected through Windows Service"
                        : response.Error ?? "Windows Service unavailable";
                    return;
                }

                var sqlTask = _mssql.TestConnectionAsync();
                var apiTask = _apiClient.TestConnectionAsync();

                await Task.WhenAll(sqlTask, apiTask);

                IsSqlConnected = sqlTask.Result;
                IsApiConnected = apiTask.Result;

                ConnectionStatusText = (IsSqlConnected, IsApiConnected) switch
                {
                    (true, true) => "All systems connected",
                    (true, false) => "SQL connected — API offline",
                    (false, true) => "API connected — SQL offline",
                    _ => "All systems disconnected"
                };
            }
            catch (Exception ex)
            {
                _log.Error("Dashboard", "Connection check failed", ex);
                ConnectionStatusText = $"Connection check error: {ex.Message}";
            }
            finally
            {
                IsCheckingConnections = false;
            }
        }

        private Task TriggerNowAsync(string module)
        {
            if (_serviceClient == null)
                return _scheduler.TriggerNowAsync(module);
            return SendServiceCommandAsync("RunSyncNow", new JObject
            {
                ["module"] = module,
                ["syncMode"] = "incremental",
            });
        }

        private async Task TriggerAllAsync()
        {
            if (_serviceClient == null)
            {
                await _scheduler.TriggerAllAsync();
                return;
            }

            foreach (var module in new[] { "orders", "products", "customers", "inventory" })
                await TriggerNowAsync(module);
        }

        private async Task SendServiceCommandAsync(string command, JObject? payload = null)
        {
            var response = await _serviceClient!.SendAsync(new ServiceControlRequest
            {
                Command = command,
                Payload = payload,
            });
            if (!response.Success)
                throw new InvalidOperationException(response.Error ?? "Service command failed.");
        }

        public void RefreshNextSyncDisplays()
        {
            _scheduler.UpdateNextSyncDisplays();
        }
    }
}
