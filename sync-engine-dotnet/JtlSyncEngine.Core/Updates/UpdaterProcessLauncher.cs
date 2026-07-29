using System.Diagnostics;
using JtlSyncEngine.Runtime;

namespace JtlSyncEngine.Updates
{
    public sealed class UpdaterProcessLauncher
    {
        private readonly AuthenticodeVerifier _authenticode = new();

        public void Launch(
            string installDirectory,
            string transactionId,
            IEnumerable<string> publisherCertificateThumbprints)
        {
            var source = Path.Combine(installDirectory,"JtlSyncEngine.Updater.exe");
            if (!File.Exists(source)) throw new FileNotFoundException("Trusted updater helper is not installed.",source);
            _authenticode.Verify(source,publisherCertificateThumbprints);
            var transactionRoot = UpdateStagingService.TrustedChild(RuntimePaths.UpdateStaging,transactionId);
            var helper = Path.Combine(transactionRoot,"JtlSyncEngine.Updater.exe");
            File.Copy(source,helper,true);
            _authenticode.Verify(helper,publisherCertificateThumbprints);
            var process = Process.Start(new ProcessStartInfo
            {
                FileName = helper,
                Arguments = $"--transaction {transactionId}",
                UseShellExecute = false,
                CreateNoWindow = true,
                WorkingDirectory = transactionRoot,
            });
            if (process == null) throw new InvalidOperationException("Updater helper could not be started.");
        }
    }
}
