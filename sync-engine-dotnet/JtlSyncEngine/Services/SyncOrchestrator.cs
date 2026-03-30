using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using JtlSyncEngine.JtlModels;
using JtlSyncEngine.Models;
using Newtonsoft.Json;
using Newtonsoft.Json.Serialization;

namespace JtlSyncEngine.Services
{
    public class SyncOrchestrator
    {
        private readonly ConfigService _config;
        private readonly MssqlService _mssql;
        private readonly ApiClient _apiClient;
        private readonly WatermarkService _watermarks;
        private readonly LogService _log;

        private static readonly JsonSerializerSettings SerializerSettings = new()
        {
            ContractResolver = new CamelCasePropertyNamesContractResolver(),
            NullValueHandling = NullValueHandling.Ignore
        };

        public event Action<string, SyncModuleStatus>? StatusUpdated;

        public SyncOrchestrator(
            ConfigService config,
            MssqlService mssql,
            ApiClient apiClient,
            WatermarkService watermarks,
            LogService log)
        {
            _config = config;
            _mssql = mssql;
            _apiClient = apiClient;
            _watermarks = watermarks;
            _log = log;
        }

        public async Task SyncOrdersAsync(SyncModuleStatus status, CancellationToken ct = default)
        {
            const string module = "orders";
            status.IsRunning = true;
            status.Status = SyncStatus.Running;
            status.StatusMessage = "Starting orders sync...";

            try
            {
                var lastSyncTime = _watermarks.GetLastSyncTime(module);
                var syncEndTime = DateTime.UtcNow;
                var batchSize = _config.Settings.BatchSize;
                var tenantId = _config.Settings.TenantId;
                var syncStartTime = DateTime.UtcNow;

                _log.Info(module, $"Starting orders sync from {lastSyncTime:yyyy-MM-ddTHH:mm:ssZ} to {syncEndTime:yyyy-MM-ddTHH:mm:ssZ}");

                // Count total rows to determine total batches
                int totalCount = await _mssql.GetOrdersCountAsync(lastSyncTime, syncEndTime, ct);
                int totalBatches = totalCount == 0 ? 1 : (int)Math.Ceiling((double)totalCount / batchSize);

                _log.Info(module, $"Found {totalCount} orders to sync in {totalBatches} batches");
                status.TotalBatches = totalBatches;

                if (totalCount == 0)
                {
                    _watermarks.UpdateWatermark(module, syncEndTime, 0);
                    status.Status = SyncStatus.Ok;
                    status.StatusMessage = "No new orders";
                    status.LastSyncTime = DateTime.UtcNow;
                    _log.Info(module, "No new orders to sync");
                    return;
                }

                long totalRowsSynced = 0;
                int offset = 0;
                int batchIndex = 0;

                while (offset < totalCount && !ct.IsCancellationRequested)
                {
                    status.CurrentBatch = batchIndex + 1;
                    status.StatusMessage = $"Syncing batch {batchIndex + 1}/{totalBatches}...";

                    var orders = await _mssql.GetOrdersPageAsync(lastSyncTime, syncEndTime, offset, batchSize, ct);
                    if (orders.Count == 0) break;

                    // Fetch order items for these orders
                    var orderIds = orders.Select(o => o.KAuftrag).ToList();
                    var items = await _mssql.GetOrderItemsAsync(orderIds, ct);
                    var itemsByOrder = items.GroupBy(i => i.KAuftrag).ToDictionary(g => g.Key, g => g.ToList());

                    foreach (var order in orders)
                    {
                        order.Items = itemsByOrder.TryGetValue(order.KAuftrag, out var orderItems)
                            ? orderItems
                            : new List<JtlOrderItem>();
                    }

                    var rows = orders.Cast<object>().ToList();
                    var batch = new IngestBatch
                    {
                        Module = module,
                        TenantId = tenantId,
                        BatchIndex = batchIndex,
                        TotalBatches = totalBatches,
                        SyncStartTime = syncStartTime,
                        WatermarkTime = lastSyncTime,
                        Rows = rows
                    };

                    var result = await _apiClient.SendBatchAsync(batch, ct);
                    if (!result.Success)
                    {
                        _log.Error(module, $"Batch {batchIndex + 1} failed: {result.ErrorMessage}");
                    }

                    totalRowsSynced += orders.Count;
                    offset += orders.Count;
                    batchIndex++;

                    status.RowsSynced = totalRowsSynced;

                    // Delay between batches to avoid overloading backend
                    if (offset < totalCount && !ct.IsCancellationRequested)
                        await Task.Delay(_config.Settings.BatchDelayMs, ct);
                }

                _watermarks.UpdateWatermark(module, syncEndTime, totalRowsSynced);
                status.Status = SyncStatus.Ok;
                status.StatusMessage = $"Synced {totalRowsSynced} orders";
                status.LastSyncTime = DateTime.UtcNow;
                _log.Info(module, $"Orders sync complete: {totalRowsSynced} rows in {batchIndex} batches");
            }
            catch (OperationCanceledException)
            {
                status.Status = SyncStatus.Warning;
                status.StatusMessage = "Sync cancelled";
                _log.Warn(module, "Orders sync was cancelled");
            }
            catch (Exception ex)
            {
                status.Status = SyncStatus.Error;
                status.StatusMessage = $"Error: {ex.Message}";
                status.ErrorMessage = ex.Message;
                _log.Error(module, "Orders sync failed", ex);
            }
            finally
            {
                status.IsRunning = false;
                status.CurrentBatch = 0;
                status.TotalBatches = 0;
            }
        }

        public async Task SyncProductsAsync(SyncModuleStatus status, CancellationToken ct = default)
        {
            const string module = "products";
            status.IsRunning = true;
            status.Status = SyncStatus.Running;
            status.StatusMessage = "Starting products sync...";

            try
            {
                var lastSyncTime = _watermarks.GetLastSyncTime(module);
                var syncEndTime = DateTime.UtcNow;
                var batchSize = _config.Settings.BatchSize;
                var tenantId = _config.Settings.TenantId;
                var syncStartTime = DateTime.UtcNow;

                _log.Info(module, $"Starting products sync from {lastSyncTime:yyyy-MM-ddTHH:mm:ssZ}");

                var products = await _mssql.GetProductsAsync(lastSyncTime, ct);
                _log.Info(module, $"Found {products.Count} products to sync");

                if (products.Count == 0)
                {
                    _watermarks.UpdateWatermark(module, syncEndTime, 0);
                    status.Status = SyncStatus.Ok;
                    status.StatusMessage = "No updated products";
                    status.LastSyncTime = DateTime.UtcNow;
                    return;
                }

                int totalBatches = (int)Math.Ceiling((double)products.Count / batchSize);
                status.TotalBatches = totalBatches;
                long totalRowsSynced = 0;

                for (int i = 0; i < totalBatches && !ct.IsCancellationRequested; i++)
                {
                    status.CurrentBatch = i + 1;
                    status.StatusMessage = $"Syncing batch {i + 1}/{totalBatches}...";

                    var pageRows = products.Skip(i * batchSize).Take(batchSize).Cast<object>().ToList();
                    var batch = new IngestBatch
                    {
                        Module = module,
                        TenantId = tenantId,
                        BatchIndex = i,
                        TotalBatches = totalBatches,
                        SyncStartTime = syncStartTime,
                        WatermarkTime = lastSyncTime,
                        Rows = pageRows
                    };

                    var result = await _apiClient.SendBatchAsync(batch, ct);
                    if (!result.Success)
                        _log.Error(module, $"Batch {i + 1} failed: {result.ErrorMessage}");

                    totalRowsSynced += pageRows.Count;
                    status.RowsSynced = totalRowsSynced;

                    if (i < totalBatches - 1 && !ct.IsCancellationRequested)
                        await Task.Delay(_config.Settings.BatchDelayMs, ct);
                }

                _watermarks.UpdateWatermark(module, syncEndTime, totalRowsSynced);
                status.Status = SyncStatus.Ok;
                status.StatusMessage = $"Synced {totalRowsSynced} products";
                status.LastSyncTime = DateTime.UtcNow;
                _log.Info(module, $"Products sync complete: {totalRowsSynced} rows");
            }
            catch (OperationCanceledException)
            {
                status.Status = SyncStatus.Warning;
                status.StatusMessage = "Sync cancelled";
                _log.Warn(module, "Products sync was cancelled");
            }
            catch (Exception ex)
            {
                status.Status = SyncStatus.Error;
                status.StatusMessage = $"Error: {ex.Message}";
                status.ErrorMessage = ex.Message;
                _log.Error(module, "Products sync failed", ex);
            }
            finally
            {
                status.IsRunning = false;
                status.CurrentBatch = 0;
                status.TotalBatches = 0;
            }
        }

        public async Task SyncCustomersAsync(SyncModuleStatus status, CancellationToken ct = default)
        {
            const string module = "customers";
            status.IsRunning = true;
            status.Status = SyncStatus.Running;
            status.StatusMessage = "Starting customers sync...";

            try
            {
                var lastSyncTime = _watermarks.GetLastSyncTime(module);
                var syncEndTime = DateTime.UtcNow;
                var batchSize = _config.Settings.BatchSize;
                var tenantId = _config.Settings.TenantId;
                var syncStartTime = DateTime.UtcNow;

                _log.Info(module, $"Starting customers sync from {lastSyncTime:yyyy-MM-ddTHH:mm:ssZ}");

                var customers = await _mssql.GetCustomersAsync(lastSyncTime, ct);
                _log.Info(module, $"Found {customers.Count} customers to sync");

                if (customers.Count == 0)
                {
                    _watermarks.UpdateWatermark(module, syncEndTime, 0);
                    status.Status = SyncStatus.Ok;
                    status.StatusMessage = "No updated customers";
                    status.LastSyncTime = DateTime.UtcNow;
                    return;
                }

                int totalBatches = (int)Math.Ceiling((double)customers.Count / batchSize);
                status.TotalBatches = totalBatches;
                long totalRowsSynced = 0;

                for (int i = 0; i < totalBatches && !ct.IsCancellationRequested; i++)
                {
                    status.CurrentBatch = i + 1;
                    status.StatusMessage = $"Syncing batch {i + 1}/{totalBatches}...";

                    var pageRows = customers.Skip(i * batchSize).Take(batchSize).Cast<object>().ToList();
                    var batch = new IngestBatch
                    {
                        Module = module,
                        TenantId = tenantId,
                        BatchIndex = i,
                        TotalBatches = totalBatches,
                        SyncStartTime = syncStartTime,
                        WatermarkTime = lastSyncTime,
                        Rows = pageRows
                    };

                    var result = await _apiClient.SendBatchAsync(batch, ct);
                    if (!result.Success)
                        _log.Error(module, $"Batch {i + 1} failed: {result.ErrorMessage}");

                    totalRowsSynced += pageRows.Count;
                    status.RowsSynced = totalRowsSynced;

                    if (i < totalBatches - 1 && !ct.IsCancellationRequested)
                        await Task.Delay(_config.Settings.BatchDelayMs, ct);
                }

                _watermarks.UpdateWatermark(module, syncEndTime, totalRowsSynced);
                status.Status = SyncStatus.Ok;
                status.StatusMessage = $"Synced {totalRowsSynced} customers";
                status.LastSyncTime = DateTime.UtcNow;
                _log.Info(module, $"Customers sync complete: {totalRowsSynced} rows");
            }
            catch (OperationCanceledException)
            {
                status.Status = SyncStatus.Warning;
                status.StatusMessage = "Sync cancelled";
                _log.Warn(module, "Customers sync was cancelled");
            }
            catch (Exception ex)
            {
                status.Status = SyncStatus.Error;
                status.StatusMessage = $"Error: {ex.Message}";
                status.ErrorMessage = ex.Message;
                _log.Error(module, "Customers sync failed", ex);
            }
            finally
            {
                status.IsRunning = false;
                status.CurrentBatch = 0;
                status.TotalBatches = 0;
            }
        }

        public async Task SyncInventoryAsync(SyncModuleStatus status, CancellationToken ct = default)
        {
            const string module = "inventory";
            status.IsRunning = true;
            status.Status = SyncStatus.Running;
            status.StatusMessage = "Starting inventory sync...";

            try
            {
                var syncEndTime = DateTime.UtcNow;
                var batchSize = _config.Settings.BatchSize;
                var tenantId = _config.Settings.TenantId;
                var syncStartTime = DateTime.UtcNow;

                _log.Info(module, "Starting inventory sync (full snapshot)");

                var inventory = await _mssql.GetInventoryAsync(ct);
                _log.Info(module, $"Found {inventory.Count} inventory records to sync");

                if (inventory.Count == 0)
                {
                    _watermarks.UpdateWatermark(module, syncEndTime, 0);
                    status.Status = SyncStatus.Ok;
                    status.StatusMessage = "No inventory records";
                    status.LastSyncTime = DateTime.UtcNow;
                    return;
                }

                int totalBatches = (int)Math.Ceiling((double)inventory.Count / batchSize);
                status.TotalBatches = totalBatches;
                long totalRowsSynced = 0;
                var lastSyncTime = _watermarks.GetLastSyncTime(module);

                for (int i = 0; i < totalBatches && !ct.IsCancellationRequested; i++)
                {
                    status.CurrentBatch = i + 1;
                    status.StatusMessage = $"Syncing batch {i + 1}/{totalBatches}...";

                    var pageRows = inventory.Skip(i * batchSize).Take(batchSize).Cast<object>().ToList();
                    var batch = new IngestBatch
                    {
                        Module = module,
                        TenantId = tenantId,
                        BatchIndex = i,
                        TotalBatches = totalBatches,
                        SyncStartTime = syncStartTime,
                        WatermarkTime = lastSyncTime,
                        Rows = pageRows
                    };

                    var result = await _apiClient.SendBatchAsync(batch, ct);
                    if (!result.Success)
                        _log.Error(module, $"Batch {i + 1} failed: {result.ErrorMessage}");

                    totalRowsSynced += pageRows.Count;
                    status.RowsSynced = totalRowsSynced;

                    if (i < totalBatches - 1 && !ct.IsCancellationRequested)
                        await Task.Delay(_config.Settings.BatchDelayMs, ct);
                }

                _watermarks.UpdateWatermark(module, syncEndTime, totalRowsSynced);
                status.Status = SyncStatus.Ok;
                status.StatusMessage = $"Synced {totalRowsSynced} inventory records";
                status.LastSyncTime = DateTime.UtcNow;
                _log.Info(module, $"Inventory sync complete: {totalRowsSynced} rows");
            }
            catch (OperationCanceledException)
            {
                status.Status = SyncStatus.Warning;
                status.StatusMessage = "Sync cancelled";
                _log.Warn(module, "Inventory sync was cancelled");
            }
            catch (Exception ex)
            {
                status.Status = SyncStatus.Error;
                status.StatusMessage = $"Error: {ex.Message}";
                status.ErrorMessage = ex.Message;
                _log.Error(module, "Inventory sync failed", ex);
            }
            finally
            {
                status.IsRunning = false;
                status.CurrentBatch = 0;
                status.TotalBatches = 0;
            }
        }
    }
}
