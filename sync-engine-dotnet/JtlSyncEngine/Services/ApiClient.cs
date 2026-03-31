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
        private readonly HttpClient _httpClient;
        private static readonly JsonSerializerSettings SerializerSettings = new()
        {
            ContractResolver = new CamelCasePropertyNamesContractResolver(),
            DateTimeZoneHandling = DateTimeZoneHandling.Utc
        };

        public ApiClient(ConfigService config, LogService log)
        {
            _config = config;
            _log = log;
            _httpClient = new HttpClient
            {
                Timeout = TimeSpan.FromSeconds(60)
            };
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

        public async Task<IngestBatchResult> SendBatchAsync(IngestBatch batch, CancellationToken ct = default)
        {
            ConfigureHeaders();
            var url = $"{_config.Settings.BackendApiUrl.TrimEnd('/')}/api/sync/ingest";
            var json = JsonConvert.SerializeObject(batch, SerializerSettings);
            var content = new StringContent(json, Encoding.UTF8, "application/json");

            Exception? lastEx = null;
            for (int attempt = 1; attempt <= 3; attempt++)
            {
                try
                {
                    _log.Debug("ApiClient", $"Sending batch {batch.BatchIndex + 1}/{batch.TotalBatches} for {batch.Module} (attempt {attempt})");
                    var response = await _httpClient.PostAsync(url, content, ct);

                    if (response.IsSuccessStatusCode)
                    {
                        var responseBody = await response.Content.ReadAsStringAsync(ct);
                        var result = JsonConvert.DeserializeObject<IngestBatchResult>(responseBody) ?? new IngestBatchResult { Success = true };
                        result.Success = true;
                        _log.Debug("ApiClient", $"Batch {batch.BatchIndex + 1} accepted: {result.RowsAccepted} rows");
                        return result;
                    }
                    else
                    {
                        var errorBody = await response.Content.ReadAsStringAsync(ct);
                        _log.Warn("ApiClient", $"Batch {batch.BatchIndex + 1} rejected: HTTP {(int)response.StatusCode} - {errorBody}");

                        if ((int)response.StatusCode >= 400 && (int)response.StatusCode < 500)
                        {
                            // Client error: no point retrying
                            return new IngestBatchResult
                            {
                                Success = false,
                                ErrorMessage = $"HTTP {(int)response.StatusCode}: {errorBody}"
                            };
                        }
                        lastEx = new HttpRequestException($"HTTP {(int)response.StatusCode}: {errorBody}");
                    }
                }
                catch (Exception ex) when (!ct.IsCancellationRequested)
                {
                    lastEx = ex;
                    _log.Warn("ApiClient", $"Batch send attempt {attempt} failed: {ex.Message}");
                }

                if (attempt < 3 && !ct.IsCancellationRequested)
                    await Task.Delay(TimeSpan.FromSeconds(attempt * 2), ct);
            }

            // All retries failed — save to disk
            await SaveFailedBatchAsync(batch);

            return new IngestBatchResult
            {
                Success = false,
                ErrorMessage = lastEx?.Message ?? "Unknown error after 3 retries"
            };
        }

        private async Task SaveFailedBatchAsync(IngestBatch batch)
        {
            try
            {
                var dir = Path.Combine(ConfigService.AppDataDirectory, "failed-batches");
                Directory.CreateDirectory(dir);
                var filename = $"{batch.Module}_{DateTime.UtcNow:yyyyMMddHHmmss}_{batch.BatchIndex}.json";
                var path = Path.Combine(dir, filename);
                var json = JsonConvert.SerializeObject(batch, Formatting.Indented, SerializerSettings);
                await File.WriteAllTextAsync(path, json);
                _log.Warn("ApiClient", $"Failed batch saved to disk: {path}");
            }
            catch (Exception ex)
            {
                _log.Error("ApiClient", "Failed to save failed batch to disk", ex);
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
                var response = await _httpClient.GetAsync(url, ct);
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
