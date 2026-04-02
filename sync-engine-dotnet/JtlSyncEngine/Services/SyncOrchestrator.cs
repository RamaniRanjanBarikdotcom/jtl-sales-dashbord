using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using JtlSyncEngine.JtlModels;
using JtlSyncEngine.Models;

namespace JtlSyncEngine.Services
{
    public class SyncOrchestrator
    {
        private readonly ConfigService _config;
        private readonly MssqlService _mssql;
        private readonly ApiClient _apiClient;
        private readonly WatermarkService _watermarks;
        private readonly LogService _log;

#pragma warning disable CS0067
        public event Action<string, SyncModuleStatus>? StatusUpdated;
#pragma warning restore CS0067

        public SyncOrchestrator(
            ConfigService config,
            MssqlService mssql,
            ApiClient apiClient,
            WatermarkService watermarks,
            LogService log)
        {
            _config    = config;
            _mssql     = mssql;
            _apiClient = apiClient;
            _watermarks = watermarks;
            _log       = log;
        }

        // ─────────────────────────────────────────────────────────────────────
        // ORDERS — SQL-side pagination (OFFSET/FETCH), rows never all in RAM
        // ─────────────────────────────────────────────────────────────────────
        public async Task SyncOrdersAsync(SyncModuleStatus status, CancellationToken ct = default)
        {
            const string module = "orders";
            await RunPaginatedSyncAsync(
                module, status, ct,
                getCount: (last, end, token) => _mssql.GetOrdersCountAsync(last, end, token),
                getPage:  async (last, end, offset, size, token) =>
                {
                    var orders = await _mssql.GetOrdersPageAsync(last, end, offset, size, token);
                    if (orders.Count == 0) return new List<object>();

                    // Enrich each order with its line items
                    var ids = orders.Select(o => o.KAuftrag).ToList();
                    var items = await _mssql.GetOrderItemsAsync(ids, token);
                    var byOrder = items.GroupBy(i => i.KAuftrag)
                                       .ToDictionary(g => g.Key, g => g.ToList());
                    foreach (var o in orders)
                        o.Items = byOrder.TryGetValue(o.KAuftrag, out var li)
                            ? li : new List<JtlOrderItem>();

                    return orders.Cast<object>().ToList();
                },
                useSyncWindow: true
            );
        }

        // ─────────────────────────────────────────────────────────────────────
        // PRODUCTS — SQL-side pagination, never loads all products into RAM
        // ─────────────────────────────────────────────────────────────────────
        public async Task SyncProductsAsync(SyncModuleStatus status, CancellationToken ct = default)
        {
            const string module = "products";
            await RunPaginatedSyncAsync(
                module, status, ct,
                getCount: (last, _, token) => _mssql.GetProductsCountAsync(last, token),
                getPage:  async (last, _, offset, size, token) =>
                {
                    var page = await _mssql.GetProductsPageAsync(last, offset, size, token);
                    return page.Cast<object>().ToList();
                },
                useSyncWindow: false
            );
        }

        // ─────────────────────────────────────────────────────────────────────
        // CUSTOMERS — SQL-side pagination
        // ─────────────────────────────────────────────────────────────────────
        public async Task SyncCustomersAsync(SyncModuleStatus status, CancellationToken ct = default)
        {
            const string module = "customers";
            await RunPaginatedSyncAsync(
                module, status, ct,
                getCount: (last, _, token) => _mssql.GetCustomersCountAsync(last, token),
                getPage:  async (last, _, offset, size, token) =>
                {
                    var page = await _mssql.GetCustomersPageAsync(last, offset, size, token);
                    return page.Cast<object>().ToList();
                },
                useSyncWindow: false
            );
        }

        // ─────────────────────────────────────────────────────────────────────
        // INVENTORY — SQL-side pagination, full snapshot each run
        // ─────────────────────────────────────────────────────────────────────
        public async Task SyncInventoryAsync(SyncModuleStatus status, CancellationToken ct = default)
        {
            const string module = "inventory";
            await RunPaginatedSyncAsync(
                module, status, ct,
                getCount: (_, __, token) => _mssql.GetInventoryCountAsync(token),
                getPage:  async (_, __, offset, size, token) =>
                {
                    var page = await _mssql.GetInventoryPageAsync(offset, size, token);
                    return page.Cast<object>().ToList();
                },
                useSyncWindow: false
            );
        }

        // ─────────────────────────────────────────────────────────────────────
        // Core paginated sync loop — shared by all 4 modules.
        //
        // Design principles:
        //  • SQL-side pagination: only one batch of rows in memory at a time.
        //    For 100,000 products with batchSize=50, only 50 rows are ever in RAM.
        //  • Watermark only advances when ALL batches succeed.
        //    If batch 3 of 10 fails, watermark stays at lastSyncTime so the entire
        //    sync retries next run — no data loss.
        //  • Per-batch retry is handled inside ApiClient (3 attempts with backoff).
        //    SyncOrchestrator treats a failed batch as a hard error and stops.
        //  • BatchDelayMs pause between batches prevents flooding the backend.
        // ─────────────────────────────────────────────────────────────────────
        private async Task RunPaginatedSyncAsync(
            string module,
            SyncModuleStatus status,
            CancellationToken ct,
            Func<DateTime, DateTime, CancellationToken, Task<int>> getCount,
            Func<DateTime, DateTime, int, int, CancellationToken, Task<List<object>>> getPage,
            bool useSyncWindow)
        {
            status.IsRunning = true;
            status.Status = SyncStatus.Running;
            status.StatusMessage = $"Starting {module} sync...";

            try
            {
                var lastSyncTime  = _watermarks.GetLastSyncTime(module);
                var syncEndTime   = DateTime.UtcNow;
                var batchSize     = _config.Settings.BatchSize;
                var tenantId      = _config.Settings.TenantId;
                var syncStartTime = DateTime.UtcNow;

                _log.Info(module, $"Starting sync from {lastSyncTime:yyyy-MM-ddTHH:mm:ssZ}");

                // Count rows to know total batches upfront
                int totalCount = await getCount(lastSyncTime, syncEndTime, ct);

                if (totalCount == 0)
                {
                    status.Status = SyncStatus.Ok;
                    status.StatusMessage = $"No new {module}";
                    status.LastSyncTime = DateTime.UtcNow;
                    _log.Info(module, $"No new {module} to sync");
                    return;
                }

                int totalBatches = (int)Math.Ceiling((double)totalCount / batchSize);
                status.TotalBatches = totalBatches;
                _log.Info(module, $"Found {totalCount} rows → {totalBatches} batches of {batchSize}");

                long totalRowsSynced = 0;
                int  failedBatches   = 0;
                int  offset          = 0;

                for (int batchIndex = 0; batchIndex < totalBatches && !ct.IsCancellationRequested; batchIndex++)
                {
                    status.CurrentBatch   = batchIndex + 1;
                    status.StatusMessage  = $"Syncing batch {batchIndex + 1}/{totalBatches} ({totalRowsSynced}/{totalCount} rows)...";

                    // Fetch exactly one page from SQL Server
                    List<object> rows;
                    try
                    {
                        rows = await getPage(lastSyncTime, syncEndTime, offset, batchSize, ct);
                    }
                    catch (Exception ex)
                    {
                        _log.Error(module, $"SQL fetch failed on batch {batchIndex + 1}: {ex.Message}", ex);
                        failedBatches++;
                        // Stop sync — partial data is worse than no data
                        break;
                    }

                    if (rows.Count == 0) break;

                    var batch = new IngestBatch
                    {
                        Module        = module,
                        TenantId      = tenantId,
                        BatchIndex    = batchIndex,
                        TotalBatches  = totalBatches,
                        SyncStartTime = syncStartTime,
                        WatermarkTime = lastSyncTime,
                        Rows          = rows
                    };

                    // ApiClient handles per-batch retries internally (3 attempts, backoff)
                    var result = await _apiClient.SendBatchAsync(batch, ct);

                    if (!result.Success)
                    {
                        _log.Error(module,
                            $"Batch {batchIndex + 1}/{totalBatches} permanently failed " +
                            $"after retries: {result.ErrorMessage}");
                        failedBatches++;
                        // Stop: don't advance offset or watermark — next sync retries from here
                        break;
                    }

                    totalRowsSynced += rows.Count;
                    offset          += rows.Count;
                    status.RowsSynced = totalRowsSynced;

                    _log.Debug(module,
                        $"Batch {batchIndex + 1}/{totalBatches} done " +
                        $"({rows.Count} rows, {totalRowsSynced}/{totalCount} total)");

                    // Pause between batches so backend has breathing room
                    if (batchIndex < totalBatches - 1 && !ct.IsCancellationRequested)
                        await Task.Delay(_config.Settings.BatchDelayMs, ct);
                }

                // Only advance watermark if ALL batches succeeded
                if (failedBatches == 0 && totalRowsSynced > 0)
                {
                    _watermarks.UpdateWatermark(module, syncEndTime, totalRowsSynced);
                    status.Status = SyncStatus.Ok;
                    status.StatusMessage = $"Synced {totalRowsSynced}/{totalCount} {module}";
                    status.LastSyncTime  = DateTime.UtcNow;
                    _log.Info(module, $"Sync complete: {totalRowsSynced} rows in {totalBatches} batches");
                }
                else if (failedBatches > 0)
                {
                    // Watermark NOT advanced — next scheduled run retries everything
                    status.Status = SyncStatus.Error;
                    status.StatusMessage =
                        $"Sync incomplete: {totalRowsSynced} rows sent, " +
                        $"{failedBatches} batch(es) failed — will retry next run";
                    _log.Warn(module,
                        $"Sync incomplete: {totalRowsSynced}/{totalCount} rows sent, " +
                        $"{failedBatches} failed batch(es). Watermark NOT advanced.");
                }
            }
            catch (OperationCanceledException)
            {
                status.Status = SyncStatus.Warning;
                status.StatusMessage = "Sync cancelled";
                _log.Warn(module, $"{module} sync was cancelled");
            }
            catch (Exception ex)
            {
                status.Status = SyncStatus.Error;
                status.StatusMessage  = $"Error: {ex.Message}";
                status.ErrorMessage   = ex.Message;
                _log.Error(module, $"{module} sync failed", ex);
            }
            finally
            {
                status.IsRunning    = false;
                status.CurrentBatch = 0;
                status.TotalBatches = 0;
            }
        }
    }
}
