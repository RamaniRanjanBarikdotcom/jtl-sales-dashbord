using System;
using System.Windows;
using JtlSyncEngine.Jobs;
using JtlSyncEngine.Services;
using JtlSyncEngine.ViewModels;
using JtlSyncEngine.Views;

namespace JtlSyncEngine
{
    public partial class App : Application
    {
        // Manual DI container - instantiate all services here
        private LogService? _logService;
        private ConfigService? _configService;
        private WatermarkService? _watermarkService;
        private MssqlService? _mssqlService;
        private ApiClient? _apiClient;
        private SyncOrchestrator? _orchestrator;
        private SyncScheduler? _scheduler;

        protected override void OnStartup(StartupEventArgs e)
        {
            base.OnStartup(e);

            // Global exception handling
            AppDomain.CurrentDomain.UnhandledException += (s, ex) =>
            {
                _logService?.Error("App", "Unhandled domain exception", ex.ExceptionObject as Exception);
                MessageBox.Show($"An unexpected error occurred:\n{ex.ExceptionObject}",
                    "JTL Sync Engine Error", MessageBoxButton.OK, MessageBoxImage.Error);
            };

            DispatcherUnhandledException += (s, ex) =>
            {
                _logService?.Error("App", "Unhandled UI exception", ex.Exception);
                ex.Handled = true;
            };

            try
            {
                // Compose the object graph
                _configService = new ConfigService();
                _logService = new LogService();
                _watermarkService = new WatermarkService(_logService);
                _mssqlService = new MssqlService(_configService, _logService);
                _apiClient = new ApiClient(_configService, _logService);
                _orchestrator = new SyncOrchestrator(_configService, _mssqlService, _apiClient, _watermarkService, _logService);
                _scheduler = new SyncScheduler(_configService, _orchestrator, _logService);

                // Build ViewModels
                var logsVm = new LogsViewModel(_logService);

                var dashboardVm = new DashboardViewModel(
                    _scheduler, _mssqlService, _apiClient, _logService);

                var settingsVm = new SettingsViewModel(
                    _configService, _mssqlService, _apiClient, _scheduler, _watermarkService, _logService);

                // After saving settings, re-check connections so Dashboard updates immediately.
                // MainWindow's PropertyChanged handler propagates the result to MainViewModel.
                settingsVm.OnSettingsSaved = async () =>
                {
                    await dashboardVm.CheckConnectionsAsync();
                };

                var mainVm = new MainViewModel(dashboardVm, settingsVm, logsVm);

                // Create and show main window
                var mainWindow = new MainWindow(mainVm, _scheduler, dashboardVm);

                bool startMinimized = _configService.Settings.StartMinimized;
                foreach (var arg in e.Args)
                {
                    if (arg.Equals("--minimized", StringComparison.OrdinalIgnoreCase))
                        startMinimized = true;
                }

                if (startMinimized)
                {
                    mainWindow.WindowState = WindowState.Minimized;
                    mainWindow.ShowInTaskbar = true;
                }

                mainWindow.Show();
                MainWindow = mainWindow;

                _logService.Info("App", "JTL Sync Engine started successfully");
            }
            catch (Exception ex)
            {
                MessageBox.Show($"Startup failed:\n{ex.Message}", "JTL Sync Engine",
                    MessageBoxButton.OK, MessageBoxImage.Error);
                Shutdown(1);
            }
        }

        protected override void OnExit(ExitEventArgs e)
        {
            _logService?.Info("App", "JTL Sync Engine shutting down");
            _scheduler?.Dispose();
            _logService?.Dispose();
            base.OnExit(e);
        }
    }
}
