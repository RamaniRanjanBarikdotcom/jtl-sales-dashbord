using System;
using System.Drawing;
using System.IO;
using System.Windows;
using JtlSyncEngine.Jobs;
using JtlSyncEngine.Ipc;
using JtlSyncEngine.Services;
using JtlSyncEngine.Updates;
using JtlSyncEngine.ViewModels;
using JtlSyncEngine.Views;

// Aliases to disambiguate WPF vs WinForms types used in App.xaml.cs
using WinForms = System.Windows.Forms;
using Microsoft.Win32;

namespace JtlSyncEngine
{
    public partial class App : Application
    {
        private static readonly string StartupLogFile = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "JTL-Sync",
            "logs",
            "startup.log");

        // Manual DI container
        private LogService? _logService;
        private ConfigService? _configService;
        private WatermarkService? _watermarkService;
        private MssqlService? _mssqlService;
        private ApiClient? _apiClient;
        private SyncOrchestrator? _orchestrator;
        private SyncScheduler? _scheduler;
        private UpdateCoordinator? _updates;
        private CancellationTokenSource? _portableUpdateCts;

        // System tray
        private WinForms.NotifyIcon? _trayIcon;
        private MainWindow? _mainWindow;

        protected override void OnStartup(StartupEventArgs e)
        {
            base.OnStartup(e);
            WriteStartupLog($"Starting JTL Sync Engine. Args={string.Join(" ", e.Args)}");

            AppDomain.CurrentDomain.UnhandledException += (s, ex) =>
            {
                _logService?.Error("App", "Unhandled domain exception", ex.ExceptionObject as Exception);
                WriteStartupLog($"Unhandled domain exception: {ex.ExceptionObject}");
                MessageBox.Show($"An unexpected error occurred:\n{ex.ExceptionObject}",
                    "JTL Sync Engine Error", MessageBoxButton.OK, MessageBoxImage.Error);
            };

            DispatcherUnhandledException += (s, ex) =>
            {
                _logService?.Error("App", "Unhandled UI exception", ex.Exception);
                WriteStartupLog($"Unhandled UI exception: {ex.Exception}");
                ex.Handled = true;
            };

            try
            {
                var safeMode = HasArg(e.Args, "--safe-mode");
                var noTray = safeMode || HasArg(e.Args, "--no-tray");
                var serviceManagedMode = HasArg(e.Args, "--service-managed");
                var serviceInstalled = false;
                if (serviceManagedMode)
                {
                    using var serviceKey = Registry.LocalMachine
                        .OpenSubKey(@"SYSTEM\CurrentControlSet\Services\JtlSyncEngine");
                    serviceInstalled = serviceKey != null;
                }
                var serviceClient = new NamedPipeControlClient();
                var serviceAvailable = false;
                var serviceManaged = serviceInstalled && serviceManagedMode;
                if (serviceManaged)
                {
                    try
                    {
                        var response = serviceClient.SendAsync(
                            new ServiceControlRequest { Command = "GetStatus" },
                            TimeSpan.FromSeconds(2)).GetAwaiter().GetResult();
                        serviceAvailable = response.Success;
                    }
                    catch
                    {
                        serviceAvailable = false;
                    }
                }
                // Portable click-to-run is the default. Legacy service management must
                // be requested explicitly so an old service registration cannot prevent
                // the portable scheduler and UI from starting.
                if (serviceManaged)
                    Environment.SetEnvironmentVariable("JTL_SYNC_RUNTIME_MODE", "service");

                _configService    = new ConfigService();
                _logService       = new LogService();
                _watermarkService = new WatermarkService(_logService);
                _mssqlService     = new MssqlService(_configService, _logService);
                _apiClient        = new ApiClient(_configService, _logService);
                _orchestrator     = new SyncOrchestrator(_configService, _mssqlService, _apiClient, _watermarkService, _logService);
                _scheduler        = new SyncScheduler(_configService, _orchestrator, _apiClient, _logService);

                var logsVm      = new LogsViewModel(_logService);
                var dashboardVm = new DashboardViewModel(
                    _scheduler,
                    _mssqlService,
                    _apiClient,
                    _logService,
                    serviceManaged ? serviceClient : null);
                var settingsVm  = new SettingsViewModel(
                    _configService,
                    _mssqlService,
                    _apiClient,
                    _scheduler,
                    _watermarkService,
                    _logService,
                    serviceManaged ? serviceClient : null);

                settingsVm.OnSettingsSaved = async () =>
                {
                    await dashboardVm.CheckConnectionsAsync();
                };

                var mainVm  = new MainViewModel(dashboardVm, settingsVm, logsVm);
                if (
                    safeMode ||
                    string.IsNullOrWhiteSpace(_configService.Settings.BackendApiUrl) ||
                    !Guid.TryParse(_configService.Settings.TenantId, out _)
                )
                {
                    mainVm.CurrentPage = NavigationPage.Settings;
                }

                _mainWindow = new MainWindow(
                    mainVm,
                    _scheduler,
                    dashboardVm,
                    startScheduler: !safeMode && !serviceManaged,
                    hideToTray: !noTray);
                MainWindow  = _mainWindow;

                // ── System tray icon ─────────────────────────────────────────
                if (!noTray)
                {
                    try
                    {
                        _trayIcon = new WinForms.NotifyIcon
                        {
                            Icon    = CreateTrayIcon(),
                            Text    = "JTL Sync Engine — Running",
                            Visible = true,
                        };

                        var menu     = new WinForms.ContextMenuStrip();
                        var openItem = new WinForms.ToolStripMenuItem("Open JTL Sync Engine");
                        openItem.Font  = new Font(openItem.Font, System.Drawing.FontStyle.Bold);
                        openItem.Click += (_, _) => ShowMainWindow();
                        menu.Items.Add(openItem);

                        menu.Items.Add(new WinForms.ToolStripSeparator());

                        var quitItem = new WinForms.ToolStripMenuItem("Quit");
                        quitItem.Click += (_, _) => ExitApp();
                        menu.Items.Add(quitItem);

                        _trayIcon.ContextMenuStrip = menu;
                        _trayIcon.DoubleClick      += (_, _) => ShowMainWindow();
                    }
                    catch (Exception trayEx)
                    {
                        noTray = true;
                        _logService.Warn("App", "System tray unavailable; continuing without tray icon", trayEx);
                        WriteStartupLog($"Tray initialization failed; continuing without tray: {trayEx}");
                    }
                }

                // ── Show or start hidden ─────────────────────────────────────
                // Manual double-clicks always show the window. Start-with-Windows adds
                // --minimized explicitly when background startup is desired.
                var startMinimized = !noTray && HasArg(e.Args, "--minimized");

                if (startMinimized && _trayIcon != null)
                {
                    // Start in tray — show balloon so user knows it's running
                    _trayIcon.ShowBalloonTip(
                        3000,
                        "JTL Sync Engine",
                        "Running in background. Double-click the tray icon to open.",
                        WinForms.ToolTipIcon.Info);

                    // Still need to show and immediately hide the window once so
                    // OnContentRendered fires and the scheduler starts.
                    _mainWindow.Show();
                    _mainWindow.Hide();
                }
                else
                {
                    _mainWindow.Show();
                }

                if (!safeMode && !serviceManaged)
                {
                    _updates = new UpdateCoordinator(
                        _configService,
                        _apiClient,
                        _scheduler,
                        _logService,
                        hostMode: "portable");
                    _portableUpdateCts = new CancellationTokenSource();
                    _ = RunPortableUpdateLoopAsync(_portableUpdateCts.Token);
                }

                _logService.Info(
                    "App",
                    serviceManaged
                        ? serviceAvailable
                            ? "JTL Sync Engine management UI connected to service"
                            : "JTL Sync Engine service is installed but unavailable; standalone scheduler remains disabled"
                        : safeMode
                            ? "JTL Sync Engine started in safe mode"
                            : "JTL Sync Engine started successfully");
                WriteStartupLog("Startup completed");
            }
            catch (Exception ex)
            {
                WriteStartupLog($"Startup failed: {ex}");
                MessageBox.Show($"Startup failed:\n{ex.Message}\n\nDetails were written to:\n{StartupLogFile}", "JTL Sync Engine",
                    MessageBoxButton.OK, MessageBoxImage.Error);
                Shutdown(1);
            }
        }

        private void ShowMainWindow()
        {
            if (_mainWindow == null) return;
            _mainWindow.Show();
            _mainWindow.WindowState = WindowState.Normal;
            _mainWindow.Activate();
            _mainWindow.Focus();
        }

        private void ExitApp()
        {
            _logService?.Info("App", "User requested exit from tray");
            _portableUpdateCts?.Cancel();
            _trayIcon?.Dispose();
            _scheduler?.Dispose();
            _updates?.Dispose();
            _logService?.Dispose();
            Shutdown(0);
        }

        private async Task RunPortableUpdateLoopAsync(CancellationToken cancellationToken)
        {
            try
            {
                await Task.Delay(TimeSpan.FromSeconds(20),cancellationToken);
                using var timer = new PeriodicTimer(TimeSpan.FromMinutes(1));
                while (!cancellationToken.IsCancellationRequested)
                {
                    if (_updates != null &&
                        (await _updates.RecoverAsync(cancellationToken) ||
                         await _updates.PollAsync(cancellationToken)))
                    {
                        await Dispatcher.InvokeAsync(ExitForPortableUpdate);
                        return;
                    }
                    await timer.WaitForNextTickAsync(cancellationToken);
                }
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
            }
            catch (Exception exception)
            {
                _logService?.Warn(
                    "Updater",
                    $"Portable update check deferred: {exception.Message}",
                    exception);
            }
        }

        private void ExitForPortableUpdate()
        {
            _logService?.Info(
                "Updater",
                "Closing the portable Sync Engine so the verified update can be applied");
            _scheduler?.PauseScheduledWork();
            _trayIcon?.Dispose();
            Shutdown(0);
        }

        private static bool HasArg(string[] args, string value)
        {
            foreach (var arg in args)
            {
                if (arg.Equals(value, StringComparison.OrdinalIgnoreCase)) return true;
            }
            return false;
        }

        private static void WriteStartupLog(string message)
        {
            try
            {
                var dir = Path.GetDirectoryName(StartupLogFile);
                if (!string.IsNullOrWhiteSpace(dir)) Directory.CreateDirectory(dir);
                File.AppendAllText(StartupLogFile, $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss}] {message}{Environment.NewLine}");
            }
            catch
            {
                // Last-resort startup logging must never break app startup.
            }
        }

        protected override void OnExit(ExitEventArgs e)
        {
            _portableUpdateCts?.Cancel();
            _trayIcon?.Dispose();
            _scheduler?.Dispose();
            _updates?.Dispose();
            _logService?.Dispose();
            base.OnExit(e);
        }

        // Simple "S" icon drawn in code — no .ico file needed
        private static Icon CreateTrayIcon()
        {
            using var bmp     = new Bitmap(16, 16);
            using var gfx     = Graphics.FromImage(bmp);
            using var bgBrush = new SolidBrush(Color.FromArgb(37, 99, 235));
            using var fgBrush = new SolidBrush(Color.White);
            using var font    = new System.Drawing.Font("Segoe UI", 8f, System.Drawing.FontStyle.Bold);

            gfx.Clear(Color.Transparent);
            gfx.FillRectangle(bgBrush, 0, 0, 16, 16);
            gfx.DrawString("S", font, fgBrush, 1f, 0f);

            var hIcon = bmp.GetHicon();
            return Icon.FromHandle(hIcon);
        }
    }
}
