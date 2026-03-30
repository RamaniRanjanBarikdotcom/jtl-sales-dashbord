using System;
using System.Threading.Tasks;
using System.Windows.Input;
using JtlSyncEngine.Helpers;
using JtlSyncEngine.Jobs;
using JtlSyncEngine.Models;
using JtlSyncEngine.Services;

namespace JtlSyncEngine.ViewModels
{
    public class SettingsViewModel : BaseViewModel
    {
        private readonly ConfigService _configService;
        private readonly MssqlService _mssqlService;
        private readonly ApiClient _apiClient;
        private readonly SyncScheduler _scheduler;
        private readonly LogService _log;

        // SQL Connection
        private string _sqlHost = "";
        private int _sqlPort = 1433;
        private string _sqlDatabase = "";
        private string _sqlUsername = "";
        private string _sqlPassword = "";
        private bool _sqlWindowsAuth;

        // API
        private string _backendApiUrl = "";
        private string _apiKey = "";
        private string _tenantId = "";

        // Sync Schedule
        private int _ordersSyncInterval = 5;
        private int _productsSyncInterval = 30;
        private int _customersSyncInterval = 30;
        private int _inventorySyncInterval = 15;

        // Batch Settings
        private int _batchSize = 100;
        private int _batchDelayMs = 500;

        // App Settings
        private bool _startWithWindows;
        private bool _startMinimized;

        // Status
        private string _sqlTestResult = "";
        private string _sqlTestColor = "#64748b";
        private string _apiTestResult = "";
        private string _apiTestColor = "#64748b";
        private string _saveResult = "";
        private string _saveResultColor = "#64748b";
        private string _autoDetectResult = "";
        private string _autoDetectColor = "#64748b";
        private bool _isTesting;
        private bool _isSaving;

        #region Properties

        public string SqlHost { get => _sqlHost; set => SetProperty(ref _sqlHost, value); }
        public int SqlPort { get => _sqlPort; set => SetProperty(ref _sqlPort, value); }
        public string SqlDatabase { get => _sqlDatabase; set => SetProperty(ref _sqlDatabase, value); }
        public string SqlUsername { get => _sqlUsername; set => SetProperty(ref _sqlUsername, value); }
        public string SqlPassword { get => _sqlPassword; set => SetProperty(ref _sqlPassword, value); }
        public bool SqlWindowsAuth { get => _sqlWindowsAuth; set => SetProperty(ref _sqlWindowsAuth, value); }

        public string BackendApiUrl { get => _backendApiUrl; set => SetProperty(ref _backendApiUrl, value); }
        public string ApiKey { get => _apiKey; set => SetProperty(ref _apiKey, value); }
        public string TenantId { get => _tenantId; set => SetProperty(ref _tenantId, value); }

        public int OrdersSyncInterval { get => _ordersSyncInterval; set => SetProperty(ref _ordersSyncInterval, value); }
        public int ProductsSyncInterval { get => _productsSyncInterval; set => SetProperty(ref _productsSyncInterval, value); }
        public int CustomersSyncInterval { get => _customersSyncInterval; set => SetProperty(ref _customersSyncInterval, value); }
        public int InventorySyncInterval { get => _inventorySyncInterval; set => SetProperty(ref _inventorySyncInterval, value); }

        public int BatchSize { get => _batchSize; set => SetProperty(ref _batchSize, value); }
        public int BatchDelayMs { get => _batchDelayMs; set => SetProperty(ref _batchDelayMs, value); }

        public bool StartWithWindows { get => _startWithWindows; set => SetProperty(ref _startWithWindows, value); }
        public bool StartMinimized { get => _startMinimized; set => SetProperty(ref _startMinimized, value); }

        public string SqlTestResult { get => _sqlTestResult; set => SetProperty(ref _sqlTestResult, value); }
        public string SqlTestColor { get => _sqlTestColor; set => SetProperty(ref _sqlTestColor, value); }
        public string ApiTestResult { get => _apiTestResult; set => SetProperty(ref _apiTestResult, value); }
        public string ApiTestColor { get => _apiTestColor; set => SetProperty(ref _apiTestColor, value); }
        public string SaveResult { get => _saveResult; set => SetProperty(ref _saveResult, value); }
        public string SaveResultColor { get => _saveResultColor; set => SetProperty(ref _saveResultColor, value); }
        public string AutoDetectResult { get => _autoDetectResult; set => SetProperty(ref _autoDetectResult, value); }
        public string AutoDetectColor { get => _autoDetectColor; set => SetProperty(ref _autoDetectColor, value); }
        public bool IsTesting { get => _isTesting; set => SetProperty(ref _isTesting, value); }
        public bool IsSaving { get => _isSaving; set => SetProperty(ref _isSaving, value); }

        #endregion

        public ICommand AutoDetectJtlCommand { get; }
        public ICommand TestSqlCommand { get; }
        public ICommand TestApiCommand { get; }
        public ICommand SaveCommand { get; }

        public SettingsViewModel(
            ConfigService configService,
            MssqlService mssqlService,
            ApiClient apiClient,
            SyncScheduler scheduler,
            LogService log)
        {
            _configService = configService;
            _mssqlService = mssqlService;
            _apiClient = apiClient;
            _scheduler = scheduler;
            _log = log;

            LoadFromConfig();

            AutoDetectJtlCommand = new RelayCommand(AutoDetectJtl);
            TestSqlCommand = new AsyncRelayCommand(TestSqlConnectionAsync, () => !_isTesting);
            TestApiCommand = new AsyncRelayCommand(TestApiConnectionAsync, () => !_isTesting);
            SaveCommand = new AsyncRelayCommand(SaveSettingsAsync, () => !_isSaving);
        }

        private void AutoDetectJtl()
        {
            AutoDetectResult = "Scanning for JTL Wawi...";
            AutoDetectColor = "#60a5fa";

            try
            {
                var result = ConfigService.TryDetectJtlDatabase();
                if (result != null)
                {
                    SqlHost = result.Host;
                    SqlPort = result.Port;
                    SqlDatabase = result.Database;
                    SqlWindowsAuth = result.WindowsAuth;
                    if (!result.WindowsAuth)
                    {
                        SqlUsername = result.Username;
                        SqlPassword = result.Password;
                    }
                    AutoDetectResult = $"Found: {result.Host} / {result.Database} ({result.Source})";
                    AutoDetectColor = "#34d399";
                    _log.Info("Settings", $"JTL auto-detect: {result.Source}");
                }
                else
                {
                    AutoDetectResult = "JTL Wawi not found — enter credentials manually";
                    AutoDetectColor = "#fbbf24";
                    _log.Warn("Settings", "JTL auto-detect: no JTL installation found");
                }
            }
            catch (Exception ex)
            {
                AutoDetectResult = $"Detection error: {ex.Message}";
                AutoDetectColor = "#f87171";
            }
        }

        private void LoadFromConfig()
        {
            var s = _configService.Settings;
            var sec = _configService.Secrets;

            SqlHost = s.SqlHost;
            SqlPort = s.SqlPort;
            SqlDatabase = s.SqlDatabase;
            SqlUsername = s.SqlUsername;
            SqlPassword = sec.SqlPassword;
            SqlWindowsAuth = s.SqlWindowsAuth;

            BackendApiUrl = s.BackendApiUrl;
            ApiKey = sec.ApiKey;
            TenantId = s.TenantId;

            OrdersSyncInterval = s.OrdersSyncIntervalMinutes;
            ProductsSyncInterval = s.ProductsSyncIntervalMinutes;
            CustomersSyncInterval = s.CustomersSyncIntervalMinutes;
            InventorySyncInterval = s.InventorySyncIntervalMinutes;

            BatchSize = s.BatchSize;
            BatchDelayMs = s.BatchDelayMs;

            StartWithWindows = StartupHelper.IsStartWithWindowsEnabled();
            StartMinimized = s.StartMinimized;
        }

        private async Task TestSqlConnectionAsync()
        {
            IsTesting = true;
            SqlTestResult = "Testing...";
            SqlTestColor = "#60a5fa";

            ApplySettingsToConfig();

            try
            {
                var result = await _mssqlService.TestConnectionAsync();
                SqlTestResult = result ? "Connection successful" : "Connection failed";
                SqlTestColor = result ? "#34d399" : "#f87171";
            }
            catch (Exception ex)
            {
                SqlTestResult = $"Error: {ex.Message}";
                SqlTestColor = "#f87171";
            }
            finally
            {
                IsTesting = false;
            }
        }

        private async Task TestApiConnectionAsync()
        {
            IsTesting = true;
            ApiTestResult = "Testing...";
            ApiTestColor = "#60a5fa";

            ApplySettingsToConfig();

            try
            {
                var result = await _apiClient.TestConnectionAsync();
                ApiTestResult = result ? "API reachable" : "API not reachable";
                ApiTestColor = result ? "#34d399" : "#f87171";
            }
            catch (Exception ex)
            {
                ApiTestResult = $"Error: {ex.Message}";
                ApiTestColor = "#f87171";
            }
            finally
            {
                IsTesting = false;
            }
        }

        private async Task SaveSettingsAsync()
        {
            IsSaving = true;
            SaveResult = "Saving...";
            SaveResultColor = "#60a5fa";

            try
            {
                var settings = new AppSettings
                {
                    SqlHost = SqlHost,
                    SqlPort = SqlPort,
                    SqlDatabase = SqlDatabase,
                    SqlUsername = SqlUsername,
                    SqlWindowsAuth = SqlWindowsAuth,
                    BackendApiUrl = BackendApiUrl,
                    TenantId = TenantId,
                    OrdersSyncIntervalMinutes = OrdersSyncInterval,
                    ProductsSyncIntervalMinutes = ProductsSyncInterval,
                    CustomersSyncIntervalMinutes = CustomersSyncInterval,
                    InventorySyncIntervalMinutes = InventorySyncInterval,
                    BatchSize = BatchSize,
                    BatchDelayMs = BatchDelayMs,
                    StartMinimized = StartMinimized
                };

                var secrets = new SecretSettings
                {
                    SqlPassword = SqlPassword,
                    ApiKey = ApiKey
                };

                _configService.Save(settings, secrets);
                StartupHelper.SetStartWithWindows(StartWithWindows);

                // Restart scheduler to pick up new intervals
                _scheduler.Restart();

                SaveResult = "Settings saved successfully";
                SaveResultColor = "#34d399";
                _log.Info("Settings", "Settings saved and scheduler restarted");

                await Task.Delay(3000);
                SaveResult = "";
            }
            catch (Exception ex)
            {
                SaveResult = $"Save failed: {ex.Message}";
                SaveResultColor = "#f87171";
                _log.Error("Settings", "Failed to save settings", ex);
            }
            finally
            {
                IsSaving = false;
            }
        }

        private void ApplySettingsToConfig()
        {
            var settings = new AppSettings
            {
                SqlHost = SqlHost,
                SqlPort = SqlPort,
                SqlDatabase = SqlDatabase,
                SqlUsername = SqlUsername,
                SqlWindowsAuth = SqlWindowsAuth,
                BackendApiUrl = BackendApiUrl,
                TenantId = TenantId,
                OrdersSyncIntervalMinutes = OrdersSyncInterval,
                ProductsSyncIntervalMinutes = ProductsSyncInterval,
                CustomersSyncIntervalMinutes = CustomersSyncInterval,
                InventorySyncIntervalMinutes = InventorySyncInterval,
                BatchSize = BatchSize,
                BatchDelayMs = BatchDelayMs,
                StartMinimized = StartMinimized
            };
            var secrets = new SecretSettings
            {
                SqlPassword = SqlPassword,
                ApiKey = ApiKey
            };
            _configService.Save(settings, secrets);
        }
    }
}
