using System;
using System.IO;
using System.Security.Cryptography;

namespace JtlSyncEngine.Runtime
{
    public static class RuntimePaths
    {
        public static bool IsServiceMode =>
            string.Equals(
                Environment.GetEnvironmentVariable("JTL_SYNC_RUNTIME_MODE"),
                "service",
                StringComparison.OrdinalIgnoreCase);

        /// <summary>
        /// True only inside the Windows Service process itself.
        /// </summary>
        /// <remarks>
        /// The management UI also runs in service *mode* — it reads the same
        /// ProgramData store so it shows what the service actually uses — but it holds
        /// only read access there. The two must be told apart when deciding whether a
        /// write failure is fatal: for the service it is, for the UI it is not.
        /// </remarks>
        public static bool IsServiceHost =>
            string.Equals(
                Environment.GetEnvironmentVariable("JTL_SYNC_RUNTIME_HOST"),
                "service",
                StringComparison.OrdinalIgnoreCase);

        public static string LegacyRoot => Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "JTL-Sync");

        public static string ServiceRoot => Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
            "JTL-Sync");

        public static string CurrentRoot => IsServiceMode ? ServiceRoot : LegacyRoot;

        public static DataProtectionScope SecretScope =>
            IsServiceMode ? DataProtectionScope.LocalMachine : DataProtectionScope.CurrentUser;

        public static readonly string[] RequiredDirectories =
        {
            "config",
            "secrets",
            "watermarks",
            "logs",
            "diagnostics",
            "failed-batches",
            "state",
            "backups",
            "updates",
            "updates/downloads",
            "updates/staging",
            "updates/backups",
            "updates/transactions",
            "updates/failed",
        };

        public static string UpdatesRoot => Path.Combine(CurrentRoot, "updates");
        public static string UpdateDownloads => Path.Combine(UpdatesRoot, "downloads");
        public static string UpdateStaging => Path.Combine(UpdatesRoot, "staging");
        public static string UpdateBackups => Path.Combine(UpdatesRoot, "backups");
        public static string UpdateTransactions => Path.Combine(UpdatesRoot, "transactions");
        public static string UpdateFailed => Path.Combine(UpdatesRoot, "failed");

        public static void EnsureCurrentLayout()
        {
            Directory.CreateDirectory(CurrentRoot);
            foreach (var directory in RequiredDirectories)
                Directory.CreateDirectory(Path.Combine(CurrentRoot, directory));
        }
    }
}
