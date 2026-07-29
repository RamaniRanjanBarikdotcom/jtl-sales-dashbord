using Newtonsoft.Json.Linq;

namespace JtlSyncEngine.Models
{
    public sealed class SyncCommandInfo
    {
        public string Id { get; set; } = "";
        public string CommandType { get; set; } = "";
        public string Status { get; set; } = "";
        public string? CorrelationId { get; set; }
        public JObject? Payload { get; set; }
    }

    public sealed class SyncCommandClaimResponse
    {
        public SyncCommandInfo? Command { get; set; }
        public int LeaseSeconds { get; set; }
    }

    public sealed class SyncCommandLeaseResponse
    {
        public string Id { get; set; } = "";
        public string Status { get; set; } = "";
        public DateTime LeaseUntil { get; set; }
    }
}
