namespace JtlSyncEngine.Updates
{
    public sealed class UpdateTransaction
    {
        public string TransactionId { get; set; } = "";
        public string UpdateRequestId { get; set; } = "";
        public string ReleaseId { get; set; } = "";
        public string AgentId { get; set; } = "";
        public string ExpectedServiceName { get; set; } = "JtlSyncEngine";
        public string InstallDirectory { get; set; } = "";
        public string StagedPayloadDirectory { get; set; } = "";
        public string BackupDirectory { get; set; } = "";
        public string CurrentVersion { get; set; } = "";
        public string CurrentGitSha { get; set; } = "";
        public string TargetVersion { get; set; } = "";
        public string TargetGitSha { get; set; } = "";
        public string[] PublisherCertificateThumbprints { get; set; } = Array.Empty<string>();
        public int ServiceProcessId { get; set; }
        public int HealthTimeoutSeconds { get; set; } = 120;
        public string State { get; set; } = "staged";
        public string? ErrorCode { get; set; }
        public string? ErrorMessage { get; set; }
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    }
}
