using System;
using System.Diagnostics;
using System.IO;
using System.Threading.Tasks;
using System.Windows.Input;
using JtlSyncEngine.Helpers;
using JtlSyncEngine.Inventory;
using JtlSyncEngine.Ipc;
using JtlSyncEngine.Jobs;
using JtlSyncEngine.Models;
using JtlSyncEngine.Runtime;
using JtlSyncEngine.Services;
using Newtonsoft.Json.Linq;

namespace JtlSyncEngine.ViewModels
{
    public class SettingsViewModel : BaseViewModel
    {
        private readonly ConfigService _configService;
        private readonly MssqlService _mssqlService;
        private readonly ApiClient _apiClient;
        private readonly SyncScheduler _scheduler;
        private readonly WatermarkService _watermarks;
        private readonly LogService _log;
        private readonly NamedPipeControlClient? _serviceClient;

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
        private int _batchSize = 200;
        private int _batchDelayMs = 150;
        private int _ordersStatusLookbackDays = 30;

        // Inventory Source Safety
        private bool _jtlReadOnlyMode = true;
        private string _inventorySourceMode = "legacy";
        private bool _inventoryDiagnosticsOnly;
        private bool _inventoryDryRun;
        private string _inventoryZeroStockPolicy = "verify";
        private bool _inventoryAllowConfirmedZeroStock = true;
        private bool _inventoryRejectUnverifiedZeroStock = true;
        private bool _inventoryRejectConflictingStockSources = true;
        private bool _inventoryRequireSourceMetadata = true;

        // App Settings
        private bool _startWithWindows;
        // Set while loading saved settings or correcting the checkbox after a failure,
        // so reflecting current state never triggers a UAC prompt of its own.
        private bool _suppressStartupApply;
        private bool _startMinimized;
        private bool _updatesEnabled = true;
        private bool _automaticDownload = true;
        private bool _automaticInstall;
        private string _releaseChannel = "stable";
        private string _maintenanceWindowStart = "02:00";
        private string _maintenanceWindowEnd = "04:00";
        private string _allowedUpdateDays = "Sunday";
        private int _updateHealthTimeoutSeconds = 120;
        private int _updateBackupsToKeep = 2;
        private string _currentInstalledVersion = BuildIdentity.Version;
        private string _currentInstalledGitSha = BuildIdentity.GitSha;
        private string _availableUpdateVersion = "Checking…";
        private string _lastUpdateResult = "No local result reported";

        // Status
        private string _sqlTestResult = "";
        private string _sqlTestColor = "#64748b";
        private string _apiTestResult = "";
        private string _apiTestColor = "#64748b";
        private string _saveResult = "";
        private string _saveResultColor = "#64748b";
        private string _autoDetectResult = "";
        private string _autoDetectColor = "#64748b";
        private string _inventoryDiagnosticsResult = "";
        private string _inventoryDiagnosticsColor = "#64748b";
        private bool _isTesting;
        private bool _isSaving;
        private string _serviceStatus = "Not checked";

        // Called after a successful save so the Dashboard can re-check connections
        public Func<Task>? OnSettingsSaved { get; set; }

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
        public int OrdersStatusLookbackDays { get => _ordersStatusLookbackDays; set => SetProperty(ref _ordersStatusLookbackDays, value); }

        public bool JtlReadOnlyMode { get => _jtlReadOnlyMode; set => SetProperty(ref _jtlReadOnlyMode, value); }
        public string InventorySourceMode { get => _inventorySourceMode; set => SetProperty(ref _inventorySourceMode, value); }
        public bool InventoryDiagnosticsOnly { get => _inventoryDiagnosticsOnly; set => SetProperty(ref _inventoryDiagnosticsOnly, value); }
        public bool InventoryDryRun { get => _inventoryDryRun; set => SetProperty(ref _inventoryDryRun, value); }
        public string InventoryZeroStockPolicy { get => _inventoryZeroStockPolicy; set => SetProperty(ref _inventoryZeroStockPolicy, value); }
        public bool InventoryAllowConfirmedZeroStock { get => _inventoryAllowConfirmedZeroStock; set => SetProperty(ref _inventoryAllowConfirmedZeroStock, value); }
        public bool InventoryRejectUnverifiedZeroStock { get => _inventoryRejectUnverifiedZeroStock; set => SetProperty(ref _inventoryRejectUnverifiedZeroStock, value); }
        public bool InventoryRejectConflictingStockSources { get => _inventoryRejectConflictingStockSources; set => SetProperty(ref _inventoryRejectConflictingStockSources, value); }
        public bool InventoryRequireSourceMetadata { get => _inventoryRequireSourceMetadata; set => SetProperty(ref _inventoryRequireSourceMetadata, value); }

        /// <summary>
        /// Registering the service happens as soon as this is toggled, not on Save.
        /// Users tick it, close the app, reboot, and expect syncing to resume; making
        /// it depend on a separate Save press silently loses that intent.
        /// </summary>
        public bool StartWithWindows
        {
            get => _startWithWindows;
            set
            {
                if (!SetProperty(ref _startWithWindows, value)) return;
                if (_suppressStartupApply) return;
                // Fire-and-forget from a property setter, so failures must be caught
                // here or they would vanish and leave the checkbox quietly lying.
                _ = ApplyAutomaticStartupSafelyAsync();
            }
        }

        private async Task ApplyAutomaticStartupSafelyAsync()
        {
            try
            {
                await ApplyAutomaticStartupAsync();
            }
            catch (Exception exception)
            {
                _log.Error("Settings", "Automatic startup change failed", exception);
                ServiceStatus = $"Automatic startup could not be changed: {exception.Message}";
                _suppressStartupApply = true;
                StartWithWindows = StartupHelper.IsStartWithWindowsEnabled();
                _suppressStartupApply = false;
            }
        }
        public bool StartMinimized { get => _startMinimized; set => SetProperty(ref _startMinimized, value); }
        public bool UpdatesEnabled { get => _updatesEnabled; set => SetProperty(ref _updatesEnabled, value); }
        public bool AutomaticDownload { get => _automaticDownload; set => SetProperty(ref _automaticDownload, value); }
        public bool AutomaticInstall { get => _automaticInstall; set => SetProperty(ref _automaticInstall, value); }
        public string ReleaseChannel { get => _releaseChannel; set => SetProperty(ref _releaseChannel, value); }
        public string MaintenanceWindowStart { get => _maintenanceWindowStart; set => SetProperty(ref _maintenanceWindowStart, value); }
        public string MaintenanceWindowEnd { get => _maintenanceWindowEnd; set => SetProperty(ref _maintenanceWindowEnd, value); }
        public string AllowedUpdateDays { get => _allowedUpdateDays; set => SetProperty(ref _allowedUpdateDays, value); }
        public int UpdateHealthTimeoutSeconds { get => _updateHealthTimeoutSeconds; set => SetProperty(ref _updateHealthTimeoutSeconds, value); }
        public int UpdateBackupsToKeep { get => _updateBackupsToKeep; set => SetProperty(ref _updateBackupsToKeep, value); }
        public string CurrentInstalledVersion { get => _currentInstalledVersion; set => SetProperty(ref _currentInstalledVersion, value); }
        public string CurrentInstalledGitSha { get => _currentInstalledGitSha; set => SetProperty(ref _currentInstalledGitSha, value); }
        public string AvailableUpdateVersion { get => _availableUpdateVersion; set => SetProperty(ref _availableUpdateVersion, value); }
        public string LastUpdateResult { get => _lastUpdateResult; set => SetProperty(ref _lastUpdateResult, value); }

        public string SqlTestResult { get => _sqlTestResult; set => SetProperty(ref _sqlTestResult, value); }
        public string SqlTestColor { get => _sqlTestColor; set => SetProperty(ref _sqlTestColor, value); }
        public string ApiTestResult { get => _apiTestResult; set => SetProperty(ref _apiTestResult, value); }
        public string ApiTestColor { get => _apiTestColor; set => SetProperty(ref _apiTestColor, value); }
        public string SaveResult { get => _saveResult; set => SetProperty(ref _saveResult, value); }
        public string SaveResultColor { get => _saveResultColor; set => SetProperty(ref _saveResultColor, value); }
        public string AutoDetectResult { get => _autoDetectResult; set => SetProperty(ref _autoDetectResult, value); }
        public string AutoDetectColor { get => _autoDetectColor; set => SetProperty(ref _autoDetectColor, value); }
        public string InventoryDiagnosticsResult { get => _inventoryDiagnosticsResult; set => SetProperty(ref _inventoryDiagnosticsResult, value); }
        public string InventoryDiagnosticsColor { get => _inventoryDiagnosticsColor; set => SetProperty(ref _inventoryDiagnosticsColor, value); }
        public bool IsTesting { get => _isTesting; set => SetProperty(ref _isTesting, value); }
        public bool IsSaving { get => _isSaving; set => SetProperty(ref _isSaving, value); }
        public string ServiceStatus { get => _serviceStatus; set => SetProperty(ref _serviceStatus, value); }

        #endregion

        public ICommand AutoDetectJtlCommand { get; }
        public ICommand TestSqlCommand { get; }
        public ICommand TestApiCommand { get; }
        public ICommand RunInventoryDiagnosticsCommand { get; }
        public ICommand SaveCommand { get; }
        public ICommand ResetWatermarksCommand { get; }
        public ICommand InstallServiceCommand { get; }
        public ICommand StartServiceCommand { get; }
        public ICommand StopServiceCommand { get; }
        public ICommand RestartServiceCommand { get; }
        public ICommand RepairServiceCommand { get; }
        public ICommand OpenServiceLogsCommand { get; }

        public SettingsViewModel(
            ConfigService configService,
            MssqlService mssqlService,
            ApiClient apiClient,
            SyncScheduler scheduler,
            WatermarkService watermarks,
            LogService log,
            NamedPipeControlClient? serviceClient = null)
        {
            _configService = configService;
            _mssqlService = mssqlService;
            _apiClient = apiClient;
            _scheduler = scheduler;
            _watermarks = watermarks;
            _log = log;
            _serviceClient = serviceClient;

            LoadFromConfig();

            AutoDetectJtlCommand = new AsyncRelayCommand(AutoDetectJtlAsync, () => !_isTesting);
            TestSqlCommand = new AsyncRelayCommand(TestSqlConnectionAsync, () => !_isTesting);
            TestApiCommand = new AsyncRelayCommand(TestApiConnectionAsync, () => !_isTesting);
            RunInventoryDiagnosticsCommand = new AsyncRelayCommand(RunInventoryDiagnosticsAsync, () => !_isTesting);
            SaveCommand = new AsyncRelayCommand(SaveSettingsAsync, () => !_isSaving);
            ResetWatermarksCommand = new AsyncRelayCommand(ResetWatermarksAsync, () => !_isSaving);
            InstallServiceCommand = new AsyncRelayCommand(
                () => RunServiceToolAsync("install-service.ps1", requireElevation: true));
            StartServiceCommand = new AsyncRelayCommand(
                () => RunServiceToolAsync("start-service.ps1", requireElevation: true));
            StopServiceCommand = new AsyncRelayCommand(
                () => RunServiceToolAsync("stop-service.ps1", requireElevation: true));
            RestartServiceCommand = new AsyncRelayCommand(
                () => RunServiceToolAsync("restart-service.ps1", requireElevation: true));
            RepairServiceCommand = new AsyncRelayCommand(
                () => RunServiceToolAsync("repair-service.ps1", requireElevation: true));
            OpenServiceLogsCommand = new RelayCommand(OpenServiceLogs);
            RefreshServiceStatus();
            _ = LoadUpdateStatusAsync();
        }

        /// <summary>
        /// Reports whether background syncing is actually registered with Windows.
        /// Without this the UI looked identical whether or not automatic startup was
        /// in place, so a failed registration was invisible until the next reboot.
        /// </summary>
        private void RefreshServiceStatus()
        {
            ServiceStatus = StartupHelper.IsStartWithWindowsEnabled()
                ? "Registered — syncing resumes automatically after a server restart"
                : "Not registered — syncing runs only while this app is open";
        }

        /// <summary>
        /// Registers or removes the background service so syncing survives a reboot.
        /// A refused UAC prompt must leave the checkbox showing the real state rather
        /// than claiming a startup change that never happened.
        /// </summary>
        private async Task ApplyAutomaticStartupAsync()
        {
            var alreadyEnabled = StartupHelper.IsStartWithWindowsEnabled();
            if (alreadyEnabled == StartWithWindows) return;

            // Only one scheduler may exist, and this app currently owns the global
            // mutex. The service calls Start() once at boot and silently gives up if
            // the mutex is taken, so hand it over before registering or the service
            // would run without ever syncing until the next restart.
            if (StartWithWindows) _scheduler.Stop();

            var result = await StartupHelper.SetStartWithWindowsAsync(StartWithWindows);
            var effective = StartupHelper.IsStartWithWindowsEnabled();

            if (!result.Succeeded)
            {
                _log.Warn("Settings", $"Automatic startup unchanged: {result.Error}");
                ServiceStatus = result.Error ?? "Automatic startup could not be changed.";
                // Nothing took over, so resume local syncing rather than leaving the
                // machine with no scheduler at all.
                if (StartWithWindows && !effective) _scheduler.Start(fireImmediately: false);
            }
            else
            {
                _log.Info(
                    "Settings",
                    StartWithWindows
                        ? "Background service registered; syncing will resume automatically after a restart"
                        : "Background service removed; syncing runs only while this app is open");
                ServiceStatus = StartWithWindows
                    ? "Registered — starts automatically after a server restart"
                    : "Removed — syncing runs only while this app is open";

                // The service was just unregistered and released the mutex, so this
                // app becomes the scheduler again.
                if (!StartWithWindows) _scheduler.Start(fireImmediately: false);
            }

            // Reflect what Windows actually reports, not what was requested. Suppressed
            // so correcting the checkbox cannot re-enter this method.
            _suppressStartupApply = true;
            try
            {
                StartWithWindows = effective;
            }
            finally
            {
                _suppressStartupApply = false;
            }
        }

        private async Task RunServiceToolAsync(
            string scriptName,
            bool requireElevation)
        {
            var script = Path.Combine(
                AppContext.BaseDirectory,
                "service-tools",
                scriptName);
            if (!File.Exists(script))
                throw new FileNotFoundException(
                    $"Service tool not found: {script}",
                    script);

            var arguments = $"-NoProfile -ExecutionPolicy Bypass -File \"{script}\"";
            // Only the scripts that register the service take these. start/stop/restart
            // would fail outright on an unexpected parameter.
            if (scriptName is "install-service.ps1" or "repair-service.ps1")
            {
                // There is no installer, so the service must be registered from
                // wherever the ZIP was extracted. Elevation also changes what
                // %APPDATA% resolves to, so the legacy path is passed explicitly.
                arguments +=
                    $" -InstallDirectory \"{AppContext.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar)}\"" +
                    $" -LegacyDataPath \"{RuntimePaths.LegacyRoot.TrimEnd(Path.DirectorySeparatorChar)}\"";
            }

            var startInfo = new ProcessStartInfo
            {
                FileName = "powershell.exe",
                Arguments = arguments,
                UseShellExecute = true,
                Verb = requireElevation ? "runas" : "",
            };
            using var process = Process.Start(startInfo)
                ?? throw new InvalidOperationException("Unable to start service tool.");
            await process.WaitForExitAsync();
            if (process.ExitCode == 0)
            {
                // Keep the checkbox honest after Install/Uninstall is run by hand.
                _suppressStartupApply = true;
                StartWithWindows = StartupHelper.IsStartWithWindowsEnabled();
                _suppressStartupApply = false;
                RefreshServiceStatus();
            }
            else
            {
                ServiceStatus = $"{scriptName} failed with exit code {process.ExitCode}";
            }
        }

        private static void OpenServiceLogs()
        {
            var logs = Path.Combine(
                RuntimePaths.CurrentRoot,
                "logs");
            Directory.CreateDirectory(logs);
            Process.Start(new ProcessStartInfo
            {
                FileName = "explorer.exe",
                Arguments = $"\"{logs}\"",
                UseShellExecute = true,
            });
        }

        private async Task AutoDetectJtlAsync()
        {
            IsTesting = true;
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
                    if (!result.PreserveCredentials)
                    {
                        SqlWindowsAuth = result.WindowsAuth;
                        if (!result.WindowsAuth)
                        {
                            SqlUsername = result.Username;
                            SqlPassword = result.Password;
                        }
                    }
                    _log.Info("Settings", $"JTL auto-detect: {result.Source}");
                    var originalWindowsAuth = SqlWindowsAuth;
                    ApplySettingsToConfig();
                    var connected = await _mssqlService.TestConnectionAsync();
                    if (!connected)
                    {
                        var canTrySqlAuthentication =
                            originalWindowsAuth &&
                            !string.IsNullOrWhiteSpace(SqlUsername) &&
                            !string.IsNullOrWhiteSpace(SqlPassword);
                        var canTryWindowsAuthentication = !originalWindowsAuth;
                        if (canTrySqlAuthentication || canTryWindowsAuthentication)
                        {
                            SqlWindowsAuth = !originalWindowsAuth;
                            ApplySettingsToConfig();
                            connected = await _mssqlService.TestConnectionAsync();
                            if (!connected)
                            {
                                SqlWindowsAuth = originalWindowsAuth;
                                ApplySettingsToConfig();
                            }
                        }
                    }
                    if (connected)
                    {
                        var authentication = SqlWindowsAuth
                            ? "Windows Authentication"
                            : "SQL Authentication";
                        AutoDetectResult =
                            $"Verified: {result.Host} / {result.Database} using {authentication} ({result.Source}).";
                        AutoDetectColor = "#34d399";
                    }
                    else
                    {
                        AutoDetectResult =
                            $"Candidate: {result.Host} / {result.Database} ({result.Source}). " +
                            _mssqlService.LastConnectionError;
                        AutoDetectColor = "#f87171";
                    }
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
            finally
            {
                IsTesting = false;
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
            OrdersStatusLookbackDays = s.OrdersStatusLookbackDays;

            JtlReadOnlyMode = s.JtlReadOnlyMode;
            InventorySourceMode = s.InventorySourceMode;
            InventoryDiagnosticsOnly = s.InventoryDiagnosticsOnly;
            InventoryDryRun = s.InventoryDryRun;
            InventoryZeroStockPolicy = s.InventoryZeroStockPolicy;
            InventoryAllowConfirmedZeroStock = s.InventoryAllowConfirmedZeroStock;
            InventoryRejectUnverifiedZeroStock = s.InventoryRejectUnverifiedZeroStock;
            InventoryRejectConflictingStockSources = s.InventoryRejectConflictingStockSources;
            InventoryRequireSourceMetadata = s.InventoryRequireSourceMetadata;

            // Windows is the source of truth here. Suppressed so merely displaying the
            // current state never raises a UAC prompt when the app opens.
            _suppressStartupApply = true;
            StartWithWindows = StartupHelper.IsStartWithWindowsEnabled();
            _suppressStartupApply = false;
            StartMinimized = s.StartMinimized;
            UpdatesEnabled = s.Updates.Enabled;
            AutomaticDownload = s.Updates.AutomaticDownload;
            AutomaticInstall = s.Updates.AutomaticInstall;
            ReleaseChannel = s.Updates.Channel;
            MaintenanceWindowStart = s.Updates.MaintenanceWindowStart;
            MaintenanceWindowEnd = s.Updates.MaintenanceWindowEnd;
            AllowedUpdateDays = string.Join(", ",s.Updates.AllowedDays);
            UpdateHealthTimeoutSeconds = s.Updates.HealthTimeoutSeconds;
            UpdateBackupsToKeep = s.Updates.KeepBackups;
        }

        private async Task LoadUpdateStatusAsync()
        {
            if (_serviceClient == null)
            {
                try
                {
                    var agentId = string.IsNullOrWhiteSpace(_configService.Settings.MachineId)
                        ? Environment.MachineName
                        : _configService.Settings.MachineId;
                    var availability = await _apiClient.GetCurrentReleaseAsync(
                        agentId,
                        _configService.Settings.Updates.Channel);
                    CurrentInstalledVersion = BuildIdentity.Version;
                    CurrentInstalledGitSha = BuildIdentity.GitSha;
                    AvailableUpdateVersion = availability?.UpdateAvailable == true
                        ? availability.Release?.Manifest.Version ?? "Available"
                        : "Up to date";
                    LastUpdateResult = availability?.Release?.Manifest.ReleaseNotes ??
                        "No update action pending";
                }
                catch (Exception exception)
                {
                    AvailableUpdateVersion = "Unavailable";
                    LastUpdateResult = exception.Message;
                }
                return;
            }
            try
            {
                var response = await _serviceClient.SendAsync(new ServiceControlRequest
                {
                    Command = "GetUpdateStatus",
                });
                if (!response.Success) throw new InvalidOperationException(response.Error);
                var data = response.Data == null ? new JObject() : JObject.FromObject(response.Data);
                CurrentInstalledVersion = data.Value<string>("currentVersion") ?? BuildIdentity.Version;
                CurrentInstalledGitSha = data.Value<string>("currentGitSha") ?? BuildIdentity.GitSha;
                AvailableUpdateVersion = data.Value<bool?>("updateAvailable") == true
                    ? data.Value<string>("availableVersion") ?? "Available"
                    : "Up to date";
                LastUpdateResult = data.Value<string>("releaseNotes") ?? "No update action pending";
            }
            catch (Exception exception)
            {
                AvailableUpdateVersion = "Unavailable";
                LastUpdateResult = exception.Message;
            }
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
                SqlTestResult = result
                    ? $"Connection successful: {_configService.DescribeSqlTarget()}"
                    : _mssqlService.LastConnectionError;
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

        private async Task RunInventoryDiagnosticsAsync()
        {
            IsTesting = true;
            InventoryDiagnosticsResult = "Running inventory diagnostics...";
            InventoryDiagnosticsColor = "#60a5fa";

            ApplySettingsToConfig();
            _mssqlService.ResetSchema();

            try
            {
                InventoryDiagnosticsResult diagnostics;
                if (_serviceClient != null)
                {
                    var response = await _serviceClient.SendAsync(
                        new ServiceControlRequest
                        {
                            Command = "RunDiagnostics",
                            Payload = JObject.FromObject(new { inventory = true }),
                        });
                    if (!response.Success)
                        throw new InvalidOperationException(
                            response.Error ?? "Service diagnostics failed.");

                    var data = response.Data == null
                        ? null
                        : JObject.FromObject(response.Data);
                    diagnostics = data?["inventory"]?.ToObject<InventoryDiagnosticsResult>()
                        ?? throw new InvalidOperationException(
                            "Service did not return inventory diagnostics.");
                }
                else
                {
                    diagnostics = await _mssqlService.RunInventoryDiagnosticsAsync();
                }
                var selected = diagnostics.SelectedSummary;
                InventoryDiagnosticsResult =
                    $"Selected {diagnostics.SelectedSource}: {diagnostics.StockStatus}, " +
                    $"safe={diagnostics.SafeToSync}, rows={selected?.RowsCount ?? 0}, " +
                    $"total={selected?.TotalStock ?? 0}, available={selected?.AvailableStock ?? 0}" +
                    (string.IsNullOrWhiteSpace(diagnostics.RejectReason) ? "" : $" — {diagnostics.RejectReason}");
                InventoryDiagnosticsColor = diagnostics.SafeToSync ? "#34d399" : "#f87171";
            }
            catch (Exception ex)
            {
                InventoryDiagnosticsResult = $"Diagnostics failed: {ex.Message}";
                InventoryDiagnosticsColor = "#f87171";
                _log.Error("Settings", "Inventory diagnostics failed", ex);
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
                var safeBatchSize = Math.Clamp(BatchSize, 25, 2000);
                var safeBatchDelay = Math.Clamp(BatchDelayMs, 0, 5000);
                var safeOrderLookback = Math.Clamp(OrdersStatusLookbackDays, 0, 3650);
                var normalizedBackendApiUrl = NormalizeBackendApiUrl(BackendApiUrl);
                if (string.IsNullOrWhiteSpace(ApiKey))
                {
                    throw new InvalidOperationException("Sync API Key is required");
                }
                var normalizedTenantId = NormalizeTenantId(TenantId);
                if (!TimeOnly.TryParse(MaintenanceWindowStart,out _) ||
                    !TimeOnly.TryParse(MaintenanceWindowEnd,out _))
                    throw new InvalidOperationException("Maintenance window times must use HH:mm format.");
                var allowedDays = AllowedUpdateDays.Split(',',StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);
                if (allowedDays.Length == 0 ||
                    allowedDays.Any(day => !Enum.TryParse<DayOfWeek>(day,true,out _)))
                    throw new InvalidOperationException("Allowed update days must be comma-separated weekday names.");

                var settings = new AppSettings
                {
                    SqlHost = SqlHost,
                    SqlPort = SqlPort,
                    SqlDatabase = SqlDatabase,
                    SqlUsername = SqlUsername,
                    SqlWindowsAuth = SqlWindowsAuth,
                    BackendApiUrl = normalizedBackendApiUrl,
                    TenantId = normalizedTenantId,
                    OrdersSyncIntervalMinutes = OrdersSyncInterval,
                    ProductsSyncIntervalMinutes = ProductsSyncInterval,
                    CustomersSyncIntervalMinutes = CustomersSyncInterval,
                    InventorySyncIntervalMinutes = InventorySyncInterval,
                    BatchSize = safeBatchSize,
                    BatchDelayMs = safeBatchDelay,
                    OrdersStatusLookbackDays = safeOrderLookback,
                    JtlReadOnlyMode = JtlReadOnlyMode,
                    InventorySourceMode = NormalizeInventorySourceMode(InventorySourceMode),
                    InventoryDiagnosticsOnly = InventoryDiagnosticsOnly,
                    InventoryDryRun = InventoryDryRun,
                    InventoryZeroStockPolicy = NormalizeZeroStockPolicy(InventoryZeroStockPolicy),
                    InventoryAllowConfirmedZeroStock = InventoryAllowConfirmedZeroStock,
                    InventoryRejectUnverifiedZeroStock = InventoryRejectUnverifiedZeroStock,
                    InventoryRejectConflictingStockSources = InventoryRejectConflictingStockSources,
                    InventoryRequireSourceMetadata = InventoryRequireSourceMetadata,
                    StartMinimized = StartMinimized,
                    Updates = new UpdateSettings
                    {
                        Enabled = UpdatesEnabled,
                        AutomaticDownload = AutomaticDownload,
                        AutomaticInstall = AutomaticInstall,
                        Channel = string.Equals(ReleaseChannel,"beta",StringComparison.OrdinalIgnoreCase) ? "beta" : "stable",
                        MaintenanceWindowStart = MaintenanceWindowStart,
                        MaintenanceWindowEnd = MaintenanceWindowEnd,
                        AllowedDays = allowedDays,
                        HealthTimeoutSeconds = Math.Clamp(UpdateHealthTimeoutSeconds,30,900),
                        KeepBackups = Math.Clamp(UpdateBackupsToKeep,1,5),
                        MaximumPackageBytes = _configService.Settings.Updates.MaximumPackageBytes,
                        ManifestPublicKeyPem = _configService.Settings.Updates.ManifestPublicKeyPem,
                        AllowedReleaseHosts = _configService.Settings.Updates.AllowedReleaseHosts,
                    }
                };

                var secrets = new SecretSettings
                {
                    SqlPassword = SqlPassword,
                    ApiKey = ApiKey
                };

                if (_serviceClient != null)
                {
                    var response = await _serviceClient.SendAsync(
                        new ServiceControlRequest
                        {
                            Command = "SaveSettings",
                            Payload = Newtonsoft.Json.Linq.JObject.FromObject(new
                            {
                                settings,
                                secrets,
                            }),
                        });
                    if (!response.Success)
                        throw new InvalidOperationException(response.Error ?? "Service rejected settings.");
                }
                else
                {
                    _configService.Save(settings, secrets);

                    // The service is registered but was not reachable, so this save
                    // went to the per-user store it cannot read. Publish a copy it can
                    // decrypt, otherwise it stays stuck with no credentials and the
                    // next reboot syncs nothing.
                    if (StartupHelper.IsStartWithWindowsEnabled())
                    {
                        try
                        {
                            _configService.PublishToServiceStore();
                            _log.Info("Settings", "Published settings to the background service store");
                        }
                        catch (Exception exception)
                        {
                            // Needs administrator rights; the local save still stands.
                            _log.Warn(
                                "Settings",
                                $"Could not publish settings to the background service: {exception.Message}",
                                exception);
                        }
                    }
                }

                // Applied when the checkbox is toggled, not here. Kept as a
                // reconciliation step in case registration failed earlier and the
                // checkbox and Windows have since drifted apart.
                await ApplyAutomaticStartupAsync();

                if (safeBatchSize != BatchSize || safeBatchDelay != BatchDelayMs || safeOrderLookback != OrdersStatusLookbackDays)
                {
                    BatchSize = safeBatchSize;
                    BatchDelayMs = safeBatchDelay;
                    OrdersStatusLookbackDays = safeOrderLookback;
                }
                BackendApiUrl = normalizedBackendApiUrl;
                TenantId = normalizedTenantId;

                // Reset schema cache so queries are re-detected against the new DB
                _mssqlService.ResetSchema();

                // Restart scheduler to pick up new intervals
                if (_serviceClient == null)
                    _scheduler.Restart();

                SaveResult = "Settings saved — checking connections...";
                SaveResultColor = "#60a5fa";
                _log.Info("Settings", "Settings saved and scheduler restarted");

                // Re-check connections with new credentials so Dashboard updates immediately
                if (OnSettingsSaved != null)
                    await OnSettingsSaved();

                SaveResult = "Settings saved successfully";
                SaveResultColor = "#34d399";

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

        private static string NormalizeBackendApiUrl(string value)
        {
            var trimmed = (value ?? string.Empty).Trim().TrimEnd('/');
            if (
                !Uri.TryCreate(trimmed, UriKind.Absolute, out var uri) ||
                (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps)
            )
            {
                throw new InvalidOperationException("Backend API URL must be a full http/https URL, e.g. https://your-domain.com/api");
            }
            return trimmed;
        }

        private static string NormalizeTenantId(string value)
        {
            var trimmed = (value ?? string.Empty).Trim();
            if (!Guid.TryParse(trimmed, out _))
            {
                throw new InvalidOperationException("Tenant ID is required and must be a valid UUID from the company settings page");
            }
            return trimmed;
        }

        private static string NormalizeInventorySourceMode(string value)
        {
            var normalized = (value ?? string.Empty).Trim().ToLowerInvariant();
            return normalized == "legacy" ? "legacy" : "auto";
        }

        private static string NormalizeZeroStockPolicy(string value)
        {
            var normalized = (value ?? string.Empty).Trim().ToLowerInvariant();
            return normalized == "allow" ? "allow" : "verify";
        }

        private async Task ResetWatermarksAsync()
        {
            IsSaving = true;
            SaveResult = "Resetting watermarks...";
            SaveResultColor = "#60a5fa";

            try
            {
                if (_serviceClient != null)
                    throw new InvalidOperationException(
                        "Watermark reset is disabled in service-managed mode. Use the reviewed repair procedure.");

                foreach (var module in new[] { "orders", "products", "customers", "inventory" })
                    _watermarks.ResetWatermark(module);

                _log.Info("Settings", "All watermarks reset — next sync will do full re-fetch");

                SaveResult = "Watermarks reset — triggering full sync...";
                await _scheduler.TriggerAllAsync();

                SaveResult = "Full sync triggered successfully";
                SaveResultColor = "#34d399";

                await Task.Delay(3000);
                SaveResult = "";
            }
            catch (Exception ex)
            {
                SaveResult = $"Reset failed: {ex.Message}";
                SaveResultColor = "#f87171";
                _log.Error("Settings", "Failed to reset watermarks", ex);
            }
            finally
            {
                IsSaving = false;
            }
        }

        private void ApplySettingsToConfig()
        {
            var safeBatchSize = Math.Clamp(BatchSize, 25, 2000);
            var safeBatchDelay = Math.Clamp(BatchDelayMs, 0, 5000);

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
                BatchSize = safeBatchSize,
                BatchDelayMs = safeBatchDelay,
                OrdersStatusLookbackDays = _configService.Settings.OrdersStatusLookbackDays,
                JtlReadOnlyMode = JtlReadOnlyMode,
                InventorySourceMode = NormalizeInventorySourceMode(InventorySourceMode),
                InventoryDiagnosticsOnly = InventoryDiagnosticsOnly,
                InventoryDryRun = InventoryDryRun,
                InventoryZeroStockPolicy = NormalizeZeroStockPolicy(InventoryZeroStockPolicy),
                InventoryAllowConfirmedZeroStock = InventoryAllowConfirmedZeroStock,
                InventoryRejectUnverifiedZeroStock = InventoryRejectUnverifiedZeroStock,
                InventoryRejectConflictingStockSources = InventoryRejectConflictingStockSources,
                InventoryRequireSourceMetadata = InventoryRequireSourceMetadata,
                StartMinimized = StartMinimized,
                Updates = _configService.Settings.Updates
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
