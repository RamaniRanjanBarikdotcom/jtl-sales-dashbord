using System;
using Newtonsoft.Json.Linq;

namespace JtlSyncEngine.Ipc
{
    public static class ServiceControlProtocol
    {
        public const string PipeName = "JtlSyncEngine.Control.v1";
        public const int ProtocolVersion = 1;
    }

    public sealed class ServiceControlRequest
    {
        public int ProtocolVersion { get; set; } = ServiceControlProtocol.ProtocolVersion;
        public string Command { get; set; } = "";
        public JObject? Payload { get; set; }
        public string RequestId { get; set; } = Guid.NewGuid().ToString("N");
    }

    public sealed class ServiceControlResponse
    {
        public int ProtocolVersion { get; set; } = ServiceControlProtocol.ProtocolVersion;
        public string RequestId { get; set; } = "";
        public bool Success { get; set; }
        public string? Error { get; set; }
        public object? Data { get; set; }
    }
}
