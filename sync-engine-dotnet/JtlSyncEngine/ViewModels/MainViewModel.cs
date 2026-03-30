using System;
using System.Windows.Input;
using JtlSyncEngine.Helpers;
using JtlSyncEngine.Services;

namespace JtlSyncEngine.ViewModels
{
    public enum NavigationPage
    {
        Dashboard,
        Settings,
        Logs
    }

    public class MainViewModel : BaseViewModel
    {
        private NavigationPage _currentPage = NavigationPage.Dashboard;
        private bool _isSqlConnected;
        private bool _isApiConnected;
        private string _statusText = "Initializing...";

        public DashboardViewModel DashboardViewModel { get; }
        public SettingsViewModel SettingsViewModel { get; }
        public LogsViewModel LogsViewModel { get; }

        public NavigationPage CurrentPage
        {
            get => _currentPage;
            set
            {
                SetProperty(ref _currentPage, value);
                OnPropertyChanged(nameof(IsDashboardActive));
                OnPropertyChanged(nameof(IsSettingsActive));
                OnPropertyChanged(nameof(IsLogsActive));
            }
        }

        public bool IsDashboardActive => CurrentPage == NavigationPage.Dashboard;
        public bool IsSettingsActive => CurrentPage == NavigationPage.Settings;
        public bool IsLogsActive => CurrentPage == NavigationPage.Logs;

        public bool IsSqlConnected
        {
            get => _isSqlConnected;
            set
            {
                SetProperty(ref _isSqlConnected, value);
                OnPropertyChanged(nameof(SqlStatusColor));
                OnPropertyChanged(nameof(SqlStatusLabel));
                UpdateStatusText();
            }
        }

        public bool IsApiConnected
        {
            get => _isApiConnected;
            set
            {
                SetProperty(ref _isApiConnected, value);
                OnPropertyChanged(nameof(ApiStatusColor));
                OnPropertyChanged(nameof(ApiStatusLabel));
                UpdateStatusText();
            }
        }

        public string StatusText
        {
            get => _statusText;
            set => SetProperty(ref _statusText, value);
        }

        public string SqlStatusColor => _isSqlConnected ? "#34d399" : "#f87171";
        public string SqlStatusLabel => _isSqlConnected ? "SQL: Connected" : "SQL: Disconnected";
        public string ApiStatusColor => _isApiConnected ? "#34d399" : "#f87171";
        public string ApiStatusLabel => _isApiConnected ? "API: Connected" : "API: Disconnected";

        public ICommand NavigateDashboardCommand { get; }
        public ICommand NavigateSettingsCommand { get; }
        public ICommand NavigateLogsCommand { get; }

        public MainViewModel(
            DashboardViewModel dashboardViewModel,
            SettingsViewModel settingsViewModel,
            LogsViewModel logsViewModel)
        {
            DashboardViewModel = dashboardViewModel;
            SettingsViewModel = settingsViewModel;
            LogsViewModel = logsViewModel;

            NavigateDashboardCommand = new RelayCommand(() => CurrentPage = NavigationPage.Dashboard);
            NavigateSettingsCommand = new RelayCommand(() => CurrentPage = NavigationPage.Settings);
            NavigateLogsCommand = new RelayCommand(() => CurrentPage = NavigationPage.Logs);
        }

        private void UpdateStatusText()
        {
            StatusText = (_isSqlConnected, _isApiConnected) switch
            {
                (true, true) => "All systems connected",
                (true, false) => "SQL connected — API offline",
                (false, true) => "API connected — SQL offline",
                _ => "Disconnected"
            };
        }
    }
}
