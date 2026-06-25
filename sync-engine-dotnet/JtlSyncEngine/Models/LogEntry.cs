using System;

namespace JtlSyncEngine.Models
{
    public enum LogLevel
    {
        Debug,
        Info,
        Warning,
        Error
    }

    public class LogEntry
    {
        public DateTime Timestamp { get; set; } = DateTime.Now;
        public LogLevel Level { get; set; } = LogLevel.Info;
        public string Module { get; set; } = "";
        public string Message { get; set; } = "";
        public string? ExceptionDetail { get; set; }

        public string LevelLabel => Level switch
        {
            LogLevel.Debug => "DEBUG",
            LogLevel.Info => "INFO",
            LogLevel.Warning => "WARN",
            LogLevel.Error => "ERROR",
            _ => "INFO"
        };

        public string LevelColor => Level switch
        {
            LogLevel.Debug => "#94a3b8",
            LogLevel.Info => "#60a5fa",
            LogLevel.Warning => "#fbbf24",
            LogLevel.Error => "#f87171",
            _ => "#60a5fa"
        };

        public string TimestampDisplay => Timestamp.ToString("HH:mm:ss.fff");
        public string DateDisplay => Timestamp.ToString("yyyy-MM-dd HH:mm:ss.fff");

        public string FullDisplay => $"[{DateDisplay}] [{LevelLabel}] [{Module}] {Message}" +
            (ExceptionDetail != null ? $"\n  Exception: {ExceptionDetail}" : "");
    }
}
