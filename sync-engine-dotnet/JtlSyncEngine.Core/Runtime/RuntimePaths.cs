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
        };

        public static void EnsureCurrentLayout()
        {
            Directory.CreateDirectory(CurrentRoot);
            foreach (var directory in RequiredDirectories)
                Directory.CreateDirectory(Path.Combine(CurrentRoot, directory));
        }
    }
}
