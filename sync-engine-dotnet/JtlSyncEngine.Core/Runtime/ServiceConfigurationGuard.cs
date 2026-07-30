using System.IO;

namespace JtlSyncEngine.Runtime
{
    public static class ServiceConfigurationGuard
    {
        public static string MigrationMarker =>
            Path.Combine(RuntimePaths.ServiceRoot, "state", "migration-v1.complete");

        public static bool RequiresUserContextMigration() =>
            RequiresUserContextMigration(
                Path.Combine(RuntimePaths.LegacyRoot, "secrets.dat"),
                Path.Combine(RuntimePaths.ServiceRoot, "secrets", "secrets.dat"),
                MigrationMarker);

        /// <summary>
        /// True when credentials exist that only the original user can decrypt, and
        /// the service has no copy of its own yet.
        /// </summary>
        /// <remarks>
        /// Secrets written by the portable app are DPAPI-protected for CurrentUser;
        /// the service runs under a different identity and cannot read them. Overload
        /// taking explicit paths so the decision can be tested without writing into
        /// the real per-machine directories.
        /// </remarks>
        public static bool RequiresUserContextMigration(
            string legacySecretsPath,
            string serviceSecretsPath,
            string migrationMarkerPath) =>
            File.Exists(legacySecretsPath) &&
            !File.Exists(serviceSecretsPath) &&
            !File.Exists(migrationMarkerPath);
    }
}
