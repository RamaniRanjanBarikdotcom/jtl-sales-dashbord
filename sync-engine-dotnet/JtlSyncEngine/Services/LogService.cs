using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.IO;
using System.Text;
using System.Threading;
using JtlSyncEngine.Models;

namespace JtlSyncEngine.Services
{
    public class LogService
    {
        private const int MaxInMemory = 1000;
        private readonly ObservableCollection<LogEntry> _entries = new();
        private readonly object _lock = new();
        private readonly string _logDirectory;
        private StreamWriter? _fileWriter;
        private string _currentLogFile = "";
        private readonly Timer _flushTimer;

        public ObservableCollection<LogEntry> Entries => _entries;

        public event Action<LogEntry>? EntryAdded;

        public LogService()
        {
            _logDirectory = Path.Combine(ConfigService.AppDataDirectory, "logs");
            Directory.CreateDirectory(_logDirectory);
            OpenLogFile();
            _flushTimer = new Timer(_ => FlushFile(), null, TimeSpan.FromSeconds(5), TimeSpan.FromSeconds(5));
        }

        private void OpenLogFile()
        {
            try
            {
                var filename = $"sync-{DateTime.Now:yyyy-MM-dd}.log";
                var path = Path.Combine(_logDirectory, filename);

                if (path != _currentLogFile)
                {
                    _fileWriter?.Flush();
                    _fileWriter?.Dispose();
                    _currentLogFile = path;
                    _fileWriter = new StreamWriter(path, append: true, encoding: Encoding.UTF8)
                    {
                        AutoFlush = false
                    };
                }
            }
            catch
            {
                // ignore log file errors
            }
        }

        private void FlushFile()
        {
            try
            {
                OpenLogFile(); // rotate if date changed
                _fileWriter?.Flush();
            }
            catch { }
        }

        public void Log(LogLevel level, string module, string message, Exception? ex = null)
        {
            var entry = new LogEntry
            {
                Timestamp = DateTime.Now,
                Level = level,
                Module = module,
                Message = message,
                ExceptionDetail = ex != null ? FormatException(ex) : null
            };

            lock (_lock)
            {
                WriteToFile(entry);
            }

            // Update UI on dispatcher thread
            System.Windows.Application.Current?.Dispatcher.InvokeAsync(() =>
            {
                _entries.Add(entry);
                while (_entries.Count > MaxInMemory)
                    _entries.RemoveAt(0);
                EntryAdded?.Invoke(entry);
            });
        }

        private void WriteToFile(LogEntry entry)
        {
            try
            {
                _fileWriter?.WriteLine(entry.FullDisplay);
            }
            catch { }
        }

        private string FormatException(Exception ex)
        {
            var sb = new StringBuilder();
            sb.AppendLine(ex.GetType().Name + ": " + ex.Message);
            if (ex.StackTrace != null)
            {
                var lines = ex.StackTrace.Split('\n');
                foreach (var line in lines)
                    sb.AppendLine("  " + line.Trim());
            }
            if (ex.InnerException != null)
            {
                sb.AppendLine("Inner: " + ex.InnerException.Message);
            }
            return sb.ToString().TrimEnd();
        }

        public void Info(string module, string message) => Log(LogLevel.Info, module, message);
        public void Warn(string module, string message, Exception? ex = null) => Log(LogLevel.Warning, module, message, ex);
        public void Error(string module, string message, Exception? ex = null) => Log(LogLevel.Error, module, message, ex);
        public void Debug(string module, string message) => Log(LogLevel.Debug, module, message);

        public List<LogEntry> GetFiltered(LogLevel? level = null, string? module = null)
        {
            var result = new List<LogEntry>();
            foreach (var e in _entries)
            {
                if (level.HasValue && e.Level != level.Value) continue;
                if (!string.IsNullOrEmpty(module) && !string.Equals(e.Module, module, StringComparison.OrdinalIgnoreCase)) continue;
                result.Add(e);
            }
            return result;
        }

        public void ExportToFile(string path)
        {
            using var writer = new StreamWriter(path, append: false, encoding: Encoding.UTF8);
            foreach (var e in _entries)
                writer.WriteLine(e.FullDisplay);
        }

        public void Dispose()
        {
            _flushTimer.Dispose();
            _fileWriter?.Flush();
            _fileWriter?.Dispose();
        }
    }
}
