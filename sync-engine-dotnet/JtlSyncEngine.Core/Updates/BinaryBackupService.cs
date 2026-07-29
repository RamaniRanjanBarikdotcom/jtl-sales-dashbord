using JtlSyncEngine.Runtime;

namespace JtlSyncEngine.Updates
{
    public sealed class BinaryBackupService
    {
        public async Task<string> BackupAsync(
            string installDirectory,
            string transactionId,
            long requiredBytes,
            CancellationToken cancellationToken)
        {
            var source = Path.GetFullPath(installDirectory);
            if (!Directory.Exists(source)) throw new DirectoryNotFoundException("Install directory is unavailable.");
            var drive = new DriveInfo(Path.GetPathRoot(RuntimePaths.UpdateBackups)!);
            var installedBytes = Directory.EnumerateFiles(source,"*",SearchOption.AllDirectories)
                .Sum(file => new FileInfo(file).Length);
            var safetyBytes = Math.Max(100L * 1024 * 1024,(installedBytes + requiredBytes) / 5);
            if (drive.AvailableFreeSpace < installedBytes + requiredBytes + safetyBytes)
                throw new IOException("Insufficient disk space for update backup and staging.");
            var backup = UpdateStagingService.TrustedChild(RuntimePaths.UpdateBackups,transactionId);
            if (Directory.Exists(backup)) Directory.Delete(backup,true);
            Directory.CreateDirectory(backup);
            foreach (var file in Directory.EnumerateFiles(source,"*",SearchOption.AllDirectories))
            {
                cancellationToken.ThrowIfCancellationRequested();
                var relative = Path.GetRelativePath(source,file);
                var target = UpdateStagingService.TrustedChild(backup,relative);
                Directory.CreateDirectory(Path.GetDirectoryName(target)!);
                await using var input = new FileStream(
                    file,FileMode.Open,FileAccess.Read,FileShare.ReadWrite | FileShare.Delete,
                    1024 * 1024,FileOptions.Asynchronous | FileOptions.SequentialScan);
                await using var output = new FileStream(
                    target,FileMode.CreateNew,FileAccess.Write,FileShare.None,
                    1024 * 1024,FileOptions.Asynchronous | FileOptions.WriteThrough);
                await input.CopyToAsync(output,cancellationToken);
            }
            return backup;
        }

        public void Prune(int keep)
        {
            if (!Directory.Exists(RuntimePaths.UpdateBackups)) return;
            foreach (var directory in new DirectoryInfo(RuntimePaths.UpdateBackups)
                .EnumerateDirectories().OrderByDescending(item => item.CreationTimeUtc).Skip(Math.Clamp(keep,1,5)))
            {
                try { directory.Delete(true); } catch { }
            }
        }
    }
}
