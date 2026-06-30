using System;
using System.Collections.Generic;
using System.Linq;
using JtlSyncEngine.Models;

namespace JtlSyncEngine.Inventory
{
    public static class JtlInventorySourceResolver
    {
        private static readonly InventorySourceType[] Priority =
        {
            InventorySourceType.ReportProduct,
            InventorySourceType.VLagerbestandEx,
            InventorySourceType.TLagerbestand,
            InventorySourceType.TArtikelNLagerbestand
        };

        public static InventoryDiagnosticsResult Resolve(
            IEnumerable<InventorySourceSummary> summaries,
            AppSettings settings)
        {
            var result = new InventoryDiagnosticsResult
            {
                InventorySourceMode = settings.InventorySourceMode,
                Sources = summaries.ToList()
            };

            var validSources = result.Sources
                .Where(source => source.Exists && source.Queryable && source.RowsCount > 0)
                .ToList();

            if (validSources.Count == 0)
            {
                result.SelectedSource = InventorySourceType.Legacy;
                result.StockStatus = "no_valid_source";
                result.SafeToSync = false;
                result.RejectReason = "No adaptive inventory source returned rows.";
                return result;
            }

            var positiveSources = validSources.Where(source => source.TotalStock > 0 || source.AvailableStock > 0).ToList();
            var conflictingPositiveSources = positiveSources
                .Select(source => source.TotalStock)
                .Distinct()
                .Skip(1)
                .Any();

            if (settings.InventoryRejectConflictingStockSources && conflictingPositiveSources)
            {
                result.SelectedSource = positiveSources
                    .OrderBy(source => Array.IndexOf(Priority, source.Source))
                    .First().Source;
                result.StockStatus = "source_conflict";
                result.SafeToSync = false;
                result.RejectReason = "Multiple inventory sources have conflicting positive stock totals.";
                return result;
            }

            var selected = validSources
                .OrderBy(source => Array.IndexOf(Priority, source.Source))
                .First();

            result.SelectedSource = selected.Source;
            if (selected.TotalStock > 0 || selected.AvailableStock > 0)
            {
                result.StockStatus = "positive_stock";
                result.SafeToSync = true;
                return result;
            }

            if (settings.InventoryAllowConfirmedZeroStock)
            {
                result.StockStatus = "confirmed_zero_stock";
                result.SafeToSync = true;
                return result;
            }

            result.StockStatus = "unverified_zero_stock";
            result.SafeToSync = !settings.InventoryRejectUnverifiedZeroStock;
            result.RejectReason = result.SafeToSync ? null : "Selected source returned only zero stock.";
            return result;
        }
    }
}
