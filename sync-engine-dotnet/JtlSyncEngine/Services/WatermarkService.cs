using System;
using System.IO;
using Newtonsoft.Json;

namespace JtlSyncEngine.Services
{
    public class WatermarkData
    {
        public DateTime LastSyncTime { get; set; }
        public DateTime LastSuccessfulSync { get; set; }
        public long TotalRowsSynced { get; set; }
        public int SyncCount { get; set; }

        // Checkpoint: tracks where a failed sync left off so the next run can resume
        // instead of re-syncing from offset 0.
        public int ResumeOffset { get; set; }
        public DateTime ResumeWindowEnd { get; set; } = DateTime.MinValue;
    }

    public class WatermarkService
    {
        private readonly string _watermarkDir;
        private readonly LogService _log;

        public WatermarkService(LogService log)
        {
            _log = log;
            _watermarkDir = Path.Combine(ConfigService.AppDataDirectory, "watermarks");
            Directory.CreateDirectory(_watermarkDir);
            PurgeEmptyWatermarks();
        }

        /// <summary>
        /// Delete any watermark files where TotalRowsSynced == 0.
        /// These were written during failed or empty syncs and would
        /// permanently lock the sync window to "now".
        /// </summary>
        private void PurgeEmptyWatermarks()
        {
            foreach (var module in new[] { "orders", "products", "customers", "inventory" })
            {
                var path = GetFilePath(module);
                if (!File.Exists(path)) continue;
                try
                {
                    var json = File.ReadAllText(path);
                    var data = JsonConvert.DeserializeObject<WatermarkData>(json);
                    if (data != null && data.TotalRowsSynced == 0)
                    {
                        File.Delete(path);
                        _log.Info("WatermarkService", $"Purged empty watermark for {module} — will re-sync from 2 years ago");
                    }
                }
                catch { /* ignore — will use default */ }
            }
        }

        private string GetFilePath(string module) =>
            Path.Combine(_watermarkDir, $"{module.ToLower()}.json");

        public WatermarkData GetWatermark(string module)
        {
            var path = GetFilePath(module);
            try
            {
                if (File.Exists(path))
                {
                    var json = File.ReadAllText(path);
                    var data = JsonConvert.DeserializeObject<WatermarkData>(json);
                    if (data != null)
                        return data;
                }
            }
            catch (Exception ex)
            {
                _log.Warn("WatermarkService", $"Failed to read watermark for {module}", ex);
            }

            // Default start: year 2000 for ALL modules so full history is captured
            // (orders go back to 2010 in this JTL instance)
            var defaultStart = new DateTime(2000, 1, 1, 0, 0, 0, DateTimeKind.Utc);

            return new WatermarkData
            {
                LastSyncTime = defaultStart,
                LastSuccessfulSync = DateTime.MinValue,
                TotalRowsSynced = 0,
                SyncCount = 0
            };
        }

        public DateTime GetLastSyncTime(string module)
        {
            return GetWatermark(module).LastSyncTime;
        }

        public void UpdateWatermark(string module, DateTime syncTime, long rowsSynced)
        {
            var path = GetFilePath(module);
            try
            {
                var existing = GetWatermark(module);
                existing.LastSuccessfulSync = existing.LastSyncTime;
                existing.LastSyncTime = syncTime;
                existing.TotalRowsSynced += rowsSynced;
                existing.SyncCount++;

                var json = JsonConvert.SerializeObject(existing, Formatting.Indented);
                File.WriteAllText(path, json);
                _log.Debug("WatermarkService", $"Updated watermark for {module}: {syncTime:yyyy-MM-ddTHH:mm:ssZ}");
            }
            catch (Exception ex)
            {
                _log.Error("WatermarkService", $"Failed to save watermark for {module}", ex);
            }
        }

        /// <summary>
        /// Save a checkpoint so the next sync can resume from this offset
        /// instead of re-syncing everything from offset 0.
        /// </summary>
        public void SaveCheckpoint(string module, int offset, DateTime windowEnd)
        {
            var path = GetFilePath(module);
            try
            {
                var existing = GetWatermark(module);
                existing.ResumeOffset = offset;
                existing.ResumeWindowEnd = windowEnd;
                var json = JsonConvert.SerializeObject(existing, Formatting.Indented);
                File.WriteAllText(path, json);
                _log.Debug("WatermarkService", $"Checkpoint saved for {module}: offset={offset}");
            }
            catch (Exception ex)
            {
                _log.Error("WatermarkService", $"Failed to save checkpoint for {module}", ex);
            }
        }

        /// <summary>
        /// Clear the checkpoint after a successful full sync.
        /// </summary>
        public void ClearCheckpoint(string module)
        {
            var path = GetFilePath(module);
            try
            {
                var existing = GetWatermark(module);
                if (existing.ResumeOffset > 0)
                {
                    existing.ResumeOffset = 0;
                    existing.ResumeWindowEnd = DateTime.MinValue;
                    var json = JsonConvert.SerializeObject(existing, Formatting.Indented);
                    File.WriteAllText(path, json);
                    _log.Debug("WatermarkService", $"Checkpoint cleared for {module}");
                }
            }
            catch { /* ignore */ }
        }

        /// <summary>
        /// Get the resume offset and window end time (if a checkpoint exists).
        /// Returns (0, MinValue) if no checkpoint — meaning start from scratch.
        /// </summary>
        public (int offset, DateTime windowEnd) GetCheckpoint(string module)
        {
            var wm = GetWatermark(module);
            return (wm.ResumeOffset, wm.ResumeWindowEnd);
        }

        public void ResetWatermark(string module)
        {
            var path = GetFilePath(module);
            try
            {
                if (File.Exists(path))
                    File.Delete(path);
                _log.Info("WatermarkService", $"Reset watermark for {module}");
            }
            catch (Exception ex)
            {
                _log.Error("WatermarkService", $"Failed to reset watermark for {module}", ex);
            }
        }
    }
}
