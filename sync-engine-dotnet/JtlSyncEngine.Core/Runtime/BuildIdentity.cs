using System;
using System.Reflection;
using System.Linq;

namespace JtlSyncEngine.Runtime
{
    public static class BuildIdentity
    {
        public static string Version =>
            Assembly.GetEntryAssembly()?.GetName().Version?.ToString() ?? "unknown";

        public static string GitSha =>
            GetMetadata("GitSha") ??
            Environment.GetEnvironmentVariable("JTL_SYNC_BUILD_SHA") ??
            "development";

        public static string BuildTime =>
            GetMetadata("BuildTime") ??
            Environment.GetEnvironmentVariable("JTL_SYNC_BUILD_TIME") ??
            "unknown";

        public const int ConfigurationSchemaVersion = 1;
        public const int MigrationVersion = 1;

        private static string? GetMetadata(string key) =>
            Assembly.GetEntryAssembly()?
                .GetCustomAttributes<AssemblyMetadataAttribute>()
                .FirstOrDefault(attribute => attribute.Key == key)?
                .Value;
    }
}
