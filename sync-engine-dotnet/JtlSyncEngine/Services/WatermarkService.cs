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

            // Default: 2 years ago for initial full sync
            return new WatermarkData
            {
                LastSyncTime = DateTime.UtcNow.AddYears(-2),
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
