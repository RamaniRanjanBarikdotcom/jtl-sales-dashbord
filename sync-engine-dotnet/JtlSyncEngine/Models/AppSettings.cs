using System;

namespace JtlSyncEngine.Models
{
    public class AppSettings
    {
        // SQL Server Connection
        public string SqlHost { get; set; } = "localhost";
        public int SqlPort { get; set; } = 1433;
        public string SqlDatabase { get; set; } = "eazybusiness";
        public string SqlUsername { get; set; } = "sa";
        public bool SqlWindowsAuth { get; set; } = false;

        // Backend API
        public string BackendApiUrl { get; set; } = "";
        public string TenantId { get; set; } = "";
        public string MachineId { get; set; } = Environment.MachineName;

        // Sync Schedule (interval in minutes for each module)
        public int OrdersSyncIntervalMinutes { get; set; } = 5;
        public int ProductsSyncIntervalMinutes { get; set; } = 30;
        public int CustomersSyncIntervalMinutes { get; set; } = 30;
        public int InventorySyncIntervalMinutes { get; set; } = 15;

        // Batch Settings
        public int BatchSize { get; set; } = 200;      // rows per HTTP POST to backend
        public int BatchDelayMs { get; set; } = 150;   // ms pause between batches
        public int HttpTimeoutSeconds { get; set; } = 180; // per-batch HTTP timeout
        public int OrdersStatusLookbackDays { get; set; } = 30; // re-scan recent orders for cancel/return updates

        // Inventory Source Safety
        public bool JtlReadOnlyMode { get; set; } = true;
        public string InventorySourceMode { get; set; } = "legacy"; // legacy | auto
        public bool InventoryDiagnosticsOnly { get; set; } = false;
        public bool InventoryDryRun { get; set; } = false;
        public string InventoryZeroStockPolicy { get; set; } = "verify";
        public bool InventoryAllowConfirmedZeroStock { get; set; } = true;
        public bool InventoryRejectUnverifiedZeroStock { get; set; } = true;
        public bool InventoryRejectConflictingStockSources { get; set; } = true;
        public bool InventoryRequireSourceMetadata { get; set; } = true;

        // App Settings
        public bool StartWithWindows { get; set; } = false;
        public bool StartMinimized { get; set; } = false;

        // Retry Settings
        public int MaxRetries { get; set; } = 3;
        public int RetryDelayMs { get; set; } = 2000;
    }

    public class SecretSettings
    {
        public string SqlPassword { get; set; } = "";
        public string ApiKey { get; set; } = "";
    }
}
