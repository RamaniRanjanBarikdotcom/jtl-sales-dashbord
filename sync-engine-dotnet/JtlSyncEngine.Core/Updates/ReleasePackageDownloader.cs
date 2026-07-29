using System.Net;
using System.Net.Http.Headers;
using JtlSyncEngine.Models;
using JtlSyncEngine.Runtime;
using JtlSyncEngine.Services;

namespace JtlSyncEngine.Updates
{
    public sealed class ReleasePackageDownloader : IDisposable
    {
        private readonly ConfigService _config;
        private readonly HttpClient _client;

        public ReleasePackageDownloader(ConfigService config)
        {
            _config = config;
            _client = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false })
            {
                Timeout = Timeout.InfiniteTimeSpan,
            };
        }

        public async Task<string> DownloadAsync(
            ReleaseEnvelope release,
            string transactionId,
            string agentId,
            CancellationToken cancellationToken)
        {
            var delays = new[] { TimeSpan.FromSeconds(2),TimeSpan.FromSeconds(5) };
            for (var attempt = 0;; attempt++)
            {
                try
                {
                    return await DownloadOnceAsync(
                        release,transactionId,agentId,cancellationToken);
                }
                catch (Exception exception) when (
                    attempt < delays.Length &&
                    exception is HttpRequestException or IOException or TaskCanceledException &&
                    !cancellationToken.IsCancellationRequested)
                {
                    await Task.Delay(delays[attempt],cancellationToken);
                }
            }
        }

        private async Task<string> DownloadOnceAsync(
            ReleaseEnvelope release,
            string transactionId,
            string agentId,
            CancellationToken cancellationToken)
        {
            RuntimePaths.EnsureCurrentLayout();
            var manifest = release.Manifest;
            var uri = ResolveTrustedUri(
                $"{manifest.PackagePath}?agentId={Uri.EscapeDataString(agentId)}");
            var partial = Path.Combine(RuntimePaths.UpdateDownloads, $"{transactionId}.zip.partial");
            var completed = Path.Combine(RuntimePaths.UpdateDownloads, $"{transactionId}.zip");
            File.Delete(partial);

            using var request = new HttpRequestMessage(HttpMethod.Get, uri);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _config.Secrets.ApiKey);
            request.Headers.Add("x-tenant-id", _config.Settings.TenantId);
            request.Headers.Add("ngrok-skip-browser-warning", "1");

            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeout.CancelAfter(TimeSpan.FromMinutes(15));
            try
            {
                using var response = await _client.SendAsync(
                    request, HttpCompletionOption.ResponseHeadersRead, timeout.Token);
                if ((int)response.StatusCode is >= 300 and < 400)
                    throw new HttpRequestException("Update download redirect was rejected.");
                response.EnsureSuccessStatusCode();

                var maximum = Math.Min(
                    Math.Max(_config.Settings.Updates.MaximumPackageBytes, 10 * 1024 * 1024),
                    2L * 1024 * 1024 * 1024);
                if (manifest.PackageSize > maximum)
                    throw new InvalidDataException("Signed package exceeds the configured size limit.");
                if (response.Content.Headers.ContentLength is long length &&
                    (length != manifest.PackageSize || length > maximum))
                    throw new InvalidDataException("Update package content length is invalid.");

                await using var source = await response.Content.ReadAsStreamAsync(timeout.Token);
                await using var target = new FileStream(
                    partial, FileMode.CreateNew, FileAccess.Write, FileShare.None,
                    1024 * 1024, FileOptions.Asynchronous | FileOptions.WriteThrough);
                var buffer = new byte[1024 * 1024];
                long written = 0;
                while (true)
                {
                    var read = await source.ReadAsync(buffer, timeout.Token);
                    if (read == 0) break;
                    written += read;
                    if (written > maximum || written > manifest.PackageSize)
                        throw new InvalidDataException("Update package exceeded its signed size.");
                    await target.WriteAsync(buffer.AsMemory(0, read), timeout.Token);
                }
                await target.FlushAsync(timeout.Token);
                if (written != manifest.PackageSize)
                    throw new InvalidDataException("Update package download is incomplete.");
                File.Move(partial, completed, true);
                return completed;
            }
            catch
            {
                File.Delete(partial);
                throw;
            }
        }

        private Uri ResolveTrustedUri(string packagePath)
        {
            return ResolveTrustedUri(
                _config.Settings.BackendApiUrl,
                packagePath,
                _config.Settings.Updates.AllowedReleaseHosts,
                string.Equals(
                    Environment.GetEnvironmentVariable("JTL_SYNC_ALLOW_INSECURE_UPDATE_LOOPBACK"),
                    "true",
                    StringComparison.OrdinalIgnoreCase));
        }

        public static Uri ResolveTrustedUri(
            string backendApiUrl,
            string packagePath,
            IEnumerable<string>? allowedReleaseHosts,
            bool allowInsecureLoopback = false)
        {
            if (!Uri.TryCreate(backendApiUrl, UriKind.Absolute, out var backend))
                throw new InvalidOperationException("Backend API URL is invalid.");
            if (backend.Scheme != Uri.UriSchemeHttps &&
                !(backend.IsLoopback && allowInsecureLoopback))
                throw new InvalidOperationException("Update downloads require HTTPS.");
            var allowed = new HashSet<string>(
                allowedReleaseHosts ?? Array.Empty<string>(),
                StringComparer.OrdinalIgnoreCase)
            {
                backend.Host,
            };
            var uri = new Uri(backend, packagePath);
            if (!allowed.Contains(uri.Host))
                throw new InvalidOperationException("Update release host is not allowlisted.");
            if (uri.Scheme != Uri.UriSchemeHttps && !uri.IsLoopback)
                throw new InvalidOperationException("Update release URL is not HTTPS.");
            return uri;
        }

        public void Dispose() => _client.Dispose();
    }
}
