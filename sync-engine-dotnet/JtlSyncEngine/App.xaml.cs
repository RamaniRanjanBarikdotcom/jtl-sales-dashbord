using System;
using System.Drawing;
using System.IO;
using System.Windows;
using System.Security.Principal;
using JtlSyncEngine.Helpers;
using JtlSyncEngine.Jobs;
using JtlSyncEngine.Ipc;
using JtlSyncEngine.Runtime;
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
        private Mutex? _singleInstance;
        private UiActivationServer? _activationServer;

        // Short on purpose: this runs before the window is shown, so a slow or dead
        // service must not visibly delay startup.
        private static readonly TimeSpan ServiceProbeTimeout = TimeSpan.FromSeconds(2);

        // The running copy only has to bring a window forward. If it cannot manage
        // that in three seconds it is wedged, and saying so beats waiting.
        private static readonly TimeSpan ActivationTimeout = TimeSpan.FromSeconds(3);

        protected override void OnStartup(StartupEventArgs e)
        {
            base.OnStartup(e);
            WriteStartupLog($"Starting JTL Sync Engine. Args={string.Join(" ", e.Args)}");

            var startup = StartupArguments.Parse(e.Args);

            // Repeated double-clicks previously stacked up hidden processes, each
            // holding a tray icon slot and competing for the same files.
            _singleInstance = new Mutex(true, @"Local\JtlSyncEngine-UI", out var isFirstInstance);
            if (!isFirstInstance)
            {
                // Exiting silently is what made the app look dead: it was already
                // running in the tray, and double-clicking the executable produced
                // nothing at all. Ask the running copy to show itself instead.
                var activated = Task.Run(() => UiActivationClient.TryActivateAsync(
                    ActivationPipeName(),
                    ActivationTimeout)).GetAwaiter().GetResult();

                WriteStartupLog(activated
                    ? "Another instance is already running; asked it to open its window."
                    : "Another instance is already running but did not answer the activation request.");

                if (!activated && !startup.LaunchedAtSignIn)
                {
                    // Only for a deliberate double-click. At sign-in nobody is watching
                    // and a modal box would sit unanswered on the server console.
                    MessageBox.Show(
                        "JTL Sync Engine is already running but its window did not respond.\n\n" +
                        "Open it from the icon in the notification area, or quit it there and start it again.",
                        "JTL Sync Engine",
                        MessageBoxButton.OK,
                        MessageBoxImage.Information);
                }

                _singleInstance.Dispose();
                _singleInstance = null;
                Shutdown(0);
                return;
            }

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

            // Started before anything can fail, so a second double-click reaches this
            // process even while it is still bringing the engine up.
            StartActivationListener();

            try
            {
                var safeMode = startup.SafeMode;
                var noTray = startup.NoTray;
                // Explicit escape hatch for development. Without it, a registered
                // service always wins ownership of the scheduler.
                var forceStandalone = startup.ForceStandalone;
                var serviceInstalled = false;
                if (!forceStandalone)
                {
                    using var serviceKey = Registry.LocalMachine
                        .OpenSubKey(@"SYSTEM\CurrentControlSet\Services\JtlSyncEngine");
                    serviceInstalled = serviceKey != null;
                }
                var serviceClient = new NamedPipeControlClient();
                // Registration is not enough: the service may be stopped, blocked on
                // missing credentials, or an older build that never answers. Handing it
                // control regardless left every save and connection test going down a
                // pipe nobody was listening on, so the app ran but could do nothing.
                //
                // Probed on a thread-pool thread, never with .GetAwaiter().GetResult()
                // on the UI thread — that deadlocked startup and the window never
                // appeared at all.
                var serviceResponding = serviceInstalled &&
                    Task.Run(() => ServiceAvailability.IsRespondingAsync(
                        async token =>
                        {
                            var response = await serviceClient.SendAsync(
                                new ServiceControlRequest { Command = "GetStatus" },
                                ServiceProbeTimeout,
                                token).ConfigureAwait(false);
                            return response.Success;
                        },
                        ServiceProbeTimeout)).GetAwaiter().GetResult();

                var serviceManaged = ServiceAvailability.ShouldDeferToService(
                    serviceInstalled, serviceResponding);

                if (serviceInstalled && !serviceResponding)
                    WriteStartupLog(
                        "Background service is registered but not responding; running locally so the app stays usable.");

                // The UI reads service-owned config from ProgramData so it shows the
                // same settings the service actually runs with.
                if (serviceManaged)
                    Environment.SetEnvironmentVariable("JTL_SYNC_RUNTIME_MODE", "service");

                _configService    = new ConfigService();
                _logService       = new LogService();

                // A portable folder gets moved after it is set up, and the startup
                // entry then launches a path that no longer exists — which looks
                // identical to automatic startup never having been enabled.
                RepairPortableStartupEntry();
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
                    hideToTray: !noTray,
                    schedulerStartDelay: startup.LaunchedAtSignIn
                        ? TimeSpan.FromSeconds(_configService.Settings.PortableStartupDelaySeconds)
                        : TimeSpan.Zero);
                MainWindow  = _mainWindow;

                // ── System tray icon ─────────────────────────────────────────
                if (!noTray)
                {
                    try
                    {
                        _trayIcon = new WinForms.NotifyIcon
                        {
                            Icon    = CreateTrayIcon(),
                            Text    = serviceManaged
                                ? "JTL Sync Engine — background service is syncing"
                                : "JTL Sync Engine — Running",
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
                // The startup entry deliberately does not pass --minimized. Whether the
                // window appears after a reboot is the operator's "Start minimized"
                // setting, which defaults to showing it — a server that comes back with
                // nothing on screen reads as a server where nothing started.
                var startMinimized = !noTray &&
                    (startup.Minimized || _configService.Settings.StartMinimized);

                if (startMinimized && _trayIcon != null)
                {
                    if (_configService.Settings.ShowStartupNotification)
                    {
                        _trayIcon.ShowBalloonTip(
                            5000,
                            "JTL Sync Engine",
                            startup.LaunchedAtSignIn
                                ? "Started automatically and is syncing in the background. Double-click this icon to open it."
                                : "Running in background. Double-click the tray icon to open.",
                            WinForms.ToolTipIcon.Info);
                    }

                    // Still need to show and immediately hide the window once so
                    // OnContentRendered fires and the scheduler starts.
                    _mainWindow.Show();
                    _mainWindow.Hide();
                }
                else
                {
                    _mainWindow.Show();
                    if (startup.LaunchedAtSignIn)
                    {
                        // Windows gives focus to whatever the user is doing during
                        // sign-in, so a plain Show() can leave the window behind
                        // everything else.
                        _mainWindow.Activate();
                    }
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
                        ? "JTL Sync Engine management UI started; background service owns syncing"
                        : serviceInstalled
                            ? "Background service is registered but not responding; this app is syncing instead"
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

        /// <summary>
        /// Reports whether the background service is reachable, without ever blocking
        /// startup on it. Purely informational: the UI is already usable by now.
        /// </summary>
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
            StopActivationListener();
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

        /// <summary>
        /// The private channel this copy listens on, and that a second launch calls.
        /// </summary>
        /// <remarks>
        /// Keyed on the signed-in account and the Terminal Services session so it lines
        /// up exactly with the <c>Local\JtlSyncEngine-UI</c> mutex above: one channel per
        /// copy the mutex actually permits.
        /// </remarks>
        private static string ActivationPipeName()
        {
            string? sid = null;
            try
            {
                using var identity = WindowsIdentity.GetCurrent();
                sid = identity?.User?.Value;
            }
            catch
            {
                // A missing SID is handled by PipeNameForUser. Failing to name the pipe
                // must not stop the app from starting.
            }

            var sessionId = 0;
            try
            {
                using var process = System.Diagnostics.Process.GetCurrentProcess();
                sessionId = process.SessionId;
            }
            catch
            {
                // Session 0 is the safe fallback: both sides compute it the same way.
            }

            return UiActivationProtocol.PipeNameForUser(sid, sessionId);
        }

        /// <summary>
        /// Answers "show yourself" requests from later launches of the executable.
        /// </summary>
        private void StartActivationListener()
        {
            try
            {
                _activationServer = new UiActivationServer(
                    ActivationPipeName(),
                    () => Dispatcher.InvokeAsync(ShowMainWindow).Task,
                    (message, exception) =>
                    {
                        _logService?.Warn("App", message, exception);
                        WriteStartupLog(message);
                    });
                _activationServer.Start(CancellationToken.None);
            }
            catch (Exception exception)
            {
                // Losing this costs a convenience — the tray icon still opens the window.
                // It must never cost the app its startup.
                _activationServer = null;
                WriteStartupLog($"Could not listen for activation requests: {exception}");
            }
        }

        /// <summary>
        /// Points the sign-in startup entry back at this executable if the folder moved.
        /// </summary>
        /// <remarks>
        /// A portable folder gets copied or relocated after setup, and the registered
        /// command then names a path that no longer exists. Windows fails that launch
        /// silently, which is indistinguishable from automatic startup never having been
        /// switched on. Only runs when the entry already exists — it never enables
        /// startup on its own.
        /// </remarks>
        private void RepairPortableStartupEntry()
        {
            try
            {
                if (PortableStartupManager.RepairIfStale(out var error))
                {
                    _logService?.Info(
                        "Startup",
                        "Automatic startup pointed at an old location and was corrected to this folder");
                    WriteStartupLog("Repaired the Windows startup entry to point at this folder.");
                }
                else if (!string.IsNullOrWhiteSpace(error))
                {
                    _logService?.Warn(
                        "Startup",
                        $"Could not correct the Windows startup entry: {error}");
                    WriteStartupLog($"Could not correct the Windows startup entry: {error}");
                }
            }
            catch (Exception exception)
            {
                _logService?.Warn("Startup", "Startup entry check failed", exception);
            }
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

        /// <summary>
        /// Shuts the activation channel down without letting it hold up exit.
        /// </summary>
        /// <remarks>
        /// The listener runs on the thread pool (see <see cref="UiActivationServer.Start"/>),
        /// so waiting here cannot deadlock the UI thread. The wait is bounded anyway:
        /// quitting must not hang because a pipe refused to close.
        /// </remarks>
        private void StopActivationListener()
        {
            var server = _activationServer;
            if (server == null) return;
            _activationServer = null;

            try
            {
                if (!Task.Run(async () => await server.DisposeAsync())
                        .Wait(TimeSpan.FromSeconds(2)))
                {
                    WriteStartupLog("Activation listener did not stop in time; exiting anyway.");
                }
            }
            catch (Exception exception)
            {
                WriteStartupLog($"Activation listener shutdown error: {exception.Message}");
            }
        }

        protected override void OnExit(ExitEventArgs e)
        {
            _portableUpdateCts?.Cancel();
            StopActivationListener();
            _trayIcon?.Dispose();
            _scheduler?.Dispose();
            _updates?.Dispose();
            _logService?.Dispose();
            if (_singleInstance != null)
            {
                _singleInstance.ReleaseMutex();
                _singleInstance.Dispose();
                _singleInstance = null;
            }
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
