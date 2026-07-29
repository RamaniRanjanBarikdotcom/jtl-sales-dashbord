using JtlSyncEngine.Runtime;
using Newtonsoft.Json;

namespace JtlSyncEngine.Updates
{
    public sealed class BadReleaseRegistry
    {
        private static string PathName => Path.Combine(RuntimePaths.UpdateFailed,"bad-releases.json");

        public bool IsSuppressed(string releaseId)
        {
            var records = Load();
            return records.TryGetValue(releaseId,out var record) &&
                (record.PermanentlyBlocked || record.SuppressedUntil > DateTime.UtcNow);
        }

        public void Record(
            string agentId,string releaseId,string version,string category,bool rollbackSucceeded)
        {
            var records = Load();
            records.TryGetValue(releaseId,out var current);
            var attempts = (current?.AttemptCount ?? 0) + 1;
            records[releaseId] = new BadReleaseRecord
            {
                AgentId = agentId,ReleaseId = releaseId,Version = version,FailureCategory = category,
                AttemptCount = attempts,RollbackSucceeded = rollbackSucceeded,
                LastFailedAt = DateTime.UtcNow,PermanentlyBlocked = attempts >= 3,
                SuppressedUntil = attempts >= 3 ? null : DateTime.UtcNow.AddHours(Math.Pow(2,attempts)),
            };
            Directory.CreateDirectory(RuntimePaths.UpdateFailed);
            var temp = $"{PathName}.tmp";
            File.WriteAllText(temp,JsonConvert.SerializeObject(records,Formatting.Indented));
            File.Move(temp,PathName,true);
        }

        private static Dictionary<string,BadReleaseRecord> Load()
        {
            try
            {
                return File.Exists(PathName)
                    ? JsonConvert.DeserializeObject<Dictionary<string,BadReleaseRecord>>(File.ReadAllText(PathName)) ?? new()
                    : new();
            }
            catch { return new(); }
        }

        private sealed class BadReleaseRecord
        {
            public string AgentId { get; set; } = "";
            public string ReleaseId { get; set; } = "";
            public string Version { get; set; } = "";
            public string FailureCategory { get; set; } = "";
            public int AttemptCount { get; set; }
            public bool RollbackSucceeded { get; set; }
            public DateTime LastFailedAt { get; set; }
            public DateTime? SuppressedUntil { get; set; }
            public bool PermanentlyBlocked { get; set; }
        }
    }
}
