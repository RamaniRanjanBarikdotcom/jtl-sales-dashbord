using System;
using System.Collections.Generic;

namespace JtlSyncEngine.Models
{
    public class IngestBatch
    {
        public string Module { get; set; } = "";
        public string TenantId { get; set; } = "";
        public int BatchIndex { get; set; }
        public int TotalBatches { get; set; }
        public DateTime SyncStartTime { get; set; }
        public DateTime WatermarkTime { get; set; }
        public List<object> Rows { get; set; } = new();
    }

    public class IngestBatchResult
    {
        public bool Success { get; set; }
        public string? ErrorMessage { get; set; }
        public int RowsAccepted { get; set; }
        public string? BatchId { get; set; }
    }
}
