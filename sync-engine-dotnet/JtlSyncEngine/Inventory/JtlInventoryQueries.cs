using System;

namespace JtlSyncEngine.Inventory
{
    public static class JtlInventoryQueries
    {
        public static string BuildPageQuery(InventorySourceType source) => source switch
        {
            InventorySourceType.ReportProduct => @"
SELECT
    CAST(p.kArtikel AS bigint) AS jtlProductId,
    CAST(0 AS int) AS jtlWarehouseId,
    CAST('Default' AS nvarchar(255)) AS warehouseName,
    CAST(ISNULL(p.nLagerbestand, 0) AS decimal(18,4)) AS available,
    CAST(0 AS decimal(18,4)) AS reserved,
    CAST(ISNULL(p.nLagerbestand, 0) AS decimal(18,4)) AS total,
    CAST(0 AS decimal(18,4)) AS reorderPoint
FROM Report.Product p WITH (NOLOCK)
WHERE p.kArtikel IS NOT NULL
ORDER BY p.kArtikel ASC
OFFSET @offset ROWS FETCH NEXT @batchSize ROWS ONLY",
            InventorySourceType.VLagerbestandEx => @"
SELECT
    CAST(v.kArtikel AS bigint) AS jtlProductId,
    CAST(0 AS int) AS jtlWarehouseId,
    CAST('Default' AS nvarchar(255)) AS warehouseName,
    CAST(ISNULL(v.fBestand, 0) AS decimal(18,4)) AS available,
    CAST(0 AS decimal(18,4)) AS reserved,
    CAST(ISNULL(v.fBestand, 0) AS decimal(18,4)) AS total,
    CAST(0 AS decimal(18,4)) AS reorderPoint
FROM dbo.vLagerbestandEx v WITH (NOLOCK)
WHERE v.kArtikel IS NOT NULL
ORDER BY v.kArtikel ASC
OFFSET @offset ROWS FETCH NEXT @batchSize ROWS ONLY",
            InventorySourceType.TLagerbestand => @"
SELECT
    CAST(lb.kArtikel AS bigint) AS jtlProductId,
    CAST(0 AS int) AS jtlWarehouseId,
    CAST('Default' AS nvarchar(255)) AS warehouseName,
    CAST(ISNULL(lb.fBestand, 0) AS decimal(18,4)) AS available,
    CAST(0 AS decimal(18,4)) AS reserved,
    CAST(ISNULL(lb.fBestand, 0) AS decimal(18,4)) AS total,
    CAST(0 AS decimal(18,4)) AS reorderPoint
FROM dbo.tlagerbestand lb WITH (NOLOCK)
LEFT JOIN dbo.tArtikel a WITH (NOLOCK) ON a.kArtikel = lb.kArtikel
WHERE lb.kArtikel IS NOT NULL
ORDER BY lb.kArtikel ASC
OFFSET @offset ROWS FETCH NEXT @batchSize ROWS ONLY",
            InventorySourceType.TArtikelNLagerbestand => @"
SELECT
    CAST(a.kArtikel AS bigint) AS jtlProductId,
    CAST(0 AS int) AS jtlWarehouseId,
    CAST('Default' AS nvarchar(255)) AS warehouseName,
    CAST(ISNULL(a.nLagerbestand, 0) AS decimal(18,4)) AS available,
    CAST(0 AS decimal(18,4)) AS reserved,
    CAST(ISNULL(a.nLagerbestand, 0) AS decimal(18,4)) AS total,
    CAST(0 AS decimal(18,4)) AS reorderPoint
FROM dbo.tArtikel a WITH (NOLOCK)
WHERE a.kArtikel IS NOT NULL
ORDER BY a.kArtikel ASC
OFFSET @offset ROWS FETCH NEXT @batchSize ROWS ONLY",
            _ => throw new ArgumentOutOfRangeException(nameof(source), source, null)
        };

        public static string BuildSummaryQuery(InventorySourceType source)
        {
            var pageQuery = BuildPageQuery(source);
            var orderBy = pageQuery.IndexOf("ORDER BY", StringComparison.OrdinalIgnoreCase);
            var selectWithoutPaging = orderBy >= 0 ? pageQuery[..orderBy] : pageQuery;
            return $@"
WITH src AS (
{selectWithoutPaging}
)
SELECT
    COUNT(*) AS rowsCount,
    SUM(CASE WHEN total > 0 OR available > 0 THEN 1 ELSE 0 END) AS rowsWithStock,
    COALESCE(SUM(total), 0) AS totalStock,
    COALESCE(SUM(available), 0) AS availableStock,
    COALESCE(SUM(reserved), 0) AS reservedStock
FROM src";
        }
    }
}
