using System;

namespace JtlSyncEngine.Models
{
    public class SyncTriggerInfo
    {
        public string Id { get; set; } = "";
        public string Module { get; set; } = "";
        public string Status { get; set; } = "pending";
        public string SyncMode { get; set; } = "incremental";
        public DateTime CreatedAt { get; set; }
    }

    public class TriggerPollResult
    {
        public System.Collections.Generic.List<SyncTriggerInfo> Triggers { get; set; }
            = new System.Collections.Generic.List<SyncTriggerInfo>();

        public System.Collections.Generic.List<SyncTriggerInfo> Data { get; set; }
            = new System.Collections.Generic.List<SyncTriggerInfo>();
    }

    public class HeartbeatRequest
    {
        public string MachineId { get; set; } = "";
        public string MachineName { get; set; } = "";
        public string EngineVersion { get; set; } = "";
        public string OsVersion { get; set; } = "";
        public string Status { get; set; } = "idle";
    }

    public class ClaimTriggerResponse
    {
        public bool Claimed { get; set; }
        public string Reason { get; set; } = "";
        public SyncTriggerInfo? Trigger { get; set; }
    }

    public class TriggerStatusUpdate
    {
        public string Status { get; set; } = "running";
        public int? ProgressPercent { get; set; }
        public int? CurrentBatch { get; set; }
        public int? TotalBatches { get; set; }
        public int? RowsSynced { get; set; }
        public string Message { get; set; } = "";
        public string ErrorMessage { get; set; } = "";
    }
}
