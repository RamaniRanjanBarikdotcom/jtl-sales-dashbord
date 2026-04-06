using System;
using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using JtlSyncEngine.Models;
using Newtonsoft.Json;
using Newtonsoft.Json.Serialization;

namespace JtlSyncEngine.Services
{
    public class ApiClient
    {
        private readonly ConfigService _config;
        private readonly LogService _log;

        // One HttpClient per instance — reused across all calls (best practice).
        // Timeout is set per-request via CancellationTokenSource, not here, so
        // we set an outer safety limit of 5 minutes max.
        private readonly HttpClient _httpClient = new HttpClient
        {
            Timeout = TimeSpan.FromMinutes(5)
        };

        private static readonly JsonSerializerSettings SerializerSettings = new()
        {
            ContractResolver = new CamelCasePropertyNamesContractResolver(),
            DateTimeZoneHandling = DateTimeZoneHandling.Utc,
            NullValueHandling = NullValueHandling.Ignore
        };

        // Retry delays: 2s, 5s, 15s — exponential-ish, covers transient network blips
        private static readonly int[] RetryDelaysSeconds = { 2, 5, 15 };

        public ApiClient(ConfigService config, LogService log)
        {
            _config = config;
            _log = log;
        }

        private void ConfigureHeaders()
        {
            _httpClient.DefaultRequestHeaders.Clear();
            _httpClient.DefaultRequestHeaders.Authorization =
                new AuthenticationHeaderValue("Bearer", _config.Secrets.ApiKey);
            _httpClient.DefaultRequestHeaders.Accept.Clear();
            _httpClient.DefaultRequestHeaders.Accept.Add(
                new MediaTypeWithQualityHeaderValue("application/json"));
        }

        // ─────────────────────────────────────────────────────────────────────
        // SendBatchAsync
        //
        // Sends one chunk to the backend with per-attempt timeout + exponential
        // retry. 4xx errors are NOT retried (bad request won't fix itself).
        // Failed batches are saved to disk so they can be replayed later.
        // ─────────────────────────────────────────────────────────────────────
        public async Task<IngestBatchResult> SendBatchAsync(
            IngestBatch batch, CancellationToken ct = default)
        {
            ConfigureHeaders();
            var url     = $"{_config.Settings.BackendApiUrl.TrimEnd('/')}/api/sync/ingest";
            var json    = JsonConvert.SerializeObject(batch, SerializerSettings);
            var timeoutSec = Math.Max(30, _config.Settings.HttpTimeoutSeconds);

            // Estimate payload size for logging
            var payloadKb = Encoding.UTF8.GetByteCount(json) / 1024;
            _log.Debug("ApiClient",
                $"[{batch.Module}] Batch {batch.BatchIndex + 1}/{batch.TotalBatches} " +
                $"— {batch.Rows.Count} rows, ~{payloadKb} KB");

            Exception? lastEx = null;

            for (int attempt = 0; attempt <= RetryDelaysSeconds.Length; attempt++)
            {
                // Fresh StringContent each attempt (HttpClient reads it as a stream)
                var content = new StringContent(json, Encoding.UTF8, "application/json");

                // Per-attempt timeout: configured value, doubles on each retry
                var perAttemptTimeout = TimeSpan.FromSeconds(timeoutSec * (attempt + 1));
                using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
                cts.CancelAfter(perAttemptTimeout);

                try
                {
                    var response = await _httpClient.PostAsync(url, content, cts.Token);

                    if (response.IsSuccessStatusCode)
                    {
                        var body = await response.Content.ReadAsStringAsync(cts.Token);
                        var result = JsonConvert.DeserializeObject<IngestBatchResult>(body)
                                     ?? new IngestBatchResult { Success = true };
                        result.Success = true;
                        _log.Debug("ApiClient",
                            $"[{batch.Module}] Batch {batch.BatchIndex + 1} accepted " +
                            $"({result.RowsAccepted} rows written)");
                        return result;
                    }

                    var errorBody = await response.Content.ReadAsStringAsync(cts.Token);
                    var statusCode = (int)response.StatusCode;

                    // 413 = payload too large — treat as retryable server-side issue
                    // (backend limit may have just been raised; retry will succeed)
                    // All other 4xx = client error — no point retrying
                    if (statusCode >= 400 && statusCode < 500 && statusCode != 413)
                    {
                        _log.Error("ApiClient",
                            $"[{batch.Module}] Batch {batch.BatchIndex + 1} rejected " +
                            $"(HTTP {statusCode}, not retrying): {errorBody}");
                        await SaveFailedBatchAsync(batch);
                        return new IngestBatchResult
                        {
                            Success      = false,
                            ErrorMessage = $"HTTP {statusCode}: {errorBody}"
                        };
                    }

                    // 5xx = server error — retry
                    lastEx = new HttpRequestException($"HTTP {statusCode}: {errorBody}");
                    _log.Warn("ApiClient",
                        $"[{batch.Module}] Batch {batch.BatchIndex + 1} server error " +
                        $"(HTTP {statusCode}), attempt {attempt + 1}/{RetryDelaysSeconds.Length + 1}");
                }
                catch (OperationCanceledException) when (ct.IsCancellationRequested)
                {
                    // Outer cancellation (user stopped sync) — don't retry
                    throw;
                }
                catch (OperationCanceledException)
                {
                    // Per-attempt timeout expired — retry with longer timeout
                    lastEx = new TimeoutException(
                        $"Batch timed out after {perAttemptTimeout.TotalSeconds}s");
                    _log.Warn("ApiClient",
                        $"[{batch.Module}] Batch {batch.BatchIndex + 1} timed out " +
                        $"after {perAttemptTimeout.TotalSeconds}s, attempt {attempt + 1}");
                }
                catch (Exception ex) when (!ct.IsCancellationRequested)
                {
                    lastEx = ex;
                    _log.Warn("ApiClient",
                        $"[{batch.Module}] Batch {batch.BatchIndex + 1} network error " +
                        $"(attempt {attempt + 1}): {ex.Message}");
                }

                // Wait before retrying (skip wait after last attempt)
                if (attempt < RetryDelaysSeconds.Length && !ct.IsCancellationRequested)
                {
                    var delay = RetryDelaysSeconds[attempt];
                    _log.Info("ApiClient", $"[{batch.Module}] Retrying in {delay}s...");
                    await Task.Delay(TimeSpan.FromSeconds(delay), ct);
                }
            }

            // All attempts failed — save to disk for later replay
            _log.Error("ApiClient",
                $"[{batch.Module}] Batch {batch.BatchIndex + 1} failed after " +
                $"{RetryDelaysSeconds.Length + 1} attempts: {lastEx?.Message}");
            await SaveFailedBatchAsync(batch);

            return new IngestBatchResult
            {
                Success      = false,
                ErrorMessage = lastEx?.Message ?? "Unknown error"
            };
        }

        // ─────────────────────────────────────────────────────────────────────
        // SaveFailedBatchAsync — persists a failed batch to disk as JSON
        // so it can be replayed manually or on next startup.
        // ─────────────────────────────────────────────────────────────────────
        private async Task SaveFailedBatchAsync(IngestBatch batch)
        {
            try
            {
                var dir = Path.Combine(ConfigService.AppDataDirectory, "failed-batches");
                Directory.CreateDirectory(dir);
                var filename = $"{batch.Module}_{DateTime.UtcNow:yyyyMMddHHmmss}_b{batch.BatchIndex}.json";
                var path = Path.Combine(dir, filename);
                var json = JsonConvert.SerializeObject(batch, Formatting.Indented, SerializerSettings);
                await File.WriteAllTextAsync(path, json);
                _log.Warn("ApiClient", $"Failed batch saved for replay: {path}");
            }
            catch (Exception ex)
            {
                _log.Error("ApiClient", "Could not save failed batch to disk", ex);
            }
        }

        public async Task<bool> TestConnectionAsync(CancellationToken ct = default)
        {
            if (string.IsNullOrWhiteSpace(_config.Settings.BackendApiUrl))
                return false;

            try
            {
                ConfigureHeaders();
                var url = $"{_config.Settings.BackendApiUrl.TrimEnd('/')}/api/health";
                using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
                cts.CancelAfter(TimeSpan.FromSeconds(10));
                var response = await _httpClient.GetAsync(url, cts.Token);
                return response.IsSuccessStatusCode;
            }
            catch (Exception ex)
            {
                _log.Warn("ApiClient", $"API connection test failed: {ex.Message}");
                return false;
            }
        }
    }
}
