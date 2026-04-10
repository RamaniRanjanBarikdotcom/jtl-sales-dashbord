using System;

namespace JtlSyncEngine.Models
{
    public class SyncTriggerInfo
    {
        public string Id { get; set; } = "";
        public string Module { get; set; } = "";
        public string Status { get; set; } = "pending";
        public DateTime CreatedAt { get; set; }
    }

    public class TriggerPollResult
    {
        public System.Collections.Generic.List<SyncTriggerInfo> Data { get; set; }
            = new System.Collections.Generic.List<SyncTriggerInfo>();
    }
}
