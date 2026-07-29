using System.IO;

namespace JtlSyncEngine.Runtime
{
    public static class ServiceConfigurationGuard
    {
        public static string MigrationMarker =>
            Path.Combine(RuntimePaths.ServiceRoot, "state", "migration-v1.complete");

        public static bool RequiresUserContextMigration()
        {
            var legacySecrets = Path.Combine(RuntimePaths.LegacyRoot, "secrets.dat");
            var serviceSecrets = Path.Combine(
                RuntimePaths.ServiceRoot,
                "secrets",
                "secrets.dat");
            return File.Exists(legacySecrets) &&
                   !File.Exists(serviceSecrets) &&
                   !File.Exists(MigrationMarker);
        }
    }
}
