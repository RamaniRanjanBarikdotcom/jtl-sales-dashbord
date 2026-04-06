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
