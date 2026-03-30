using System;
using System.Collections.ObjectModel;
using System.ComponentModel;
using System.IO;
using System.Linq;
using System.Windows.Data;
using System.Windows.Input;
using JtlSyncEngine.Helpers;
using JtlSyncEngine.Models;
using JtlSyncEngine.Services;
using Microsoft.Win32;

namespace JtlSyncEngine.ViewModels
{
    public class LogsViewModel : BaseViewModel
    {
        private readonly LogService _log;
        private string _filterLevel = "All";
        private string _filterModule = "";
        private string _searchText = "";
        private ICollectionView _logsView;

        public ObservableCollection<LogEntry> AllEntries => _log.Entries;
        public ICollectionView LogsView => _logsView;

        public string FilterLevel
        {
            get => _filterLevel;
            set
            {
                SetProperty(ref _filterLevel, value);
                _logsView.Refresh();
            }
        }

        public string FilterModule
        {
            get => _filterModule;
            set
            {
                SetProperty(ref _filterModule, value);
                _logsView.Refresh();
            }
        }

        public string SearchText
        {
            get => _searchText;
            set
            {
                SetProperty(ref _searchText, value);
                _logsView.Refresh();
            }
        }

        public string[] LevelOptions { get; } = { "All", "DEBUG", "INFO", "WARN", "ERROR" };

        public ICommand ClearLogsCommand { get; }
        public ICommand ExportLogsCommand { get; }

        public LogsViewModel(LogService log)
        {
            _log = log;

            _logsView = CollectionViewSource.GetDefaultView(AllEntries);
            _logsView.Filter = FilterPredicate;

            _log.EntryAdded += _ =>
            {
                System.Windows.Application.Current?.Dispatcher.InvokeAsync(() =>
                {
                    _logsView.Refresh();
                });
            };

            ClearLogsCommand = new RelayCommand(ClearLogs);
            ExportLogsCommand = new RelayCommand(ExportLogs);
        }

        private bool FilterPredicate(object obj)
        {
            if (obj is not LogEntry entry) return false;

            if (FilterLevel != "All")
            {
                var targetLevel = FilterLevel switch
                {
                    "DEBUG" => LogLevel.Debug,
                    "INFO" => LogLevel.Info,
                    "WARN" => LogLevel.Warning,
                    "ERROR" => LogLevel.Error,
                    _ => (LogLevel?)null
                };
                if (targetLevel.HasValue && entry.Level != targetLevel.Value) return false;
            }

            if (!string.IsNullOrWhiteSpace(FilterModule))
            {
                if (!entry.Module.Contains(FilterModule, StringComparison.OrdinalIgnoreCase))
                    return false;
            }

            if (!string.IsNullOrWhiteSpace(SearchText))
            {
                if (!entry.Message.Contains(SearchText, StringComparison.OrdinalIgnoreCase) &&
                    !entry.Module.Contains(SearchText, StringComparison.OrdinalIgnoreCase))
                    return false;
            }

            return true;
        }

        private void ClearLogs()
        {
            AllEntries.Clear();
            _log.Info("Logs", "Log history cleared");
        }

        private void ExportLogs()
        {
            try
            {
                var dialog = new SaveFileDialog
                {
                    Filter = "Log files (*.log)|*.log|Text files (*.txt)|*.txt|All files (*.*)|*.*",
                    FileName = $"jtl-sync-export-{DateTime.Now:yyyyMMdd-HHmmss}.log",
                    DefaultExt = ".log"
                };

                if (dialog.ShowDialog() == true)
                {
                    _log.ExportToFile(dialog.FileName);
                    _log.Info("Logs", $"Logs exported to {dialog.FileName}");
                }
            }
            catch (Exception ex)
            {
                _log.Error("Logs", "Export failed", ex);
            }
        }
    }
}
