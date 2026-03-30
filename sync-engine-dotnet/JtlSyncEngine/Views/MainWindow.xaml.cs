using System;
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
            _viewModel = viewModel;
            _scheduler = scheduler;
            _dashboardVm = dashboardVm;
            DataContext = _viewModel;
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

        protected override void OnClosed(EventArgs e)
        {
            _displayRefreshTimer?.Dispose();
            _scheduler.Dispose();
            base.OnClosed(e);
        }

        protected override void OnStateChanged(EventArgs e)
        {
            base.OnStateChanged(e);
            // Minimise to taskbar only (not tray for simplicity)
        }
    }
}
