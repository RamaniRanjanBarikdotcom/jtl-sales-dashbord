using System;
using System.Collections.Generic;
using System.Linq;

namespace JtlSyncEngine.Inventory
{
    public enum InventorySourceType
    {
        Legacy,
        MergedArticleStock,
        ReportProduct,
        VLagerbestandEx,
        TLagerbestand,
        TArtikelNLagerbestand
    }

    public sealed class InventoryRow
    {
        public long JtlProductId { get; set; }
        public int JtlWarehouseId { get; set; }
        public string WarehouseName { get; set; } = "Default";
        public decimal Available { get; set; }
        public decimal Reserved { get; set; }
        public decimal Total { get; set; }
        public decimal ReorderPoint { get; set; }
    }

    public sealed class InventorySourceSummary
    {
        public InventorySourceType Source { get; set; }
        public string ObjectName { get; set; } = "";
        public bool Exists { get; set; }
        public bool Queryable { get; set; }
        public string Status { get; set; } = "not_checked";
        public int RowsCount { get; set; }
        public int RowsWithStock { get; set; }
        public decimal TotalStock { get; set; }
        public decimal AvailableStock { get; set; }
        public decimal ReservedStock { get; set; }
        public string? Reason { get; set; }
    }

    public sealed class InventoryDiagnosticsResult
    {
        public string InventorySourceMode { get; set; } = "auto";
        public InventorySourceType SelectedSource { get; set; } = InventorySourceType.Legacy;
        public string StockStatus { get; set; } = "legacy";
        public bool SafeToSync { get; set; } = true;
        public string? RejectReason { get; set; }
        public string? MergeStrategy { get; set; }
        public List<InventorySourceSummary> Sources { get; set; } = new();

        public InventorySourceSummary? SelectedSummary =>
            Sources.FirstOrDefault(source => source.Source == SelectedSource);

        public Dictionary<string, object?> ToBackendMetadata()
        {
            var selected = SelectedSummary;
            return new Dictionary<string, object?>
            {
                ["inventorySourceMode"] = InventorySourceMode,
                ["selectedSource"] = SelectedSource.ToString(),
                ["stockStatus"] = StockStatus,
                ["safeToSync"] = SafeToSync,
                ["rowsRead"] = selected?.RowsCount ?? 0,
                ["rowsWithStock"] = selected?.RowsWithStock ?? 0,
                ["totalStock"] = selected?.TotalStock ?? 0m,
                ["availableStock"] = selected?.AvailableStock ?? 0m,
                ["reservedStock"] = selected?.ReservedStock ?? 0m,
                ["rejectReason"] = RejectReason,
                ["mergeStrategy"] = MergeStrategy
            };
        }
    }
}
