using System;
using System.ComponentModel;
using System.Threading;
using System.Windows;
using JtlSyncEngine.Jobs;
using JtlSyncEngine.Services;
using JtlSyncEngine.ViewModels;

namespace JtlSyncEngine.Views
{
    public partial class MainWindow : Window
    {
        private readonly MainViewModel _viewModel;
        private readonly SyncScheduler _scheduler;
        private readonly DashboardViewModel _dashboardVm;
        private System.Threading.Timer? _displayRefreshTimer;

        public MainWindow(MainViewModel viewModel, SyncScheduler scheduler, DashboardViewModel dashboardVm)
        {
            InitializeComponent();
            _viewModel   = viewModel;
            _scheduler   = scheduler;
            _dashboardVm = dashboardVm;
            DataContext  = _viewModel;
        }

        protected override async void OnContentRendered(EventArgs e)
        {
            base.OnContentRendered(e);

            // Start scheduler
            _scheduler.Start();

            // Check initial connections
            await _dashboardVm.CheckConnectionsAsync();
            _viewModel.IsSqlConnected = _dashboardVm.IsSqlConnected;
            _viewModel.IsApiConnected = _dashboardVm.IsApiConnected;

            // Sync connection status to main vm periodically
            _dashboardVm.PropertyChanged += (s, ev) =>
            {
                if (ev.PropertyName == nameof(DashboardViewModel.IsSqlConnected))
                    _viewModel.IsSqlConnected = _dashboardVm.IsSqlConnected;
                if (ev.PropertyName == nameof(DashboardViewModel.IsApiConnected))
                    _viewModel.IsApiConnected = _dashboardVm.IsApiConnected;
            };

            // Refresh display every 30 seconds to keep "x min ago" and "next sync" current
            _displayRefreshTimer = new System.Threading.Timer(_ =>
            {
                Dispatcher.InvokeAsync(() => _dashboardVm.RefreshNextSyncDisplays());
            }, null, TimeSpan.FromSeconds(30), TimeSpan.FromSeconds(30));
        }

        // ── Hide to tray instead of closing ──────────────────────────────────
        protected override void OnClosing(CancelEventArgs e)
        {
            e.Cancel = true;   // Don't actually close
            Hide();            // Just hide the window — sync keeps running
        }

        // ── Only called if app is truly exiting (from tray Quit) ─────────────
        protected override void OnClosed(EventArgs e)
        {
            _displayRefreshTimer?.Dispose();
            base.OnClosed(e);
            // Note: scheduler is disposed by App.ExitApp(), not here,
            // so it keeps running even when window is hidden.
        }

        protected override void OnStateChanged(EventArgs e)
        {
            base.OnStateChanged(e);
            // If minimized via taskbar button → also hide to tray
            if (WindowState == WindowState.Minimized)
                Hide();
        }
    }
}
