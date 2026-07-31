using System.IO;

namespace JtlSyncEngine.Runtime
{
    public static class ServiceConfigurationGuard
    {
        public static string MigrationMarker =>
            Path.Combine(RuntimePaths.ServiceRoot, "state", "migration-v1.complete");

        public static string ServiceSecretsPath =>
            Path.Combine(RuntimePaths.ServiceRoot, "secrets", "secrets.dat");

        /// <summary>
        /// True when the service has no credentials it can use.
        /// </summary>
        /// <remarks>
        /// This deliberately does NOT look at the per-user legacy folder. The service
        /// runs as LocalService, so <see cref="RuntimePaths.LegacyRoot"/> resolves to
        /// C:\Windows\ServiceProfiles\LocalService\... — the service's own profile,
        /// never the operator's. Judging migration from that path made the service
        /// report "migration required" forever while the real credentials sat
        /// migrated and ready in ProgramData.
        ///
        /// What actually matters is only whether the service has its own secrets file.
        /// </remarks>
        public static bool RequiresUserContextMigration() =>
            !File.Exists(ServiceSecretsPath);

        /// <summary>
        /// Whether a per-user installation still needs migrating into the service
        /// store. Only meaningful when called from the interactive app, where the
        /// legacy path resolves to the real operator profile.
        /// </summary>
        public static bool LegacyDataNeedsMigration(
            string legacySecretsPath,
            string serviceSecretsPath,
            string migrationMarkerPath) =>
            File.Exists(legacySecretsPath) &&
            !File.Exists(serviceSecretsPath) &&
            !File.Exists(migrationMarkerPath);
    }
}
