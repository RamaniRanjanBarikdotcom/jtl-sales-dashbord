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

        private DateTime GetOrdersWindowStart(DateTime lastSyncTime)
        {
            // JTL status changes (cancelled/returned) can happen after creation.
            // Re-scan a rolling lookback window so status updates are not missed.
            var lookbackDays = Math.Max(0, _config.Settings.OrdersStatusLookbackDays);
            if (lookbackDays <= 0) return lastSyncTime;

            var fullSyncStart = new DateTime(2000, 1, 1, 0, 0, 0, DateTimeKind.Utc);
            if (lastSyncTime <= fullSyncStart.AddDays(2)) return lastSyncTime; // initial full sync

            var adjusted = lastSyncTime.AddDays(-lookbackDays);
            return adjusted < fullSyncStart ? fullSyncStart : adjusted;
        }

        // ─────────────────────────────────────────────────────────────────────
        // ORDERS — SQL-side pagination (OFFSET/FETCH), rows never all in RAM
        //
        // Items are fetched PER BATCH (not per-sync) using GetOrderItemsAsync.
        // This is safe because each batch is at most ~200 orders — the items
        // for 200 orders fit easily in RAM. The old crash was caused by fetching
        // items for ALL 20K orders at once into a dictionary. Per-batch is fine.
        //
        // Items are attached to each order as the Items[] array so the backend
        // can populate order_items, compute COGS, margins, and product performance.
        // ItemsSummary (STRING_AGG) is also still populated for quick display.
        // ─────────────────────────────────────────────────────────────────────
        public async Task SyncOrdersAsync(SyncModuleStatus status, CancellationToken ct = default)
        {
            const string module = "orders";
            _log.Info(
                module,
                $"Order status lookback enabled: {_config.Settings.OrdersStatusLookbackDays} day(s)"
            );

            await RunPaginatedSyncAsync(
                module, status, ct,
                getCount: (last, end, token) =>
                    _mssql.GetOrdersCountAsync(GetOrdersWindowStart(last), end, token),
                getPage:  async (last, end, offset, size, token) =>
                {
                    var orders = await _mssql.GetOrdersPageAsync(
                        GetOrdersWindowStart(last),
                        end,
                        offset,
                        size,
                        token
                    );
                    if (orders.Count == 0) return new List<object>();

                    // Fetch items for THIS BATCH ONLY (not all orders) — safe RAM usage
                    var ids   = orders.Select(o => o.KAuftrag).ToList();
                    var items = await _mssql.GetOrderItemsAsync(ids, token);
                    var byOrder = items.GroupBy(i => i.KAuftrag)
                                       .ToDictionary(g => g.Key, g => g.ToList());
                    foreach (var o in orders)
                        o.Items = byOrder.TryGetValue(o.KAuftrag, out var li) ? li : new List<JtlOrderItem>();

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
                getCount: (last, end, token) => _mssql.GetProductsCountAsync(last, end, token),
                getPage:  async (last, end, offset, size, token) =>
                {
                    var page = await _mssql.GetProductsPageAsync(last, end, offset, size, token);
                    return page.Cast<object>().ToList();
                },
                useSyncWindow: true
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
                getCount: (last, end, token) => _mssql.GetCustomersCountAsync(last, end, token),
                getPage:  async (last, end, offset, size, token) =>
                {
                    var page = await _mssql.GetCustomersPageAsync(last, end, offset, size, token);
                    return page.Cast<object>().ToList();
                },
                useSyncWindow: true
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
            status.ErrorMessage = string.Empty;

            try
            {
                var lastSyncTime  = _watermarks.GetLastSyncTime(module);
                var configuredBatchSize = Math.Max(1, _config.Settings.BatchSize);
                // Orders payloads are much heavier (each order carries item rows),
                // so cap default chunk size to reduce timeout/413 risk on large datasets.
                if (module == "orders" && configuredBatchSize > 200)
                {
                    _log.Warn(module,
                        $"BatchSize {configuredBatchSize} is high for orders; capping to 200 for reliability");
                    configuredBatchSize = 200;
                }
                var batchSize = configuredBatchSize;
                var minBatchSize = module == "orders" ? 25 : 50;
                var tenantId      = _config.Settings.TenantId;
                var syncStartTime = DateTime.UtcNow;

                // Check for a checkpoint from a previous failed sync — resume instead of restart
                var (resumeOffset, resumeWindowEnd) = _watermarks.GetCheckpoint(module);
                var isResume = resumeOffset > 0 && resumeWindowEnd > DateTime.MinValue;
                var syncEndTime = isResume ? resumeWindowEnd : DateTime.UtcNow;

                if (isResume)
                    _log.Info(module, $"Resuming sync from checkpoint: offset={resumeOffset}, window={lastSyncTime:yyyy-MM-ddTHH:mm:ssZ} → {syncEndTime:yyyy-MM-ddTHH:mm:ssZ}");
                else
                    _log.Info(module, $"Starting sync from {lastSyncTime:yyyy-MM-ddTHH:mm:ssZ}");

                // Count rows to know total batches upfront
                int totalCount = await getCount(lastSyncTime, syncEndTime, ct);

                if (totalCount == 0)
                {
                    _watermarks.ClearCheckpoint(module);
                    _watermarks.UpdateWatermark(module, syncEndTime, 0);
                    status.Status = SyncStatus.Ok;
                    status.StatusMessage = $"No new {module}";
                    status.ErrorMessage = string.Empty;
                    status.LastSyncTime = DateTime.UtcNow;
                    _log.Info(module, $"No new {module} to sync");
                    return;
                }

                // When resuming, skip batches we already sent successfully
                int startOffset   = isResume ? resumeOffset : 0;
                if (startOffset >= totalCount)
                {
                    _log.Warn(module,
                        $"Checkpoint offset {startOffset} is beyond row count {totalCount}; clearing checkpoint and restarting window");
                    _watermarks.ClearCheckpoint(module);
                    startOffset = 0;
                    isResume = false;
                }

                var initialTotalBatches = (int)Math.Ceiling((double)totalCount / batchSize);
                status.TotalBatches = initialTotalBatches;

                if (isResume)
                    _log.Info(module, $"Found {totalCount} rows → {initialTotalBatches} batches (chunk {batchSize}), resuming from offset {startOffset}");
                else
                    _log.Info(module, $"Found {totalCount} rows → {initialTotalBatches} batches of {batchSize}");

                long totalRowsSynced = 0;
                int  failedBatches   = 0;
                int  offset          = startOffset;
                int  sentBatches     = 0;
                string? lastBatchError = null;

                while (offset < totalCount && !ct.IsCancellationRequested)
                {
                    var totalBatches = (int)Math.Ceiling((double)totalCount / Math.Max(batchSize, 1));
                    var batchIndex = offset / Math.Max(batchSize, 1);

                    status.TotalBatches  = totalBatches;
                    status.CurrentBatch   = batchIndex + 1;
                    status.StatusMessage  =
                        $"Syncing batch {batchIndex + 1}/{totalBatches} ({offset}/{totalCount} rows, chunk {batchSize})...";

                    // Fetch exactly one page from SQL Server
                    List<object> rows;
                    try
                    {
                        rows = await getPage(lastSyncTime, syncEndTime, offset, batchSize, ct);
                    }
                    catch (Exception ex)
                    {
                        _log.Error(module, $"SQL fetch failed on batch {batchIndex + 1}: {ex.Message}", ex);
                        lastBatchError = $"SQL fetch failed: {ex.Message}";
                        failedBatches++;
                        _watermarks.SaveCheckpoint(module, offset, syncEndTime);
                        _log.Info(module, $"Checkpoint saved at offset {offset} — next sync will resume here");
                        break;
                    }

                    if (rows.Count == 0)
                    {
                        _log.Warn(module,
                            $"Fetched 0 rows at offset {offset}/{totalCount}. Treating as end-of-window.");
                        break;
                    }

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
                        // Retryable transport/size failures: shrink chunk and retry same offset.
                        var canDownshift =
                            batchSize > minBatchSize &&
                            IsChunkSizeRetryableError(result.ErrorMessage);
                        if (canDownshift)
                        {
                            var newBatchSize = Math.Max(minBatchSize, batchSize / 2);
                            if (newBatchSize < batchSize)
                            {
                                _log.Warn(module,
                                    $"Batch {batchIndex + 1} failed ({result.ErrorMessage}). " +
                                    $"Reducing chunk {batchSize} -> {newBatchSize} and retrying offset {offset}.");
                                batchSize = newBatchSize;
                                continue;
                            }
                        }

                        _log.Error(module,
                            $"Batch {batchIndex + 1}/{totalBatches} permanently failed " +
                            $"after retries: {result.ErrorMessage}");
                        lastBatchError = result.ErrorMessage;
                        failedBatches++;
                        // Save checkpoint so next run resumes from HERE, not from offset 0
                        _watermarks.SaveCheckpoint(module, offset, syncEndTime);
                        _log.Info(module, $"Checkpoint saved at offset {offset} — next sync will resume here");
                        break;
                    }

                    totalRowsSynced += rows.Count;
                    offset          += rows.Count;
                    sentBatches++;
                    status.RowsSynced = totalRowsSynced + (isResume ? startOffset : 0);

                    _log.Debug(module,
                        $"Batch {batchIndex + 1}/{totalBatches} done " +
                        $"({rows.Count} rows, {offset}/{totalCount} total)");

                    // Release references so GC can reclaim memory before next batch fetch.
                    // Critical for large syncs (35K+ products, 20K+ orders) — without this,
                    // serialized JSON strings and row objects accumulate and cause OOM.
                    batch.Rows = null!;
                    rows.Clear();

                    // Hint GC every 10 batches to release the serialized JSON strings
                    // that ApiClient allocates per batch. Gen1 is enough (short-lived strings).
                    if (sentBatches % 10 == 0)
                        GC.Collect(1, GCCollectionMode.Optimized);

                    // Pause between batches so backend has breathing room
                    if (offset < totalCount && !ct.IsCancellationRequested && _config.Settings.BatchDelayMs > 0)
                        await Task.Delay(_config.Settings.BatchDelayMs, ct);
                }

                // Only advance watermark if ALL batches succeeded
                if (failedBatches == 0 && totalRowsSynced > 0)
                {
                    _watermarks.ClearCheckpoint(module);
                    _watermarks.UpdateWatermark(module, syncEndTime, totalRowsSynced + (isResume ? startOffset : 0));
                    status.Status = SyncStatus.Ok;
                    status.StatusMessage = $"Synced {totalRowsSynced + (isResume ? startOffset : 0)}/{totalCount} {module}";
                    status.ErrorMessage = string.Empty;
                    status.LastSyncTime  = DateTime.UtcNow;
                    _log.Info(module, $"Sync complete: {totalRowsSynced} rows in {sentBatches} batches (chunk {batchSize})" +
                        (isResume ? $" (resumed from offset {startOffset})" : ""));
                }
                else if (failedBatches == 0 && totalRowsSynced == 0 && !isResume)
                {
                    // Edge case: count said rows exist but fetch returned 0 — clear any stale checkpoint
                    _watermarks.ClearCheckpoint(module);
                    status.Status = SyncStatus.Ok;
                    status.StatusMessage = $"No new {module}";
                    status.ErrorMessage = string.Empty;
                    status.LastSyncTime = DateTime.UtcNow;
                }
                else if (failedBatches > 0)
                {
                    // Watermark NOT advanced — checkpoint already saved above
                    status.Status = SyncStatus.Error;
                    status.ErrorMessage = lastBatchError ?? "Batch failed";
                    status.StatusMessage =
                        $"Sync incomplete: {totalRowsSynced} rows sent (offset {offset}/{totalCount}), " +
                        $"{failedBatches} batch(es) failed — will resume from offset {offset} next run. " +
                        $"Last error: {status.ErrorMessage}";
                    _log.Warn(module,
                        $"Sync incomplete: {offset}/{totalCount} rows. " +
                        $"Checkpoint at offset {offset}. Will resume next run.");
                }
            }
            catch (OperationCanceledException)
            {
                status.Status = SyncStatus.Warning;
                status.StatusMessage = "Sync cancelled";
                status.ErrorMessage = string.Empty;
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

        private static bool IsChunkSizeRetryableError(string? errorMessage)
        {
            if (string.IsNullOrWhiteSpace(errorMessage)) return true;

            var e = errorMessage.ToLowerInvariant();

            // auth/config errors won't be fixed by smaller chunks
            if (e.Contains("401") || e.Contains("403") || e.Contains("unauthorized") ||
                e.Contains("invalid_sync_key") || e.Contains("tenant not found"))
                return false;

            return true;
        }
    }
}
