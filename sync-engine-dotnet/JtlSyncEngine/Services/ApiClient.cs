using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using JtlSyncEngine.Models;
using Newtonsoft.Json;
using Newtonsoft.Json.Serialization;
using Newtonsoft.Json.Linq;

namespace JtlSyncEngine.Services
{
    public class ApiClient
    {
        private readonly ConfigService _config;
        private readonly LogService _log;

        // One HttpClient per instance — reused across all calls (best practice).
        // Timeout is set per-request via CancellationTokenSource, not here.
        // Outer limit must exceed the max per-attempt timeout (180s * 4 retries = 720s = 12 min)
        // so the global timeout never kills a retry in progress.
        private readonly HttpClient _httpClient = new HttpClient
        {
            Timeout = TimeSpan.FromMinutes(15)
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
            _httpClient.DefaultRequestHeaders.Add("x-api-version", "1");
            _httpClient.DefaultRequestHeaders.Add("x-tenant-id", _config.Settings.TenantId.Trim());
            // Bypass ngrok browser-warning interstitial (ERR_NGROK_6024) for non-browser clients
            _httpClient.DefaultRequestHeaders.Add("ngrok-skip-browser-warning", "1");
        }

        private static T? DeserializeBackendResponse<T>(string body)
        {
            if (string.IsNullOrWhiteSpace(body)) return default;

            var token = JToken.Parse(body);
            if (token.Type == JTokenType.Object && token["data"] is { } dataToken)
            {
                return dataToken.ToObject<T>(JsonSerializer.Create(SerializerSettings));
            }

            return token.ToObject<T>(JsonSerializer.Create(SerializerSettings));
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
            var rawJsonBytes = Encoding.UTF8.GetBytes(json);
            var timeoutSec = Math.Max(30, _config.Settings.HttpTimeoutSeconds);

            // Estimate payload size for logging
            var payloadKb = rawJsonBytes.Length / 1024;
            _log.Debug("ApiClient",
                $"[{batch.Module}] Batch {batch.BatchIndex + 1}/{batch.TotalBatches} " +
                $"— {batch.Rows.Count} rows, ~{payloadKb} KB");

            Exception? lastEx = null;

            for (int attempt = 0; attempt <= RetryDelaysSeconds.Length; attempt++)
            {
                // Fresh compressed content each attempt (HttpClient reads it as a stream)
                var content = CreateGzipJsonContent(rawJsonBytes);

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
                        var result = DeserializeBackendResponse<IngestBatchResult>(body)
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

                    if (statusCode == 503 && attempt < RetryDelaysSeconds.Length)
                    {
                        var retryAfter = GetRetryAfterDelay(response) ?? TimeSpan.FromSeconds(RetryDelaysSeconds[attempt]);
                        lastEx = new HttpRequestException($"HTTP {statusCode}: {errorBody}");
                        _log.Warn("ApiClient",
                            $"[{batch.Module}] Backend is busy for batch {batch.BatchIndex + 1}; " +
                            $"retrying after {retryAfter.TotalSeconds:0}s");
                        await Task.Delay(retryAfter, ct);
                        continue;
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

        private static ByteArrayContent CreateGzipJsonContent(byte[] rawJsonBytes)
        {
            using var compressed = new MemoryStream();
            using (var gzip = new GZipStream(compressed, CompressionLevel.Fastest, leaveOpen: true))
            {
                gzip.Write(rawJsonBytes, 0, rawJsonBytes.Length);
            }
            var content = new ByteArrayContent(compressed.ToArray());
            content.Headers.ContentType = new MediaTypeHeaderValue("application/json");
            content.Headers.ContentEncoding.Add("gzip");
            return content;
        }

        private static TimeSpan? GetRetryAfterDelay(HttpResponseMessage response)
        {
            if (response.Headers.RetryAfter?.Delta is { } delta && delta > TimeSpan.Zero)
                return delta;

            if (response.Headers.RetryAfter?.Date is { } date)
            {
                var delay = date - DateTimeOffset.UtcNow;
                if (delay > TimeSpan.Zero) return delay;
            }

            return null;
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

        // ─────────────────────────────────────────────────────────────────────
        // PollTriggersAsync — checks backend for pending manual sync triggers
        // ─────────────────────────────────────────────────────────────────────
        public async Task<List<SyncTriggerInfo>> PollTriggersAsync(CancellationToken ct = default)
        {
            try
            {
                ConfigureHeaders();
                var url = $"{_config.Settings.BackendApiUrl.TrimEnd('/')}/api/sync/engine/triggers";
                using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
                cts.CancelAfter(TimeSpan.FromSeconds(10));
                var response = await _httpClient.GetAsync(url, cts.Token);
                if (!response.IsSuccessStatusCode) return new List<SyncTriggerInfo>();

                var body = await response.Content.ReadAsStringAsync(cts.Token);
                var result = DeserializeBackendResponse<TriggerPollResult>(body);
                if (result?.Triggers is { Count: > 0 }) return result.Triggers;
                return result?.Data ?? new List<SyncTriggerInfo>();
            }
            catch (Exception ex)
            {
                _log.Debug("ApiClient", $"Trigger poll failed (non-fatal): {ex.Message}");
                return new List<SyncTriggerInfo>();
            }
        }

        public async Task SendHeartbeatAsync(HeartbeatRequest request, CancellationToken ct = default)
        {
            try
            {
                ConfigureHeaders();
                var url = $"{_config.Settings.BackendApiUrl.TrimEnd('/')}/api/sync/engine/heartbeat";
                var json = JsonConvert.SerializeObject(request, SerializerSettings);
                var content = new StringContent(json, Encoding.UTF8, "application/json");
                using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
                cts.CancelAfter(TimeSpan.FromSeconds(10));
                await _httpClient.PostAsync(url, content, cts.Token);
            }
            catch (Exception ex)
            {
                _log.Debug("ApiClient", $"Heartbeat failed (non-fatal): {ex.Message}");
            }
        }

        public async Task<ClaimTriggerResponse> ClaimTriggerAsync(string triggerId, string machineId, CancellationToken ct = default)
        {
            try
            {
                ConfigureHeaders();
                var url = $"{_config.Settings.BackendApiUrl.TrimEnd('/')}/api/sync/engine/triggers/{triggerId}/claim";
                var json = JsonConvert.SerializeObject(new { machineId }, SerializerSettings);
                var content = new StringContent(json, Encoding.UTF8, "application/json");
                using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
                cts.CancelAfter(TimeSpan.FromSeconds(10));
                var response = await _httpClient.PostAsync(url, content, cts.Token);
                var body = await response.Content.ReadAsStringAsync(cts.Token);
                if (!response.IsSuccessStatusCode)
                    return new ClaimTriggerResponse { Claimed = false, Reason = $"HTTP {(int)response.StatusCode}: {body}" };
                return DeserializeBackendResponse<ClaimTriggerResponse>(body)
                       ?? new ClaimTriggerResponse { Claimed = false, Reason = "Empty claim response" };
            }
            catch (Exception ex)
            {
                _log.Debug("ApiClient", $"Failed to claim trigger {triggerId}: {ex.Message}");
                return new ClaimTriggerResponse { Claimed = false, Reason = ex.Message };
            }
        }

        public async Task UpdateTriggerStatusAsync(string triggerId, TriggerStatusUpdate update, CancellationToken ct = default)
        {
            try
            {
                ConfigureHeaders();
                var url = $"{_config.Settings.BackendApiUrl.TrimEnd('/')}/api/sync/engine/triggers/{triggerId}/status";
                var json = JsonConvert.SerializeObject(update, SerializerSettings);
                var content = new StringContent(json, Encoding.UTF8, "application/json");
                using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
                cts.CancelAfter(TimeSpan.FromSeconds(10));
                await _httpClient.PatchAsync(url, content, cts.Token);
            }
            catch (Exception ex)
            {
                _log.Debug("ApiClient", $"Failed to update trigger {triggerId}: {ex.Message}");
            }
        }

        public Task UpdateTriggerStatusAsync(string triggerId, string status, string? resultMessage = null, CancellationToken ct = default)
        {
            var mapped = status == "done" ? "completed" : status;
            return UpdateTriggerStatusAsync(triggerId, new TriggerStatusUpdate
            {
                Status = mapped,
                Message = resultMessage ?? "",
                ErrorMessage = mapped == "failed" ? resultMessage ?? "" : ""
            }, ct);
        }

        public async Task<bool> TestConnectionAsync(CancellationToken ct = default)
        {
            if (string.IsNullOrWhiteSpace(_config.Settings.BackendApiUrl))
                return false;

            try
            {
                ConfigureHeaders();
                // Use an authenticated endpoint so "API connected" means sync auth is valid,
                // not just that /health is reachable.
                var url = $"{_config.Settings.BackendApiUrl.TrimEnd('/')}/api/sync/engine/triggers";
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
