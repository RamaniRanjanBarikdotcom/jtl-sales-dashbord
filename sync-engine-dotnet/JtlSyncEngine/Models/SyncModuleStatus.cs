using System;
using System.ComponentModel;
using System.Runtime.CompilerServices;

namespace JtlSyncEngine.Models
{
    public enum SyncStatus
    {
        Idle,
        Running,
        Ok,
        Error,
        Warning
    }

    public class SyncModuleStatus : INotifyPropertyChanged
    {
        private string _moduleName = "";
        private SyncStatus _status = SyncStatus.Idle;
        private DateTime? _lastSyncTime;
        private DateTime? _nextSyncTime;
        private long _rowsSynced;
        private string _statusMessage = "";
        private bool _isRunning;
        private int _currentBatch;
        private int _totalBatches;
        private string _errorMessage = "";

        public string ModuleName
        {
            get => _moduleName;
            set { _moduleName = value; OnPropertyChanged(); }
        }

        public SyncStatus Status
        {
            get => _status;
            set { _status = value; OnPropertyChanged(); OnPropertyChanged(nameof(StatusLabel)); OnPropertyChanged(nameof(StatusColor)); }
        }

        public DateTime? LastSyncTime
        {
            get => _lastSyncTime;
            set { _lastSyncTime = value; OnPropertyChanged(); OnPropertyChanged(nameof(LastSyncDisplay)); }
        }

        public DateTime? NextSyncTime
        {
            get => _nextSyncTime;
            set { _nextSyncTime = value; OnPropertyChanged(); OnPropertyChanged(nameof(NextSyncDisplay)); }
        }

        public long RowsSynced
        {
            get => _rowsSynced;
            set { _rowsSynced = value; OnPropertyChanged(); }
        }

        public string StatusMessage
        {
            get => _statusMessage;
            set { _statusMessage = value; OnPropertyChanged(); }
        }

        public bool IsRunning
        {
            get => _isRunning;
            set { _isRunning = value; OnPropertyChanged(); }
        }

        public int CurrentBatch
        {
            get => _currentBatch;
            set { _currentBatch = value; OnPropertyChanged(); OnPropertyChanged(nameof(ProgressDisplay)); }
        }

        public int TotalBatches
        {
            get => _totalBatches;
            set { _totalBatches = value; OnPropertyChanged(); OnPropertyChanged(nameof(ProgressDisplay)); }
        }

        public string ErrorMessage
        {
            get => _errorMessage;
            set { _errorMessage = value; OnPropertyChanged(); }
        }

        public string StatusLabel => Status switch
        {
            SyncStatus.Running => "Running",
            SyncStatus.Ok => "OK",
            SyncStatus.Error => "Error",
            SyncStatus.Warning => "Warning",
            _ => "Idle"
        };

        public string StatusColor => Status switch
        {
            SyncStatus.Running => "#60a5fa",
            SyncStatus.Ok => "#34d399",
            SyncStatus.Error => "#f87171",
            SyncStatus.Warning => "#fbbf24",
            _ => "#64748b"
        };

        public string LastSyncDisplay
        {
            get
            {
                if (!_lastSyncTime.HasValue) return "Never";
                var diff = DateTime.UtcNow - _lastSyncTime.Value;
                if (diff.TotalSeconds < 60) return "Just now";
                if (diff.TotalMinutes < 60) return $"{(int)diff.TotalMinutes} min ago";
                if (diff.TotalHours < 24) return $"{(int)diff.TotalHours}h ago";
                return _lastSyncTime.Value.ToString("dd.MM.yyyy HH:mm");
            }
        }

        public string NextSyncDisplay
        {
            get
            {
                if (!_nextSyncTime.HasValue) return "—";
                var diff = _nextSyncTime.Value - DateTime.UtcNow;
                if (diff.TotalSeconds < 0) return "Pending";
                if (diff.TotalSeconds < 60) return $"in {(int)diff.TotalSeconds}s";
                if (diff.TotalMinutes < 60) return $"in {(int)diff.TotalMinutes} min";
                return $"in {(int)diff.TotalHours}h";
            }
        }

        public string ProgressDisplay => TotalBatches > 0 ? $"Batch {CurrentBatch}/{TotalBatches}" : "";

        public event PropertyChangedEventHandler? PropertyChanged;
        protected void OnPropertyChanged([CallerMemberName] string? name = null)
            => PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
    }
}
