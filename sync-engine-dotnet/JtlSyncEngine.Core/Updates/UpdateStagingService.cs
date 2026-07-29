using System.IO.Compression;
using Newtonsoft.Json;
using JtlSyncEngine.Runtime;

namespace JtlSyncEngine.Updates
{
    public sealed class UpdateStagingService
    {
        private readonly AuthenticodeVerifier _authenticode;

        public UpdateStagingService(AuthenticodeVerifier authenticode)
        {
            _authenticode = authenticode;
        }

        public async Task<string> StageAsync(
            string packagePath,
            string transactionId,
            ReleaseEnvelope release,
            string hostMode,
            CancellationToken cancellationToken)
        {
            RuntimePaths.EnsureCurrentLayout();
            var transactionRoot = TrustedChild(RuntimePaths.UpdateStaging, transactionId);
            if (Directory.Exists(transactionRoot)) Directory.Delete(transactionRoot, true);
            Directory.CreateDirectory(transactionRoot);
            var payloadRoot = Path.Combine(transactionRoot, "payload");
            Directory.CreateDirectory(payloadRoot);

            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            long expanded = 0;
            var maximumExpanded = Math.Min(
                Math.Max(release.Manifest.PackageSize * 8, 100 * 1024 * 1024),
                2L * 1024 * 1024 * 1024);
            using var archive = ZipFile.OpenRead(packagePath);
            foreach (var entry in archive.Entries)
            {
                cancellationToken.ThrowIfCancellationRequested();
                var normalized = entry.FullName.Replace('\\', '/');
                if (string.IsNullOrWhiteSpace(normalized) || normalized.EndsWith('/')) continue;
                if (!normalized.StartsWith("payload/", StringComparison.Ordinal) ||
                    normalized.Contains("../", StringComparison.Ordinal) ||
                    normalized.StartsWith("/", StringComparison.Ordinal) ||
                    Path.IsPathRooted(normalized))
                    throw new InvalidDataException($"Unexpected archive entry: {entry.FullName}");
                if (((entry.ExternalAttributes >> 16) & 0xF000) == 0xA000)
                    throw new InvalidDataException("Symbolic links are not allowed in update packages.");
                if (!seen.Add(normalized))
                    throw new InvalidDataException($"Duplicate archive entry: {entry.FullName}");
                expanded += entry.Length;
                if (expanded > maximumExpanded)
                    throw new InvalidDataException("Expanded update package exceeds its safety limit.");
                var relative = normalized["payload/".Length..];
                ValidatePayloadFile(relative);
                var destination = TrustedChild(payloadRoot, relative);
                Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
                await using var source = entry.Open();
                await using var target = new FileStream(
                    destination,FileMode.CreateNew,FileAccess.Write,FileShare.None,
                    1024 * 1024,FileOptions.Asynchronous | FileOptions.WriteThrough);
                await source.CopyToAsync(target,cancellationToken);
            }

            var versionFile = Path.Combine(payloadRoot, "version.json");
            if (!File.Exists(versionFile)) throw new InvalidDataException("Update package version.json is missing.");
            var identity = JsonConvert.DeserializeObject<UpdatePayloadIdentity>(
                await File.ReadAllTextAsync(versionFile,cancellationToken))
                ?? throw new InvalidDataException("Update package version identity is invalid.");
            if (identity.ApplicationId != "JtlSyncEngine" ||
                identity.Version != release.Manifest.Version ||
                !string.Equals(identity.GitSha,release.Manifest.GitSha,StringComparison.OrdinalIgnoreCase) ||
                !string.Equals(identity.Architecture,"win-x64",StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("Update package identity does not match the signed manifest.");

            var required = string.Equals(hostMode,"portable",StringComparison.OrdinalIgnoreCase)
                ? new[] { "JtlSyncEngine.exe","JtlSyncEngine.Updater.exe" }
                : new[] { "JtlSyncEngine.Service.exe","JtlSyncEngine.Updater.exe" };
            foreach (var file in required)
                if (!File.Exists(Path.Combine(payloadRoot,file)))
                    throw new InvalidDataException($"Required update binary is missing: {file}");

            foreach (var file in Directory.EnumerateFiles(payloadRoot,"JtlSyncEngine*.exe",SearchOption.AllDirectories)
                .Concat(Directory.EnumerateFiles(payloadRoot,"JtlSyncEngine*.dll",SearchOption.AllDirectories)))
                _authenticode.Verify(file,release.Manifest.PublisherCertificateThumbprints);

            await File.WriteAllTextAsync(
                Path.Combine(transactionRoot,"manifest.json"),
                CanonicalJson.Serialize(release.Manifest),cancellationToken);
            await File.WriteAllTextAsync(
                Path.Combine(transactionRoot,"manifest.sig"),release.Signature,cancellationToken);
            return payloadRoot;
        }

        public static void ValidatePayloadFile(string relative)
        {
            var normalized = relative.Replace('\\', '/');
            var fileName = Path.GetFileName(normalized);
            var extension = Path.GetExtension(fileName);
            if (string.Equals(extension,".exe",StringComparison.OrdinalIgnoreCase) &&
                fileName is not (
                    "JtlSyncEngine.exe" or
                    "JtlSyncEngine.Service.exe" or
                    "JtlSyncEngine.Updater.exe"))
                throw new InvalidDataException($"Unexpected executable in update payload: {relative}");
            if (!new[] { ".exe",".dll",".json",".pem",".txt" }.Contains(
                    extension,StringComparer.OrdinalIgnoreCase))
                throw new InvalidDataException($"Unsupported update payload file type: {relative}");
            if (string.Equals(extension,".pem",StringComparison.OrdinalIgnoreCase) &&
                !string.Equals(fileName,"manifest-public-key.pem",StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException($"Unexpected certificate file in update payload: {relative}");
            if (string.Equals(extension,".txt",StringComparison.OrdinalIgnoreCase) &&
                !string.Equals(fileName,"README-PORTABLE.txt",StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException($"Unexpected text file in update payload: {relative}");
        }

        public static string TrustedChild(string root,string relative)
        {
            var trustedRoot = Path.GetFullPath(root);
            var candidate = Path.GetFullPath(Path.Combine(trustedRoot,relative));
            if (!candidate.StartsWith(
                trustedRoot.EndsWith(Path.DirectorySeparatorChar) ? trustedRoot : trustedRoot + Path.DirectorySeparatorChar,
                StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("Update path escapes its trusted root.");
            return candidate;
        }

        private sealed class UpdatePayloadIdentity
        {
            public string ApplicationId { get; set; } = "";
            public string Version { get; set; } = "";
            public string GitSha { get; set; } = "";
            public string Architecture { get; set; } = "";
        }
    }
}
