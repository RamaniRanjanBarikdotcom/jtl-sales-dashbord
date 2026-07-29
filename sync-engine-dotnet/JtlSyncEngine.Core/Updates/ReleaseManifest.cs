using Newtonsoft.Json;

namespace JtlSyncEngine.Updates
{
    public sealed class ReleaseManifest
    {
        public string ApplicationId { get; set; } = "";
        public string Channel { get; set; } = "";
        public string Version { get; set; } = "";
        public string GitSha { get; set; } = "";
        public int ProtocolVersion { get; set; }
        public string? MinimumSupportedVersion { get; set; }
        public string PackagePath { get; set; } = "";
        public long PackageSize { get; set; }
        public string Sha256 { get; set; } = "";
        public string[] PublisherCertificateThumbprints { get; set; } = Array.Empty<string>();
        public string PublishedAt { get; set; } = "";
        public bool RequiresServiceRestart { get; set; }
        public bool RequiresMachineRestart { get; set; }
        public int HealthTimeoutSeconds { get; set; } = 120;
        public string? ReleaseNotes { get; set; }
    }

    public sealed class ReleaseEnvelope
    {
        public string Id { get; set; } = "";
        public ReleaseManifest Manifest { get; set; } = new();
        public string Signature { get; set; } = "";
    }

    public sealed class AgentUpdateRequest
    {
        public string Id { get; set; } = "";
        public string ReleaseId { get; set; } = "";
        public string UpdateTransactionId { get; set; } = "";
        public string CurrentVersion { get; set; } = "";
        public string CurrentGitSha { get; set; } = "";
        public string TargetVersion { get; set; } = "";
        public string TargetGitSha { get; set; } = "";
        public string InstallMode { get; set; } = "maintenance";
        public bool RetryFailed { get; set; }
        public string Status { get; set; } = "";
        public ReleaseEnvelope Release { get; set; } = new();
    }

    public sealed class AgentUpdateClaimResponse
    {
        public AgentUpdateRequest? Update { get; set; }
    }

    public sealed class AgentReleaseAvailability
    {
        public bool UpdateAvailable { get; set; }
        public string CurrentVersion { get; set; } = "";
        public ReleaseEnvelope? Release { get; set; }
    }
}
