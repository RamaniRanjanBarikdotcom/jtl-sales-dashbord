using JtlSyncEngine.Jobs;
using JtlSyncEngine.Ipc;
using JtlSyncEngine.Runtime;
using JtlSyncEngine.Services;

namespace JtlSyncEngine.Updates
{
    public sealed class UpdateCoordinator : IDisposable
    {
        private readonly ConfigService _config;
        private readonly ApiClient _api;
        private readonly SyncScheduler _scheduler;
        private readonly LogService _log;
        private readonly ReleaseManifestVerifier _manifestVerifier = new();
        private readonly ReleasePackageVerifier _packageVerifier = new();
        private readonly UpdateStagingService _staging = new(new AuthenticodeVerifier());
        private readonly BinaryBackupService _backup = new();
        private readonly UpdateTransactionStore _transactions = new();
        private readonly BadReleaseRegistry _badReleases = new();
        private readonly UpdaterProcessLauncher _launcher = new();
        private readonly ReleasePackageDownloader _downloader;
        private int _working;

        public UpdateCoordinator(
            ConfigService config,ApiClient api,SyncScheduler scheduler,LogService log)
        {
            _config = config;
            _api = api;
            _scheduler = scheduler;
            _log = log;
            _downloader = new ReleasePackageDownloader(config);
        }

        public async Task<bool> PollAsync(CancellationToken cancellationToken)
        {
            var agentId = string.IsNullOrWhiteSpace(_config.Settings.MachineId)
                ? Environment.MachineName
                : _config.Settings.MachineId;
            if (!_config.Settings.Updates.Enabled ||
                !_scheduler.IsSafeUpdateBoundary ||
                Interlocked.CompareExchange(ref _working,1,0) != 0)
                return false;
            AgentUpdateRequest? update = null;
            try
            {
                var claimed = await _api.ClaimUpdateAsync(agentId,cancellationToken);
                update = claimed?.Update;
                if (update == null) return false;
                if (!update.RetryFailed && _badReleases.IsSuppressed(update.ReleaseId))
                    throw new InvalidOperationException("This release is locally suppressed after an earlier failure.");
                _manifestVerifier.Verify(
                    update.Release,_config.Settings.Updates.ManifestPublicKeyPem,BuildIdentity.Version);
                await _api.ReportUpdateProgressAsync(
                    update.Id,agentId,"verifying","Signed manifest verified",
                    "agent_update.manifest_verified",ct: cancellationToken);

                UpdateTransaction transaction;
                if (!_transactions.TryLoad(update.UpdateTransactionId,out var persisted) ||
                    persisted == null ||
                    persisted.ReleaseId != update.ReleaseId ||
                    persisted.State is not ("staged" or "restarting"))
                {
                    await _api.ReportUpdateProgressAsync(
                        update.Id,agentId,"downloading","Downloading signed update package",
                        "agent_update.download_started",ct: cancellationToken);
                    var package = await _downloader.DownloadAsync(
                        update.Release,update.UpdateTransactionId,agentId,cancellationToken);
                    await _api.ReportUpdateProgressAsync(
                        update.Id,agentId,"verifying","Download completed",
                        "agent_update.download_completed",ct: cancellationToken);
                    try
                    {
                        await _packageVerifier.VerifyHashAsync(
                            package,update.Release.Manifest.Sha256,cancellationToken);
                    }
                    catch
                    {
                        await _api.ReportUpdateProgressAsync(
                            update.Id,agentId,"verifying","Package hash verification failed",
                            "agent_update.package_hash_failed",ct: CancellationToken.None);
                        throw;
                    }
                    await _api.ReportUpdateProgressAsync(
                        update.Id,agentId,"verifying","Package hash verified",
                        "agent_update.package_hash_verified",ct: cancellationToken);

                    var payload = await _staging.StageAsync(
                        package,update.UpdateTransactionId,update.Release,cancellationToken);
                    await _api.ReportUpdateProgressAsync(
                        update.Id,agentId,"staged","Package signature and publisher verified",
                        "agent_update.authenticode_verified",ct: cancellationToken);

                    var installDirectory = Path.GetDirectoryName(Environment.ProcessPath)
                        ?? throw new InvalidOperationException("Install directory could not be resolved.");
                    var backup = await _backup.BackupAsync(
                        installDirectory,update.UpdateTransactionId,
                        update.Release.Manifest.PackageSize,cancellationToken);
                    transaction = new UpdateTransaction
                    {
                        TransactionId = update.UpdateTransactionId,
                        UpdateRequestId = update.Id,
                        ReleaseId = update.ReleaseId,
                        AgentId = agentId,
                        InstallDirectory = installDirectory,
                        StagedPayloadDirectory = payload,
                        BackupDirectory = backup,
                        CurrentVersion = BuildIdentity.Version,
                        CurrentGitSha = BuildIdentity.GitSha,
                        TargetVersion = update.Release.Manifest.Version,
                        TargetGitSha = update.Release.Manifest.GitSha,
                        PublisherCertificateThumbprints =
                            update.Release.Manifest.PublisherCertificateThumbprints,
                        ServiceProcessId = Environment.ProcessId,
                        HealthTimeoutSeconds = Math.Clamp(
                            update.Release.Manifest.HealthTimeoutSeconds,30,900),
                        State = "staged",
                    };
                    _transactions.Save(transaction);
                }
                else
                {
                    transaction = persisted;
                }
                if (!MaintenanceWindow.IsAllowedNow(
                        _config.Settings.Updates,update.InstallMode,DateTimeOffset.Now))
                {
                    await _api.ReportUpdateProgressAsync(
                        update.Id,agentId,"waiting_for_window",
                        "Verified update is staged and waiting for the configured maintenance window",
                        "agent_update.waiting_for_window",ct: cancellationToken);
                    return false;
                }
                transaction.State = "restarting";
                transaction.ServiceProcessId = Environment.ProcessId;
                _transactions.Save(transaction);
                await _api.ReportUpdateProgressAsync(
                    update.Id,agentId,"installing","Starting trusted updater helper",
                    "agent_update.install_started",ct: cancellationToken);
                _launcher.Launch(
                    transaction.InstallDirectory,transaction.TransactionId,
                    transaction.PublisherCertificateThumbprints);
                return true;
            }
            catch (Exception exception)
            {
                _log.Error("Updater",$"Update preparation failed: {exception.Message}",exception);
                if (update != null)
                {
                    QuarantineDownload(update.UpdateTransactionId);
                    _badReleases.Record(
                        agentId,update.ReleaseId,update.TargetVersion,"PREPARATION_FAILED",false);
                    try
                    {
                        await _api.FailUpdateAsync(
                            update.Id,agentId,"PREPARATION_FAILED",exception.Message,
                            new { update.UpdateTransactionId },CancellationToken.None);
                    }
                    catch (Exception reportError)
                    {
                        _log.Warn("Updater",$"Update failure report was deferred: {reportError.Message}");
                    }
                }
                return false;
            }
            finally
            {
                Interlocked.Exchange(ref _working,0);
            }
        }

        private static void QuarantineDownload(string transactionId)
        {
            try
            {
                var source = Path.Combine(RuntimePaths.UpdateDownloads,$"{transactionId}.zip");
                if (!File.Exists(source)) return;
                Directory.CreateDirectory(RuntimePaths.UpdateFailed);
                var target = UpdateStagingService.TrustedChild(
                    RuntimePaths.UpdateFailed,$"{transactionId}.zip");
                File.Move(source,target,true);
            }
            catch
            {
            }
        }

        public async Task<bool> RecoverAsync(CancellationToken cancellationToken)
        {
            foreach (var transaction in _transactions.Pending())
            {
                if (transaction.State is "rolled_back" or "rollback_failed")
                {
                    await _api.ReportUpdateRollbackAsync(
                        transaction.UpdateRequestId,transaction.AgentId,
                        transaction.ErrorCode ?? "HEALTH_VERIFICATION_FAILED",
                        transaction.ErrorMessage ?? "Update rolled back",
                        new { transaction.TransactionId,transaction.CurrentVersion },
                        cancellationToken);
                    transaction.State = "rollback_reported";
                    _transactions.Save(transaction);
                    continue;
                }
                if (transaction.TargetVersion != BuildIdentity.Version ||
                    !string.Equals(transaction.TargetGitSha,BuildIdentity.GitSha,StringComparison.OrdinalIgnoreCase))
                {
                    if (transaction.State is "restarting" or "service_stopped" or
                        "files_replaced" or "verifying_health" &&
                        transaction.CurrentVersion == BuildIdentity.Version &&
                        string.Equals(
                            transaction.CurrentGitSha,BuildIdentity.GitSha,
                            StringComparison.OrdinalIgnoreCase) &&
                        _scheduler.IsSafeUpdateBoundary)
                    {
                        transaction.State = "restarting";
                        transaction.ServiceProcessId = Environment.ProcessId;
                        _transactions.Save(transaction);
                        _launcher.Launch(
                            transaction.InstallDirectory,transaction.TransactionId,
                            transaction.PublisherCertificateThumbprints);
                        return true;
                    }
                    continue;
                }
                var configuredAgentId = string.IsNullOrWhiteSpace(_config.Settings.MachineId)
                    ? Environment.MachineName
                    : _config.Settings.MachineId;
                if (!string.Equals(
                        configuredAgentId,transaction.AgentId,StringComparison.OrdinalIgnoreCase))
                    throw new InvalidDataException("Agent identity changed during update verification.");
                var localStatus = await new NamedPipeControlClient().SendAsync(
                    new ServiceControlRequest { Command = "GetServiceVersion" },
                    TimeSpan.FromSeconds(5),cancellationToken);
                if (!localStatus.Success)
                    throw new InvalidOperationException("Named-pipe management health verification failed.");
                transaction.State = "verifying_health";
                _transactions.Save(transaction);
                await _api.ReportUpdateProgressAsync(
                    transaction.UpdateRequestId,transaction.AgentId,"verifying_health",
                    "New service build is reporting health","agent_update.health_verified",
                    ct: cancellationToken);
                await _api.CompleteUpdateAsync(
                    transaction.UpdateRequestId,transaction.AgentId,
                    new { transaction.TransactionId,version = BuildIdentity.Version,gitSha = BuildIdentity.GitSha },
                    cancellationToken);
                transaction.State = "completed";
                _transactions.Save(transaction);
                _backup.Prune(_config.Settings.Updates.KeepBackups);
            }
            return false;
        }

        public void Dispose() => _downloader.Dispose();
    }
}
