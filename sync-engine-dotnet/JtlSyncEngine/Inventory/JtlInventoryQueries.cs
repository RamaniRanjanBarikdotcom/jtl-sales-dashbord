using System;

namespace JtlSyncEngine.Inventory
{
    public static class JtlInventoryQueries
    {
        private const string MergeCondition = @"ISNULL(n.total, 0) > 0
              OR ISNULL(n.available, 0) > 0
              OR ISNULL(n.reserved, 0) > 0";

        public static string BuildPageQuery(InventorySourceType source) => source switch
        {
            InventorySourceType.ReportProduct => @"
SELECT
    CAST(p.ProductInternalId AS bigint) AS jtlProductId,
    CAST(0 AS int) AS jtlWarehouseId,
    CAST('Default' AS nvarchar(255)) AS warehouseName,
    CAST(ISNULL(p.AvailableStock, 0) AS decimal(18,4)) AS available,
    CAST(ISNULL(p.ReservedStock, 0) AS decimal(18,4)) AS reserved,
    CAST(ISNULL(p.TotalStock, 0) AS decimal(18,4)) AS total,
    CAST(ISNULL(p.MinimumStockLevel, 0) AS decimal(18,4)) AS reorderPoint
FROM Report.Product p WITH (NOLOCK)
WHERE p.ProductInternalId IS NOT NULL
ORDER BY p.ProductInternalId ASC
OFFSET @offset ROWS FETCH NEXT @batchSize ROWS ONLY",
            InventorySourceType.VLagerbestandEx => @"
SELECT
    CAST(v.kArtikel AS bigint) AS jtlProductId,
    CAST(0 AS int) AS jtlWarehouseId,
    CAST('Default' AS nvarchar(255)) AS warehouseName,
    CAST(ISNULL(v.fVerfuegbar, 0) AS decimal(18,4)) AS available,
    CAST(ISNULL(v.fReserviert, 0) AS decimal(18,4)) AS reserved,
    CAST(ISNULL(v.fLagerbestand, 0) AS decimal(18,4)) AS total,
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
    CAST(ISNULL(lb.fVerfuegbar, 0) AS decimal(18,4)) AS available,
    CAST(
        CASE
            WHEN ISNULL(lb.fLagerbestand, 0) > ISNULL(lb.fVerfuegbar, 0)
            THEN ISNULL(lb.fLagerbestand, 0) - ISNULL(lb.fVerfuegbar, 0)
            ELSE 0
        END AS decimal(18,4)
    ) AS reserved,
    CAST(ISNULL(lb.fLagerbestand, 0) AS decimal(18,4)) AS total,
    CAST(0 AS decimal(18,4)) AS reorderPoint
FROM dbo.tlagerbestand lb WITH (NOLOCK)
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

        public static string BuildMergedArticleStockPageQuery(
            bool useReportProduct,
            string stammReorderPointExpression,
            string reportReorderPointExpression)
        {
            var normalStock = useReportProduct
                ? $@"
    SELECT
        CAST(p.ProductInternalId AS bigint) AS jtlProductId,
        CAST(ISNULL(p.AvailableStock, 0) AS decimal(18,4)) AS available,
        CAST(ISNULL(p.ReservedStock, 0) AS decimal(18,4)) AS reserved,
        CAST(ISNULL(p.TotalStock, 0) AS decimal(18,4)) AS total,
        CAST(ISNULL({reportReorderPointExpression}, 0) AS decimal(18,4)) AS reorderPoint
    FROM Report.Product p WITH (NOLOCK)
    WHERE p.ProductInternalId IS NOT NULL"
                : @"
    SELECT
        CAST(v.kArtikel AS bigint) AS jtlProductId,
        CAST(ISNULL(v.fVerfuegbar, 0) AS decimal(18,4)) AS available,
        CAST(ISNULL(v.fReserviert, 0) AS decimal(18,4)) AS reserved,
        CAST(ISNULL(v.fLagerbestand, 0) AS decimal(18,4)) AS total,
        CAST(0 AS decimal(18,4)) AS reorderPoint
    FROM dbo.vLagerbestandEx v WITH (NOLOCK)
    WHERE v.kArtikel IS NOT NULL";

            return $@"
WITH normal_stock AS (
{normalStock}
),
stammartikel_stock AS (
    SELECT
        CAST(a.kArtikel AS bigint) AS jtlProductId,
        CAST(ISNULL(a.nLagerbestand, 0) AS decimal(18,4)) AS available,
        CAST(0 AS decimal(18,4)) AS reserved,
        CAST(ISNULL(a.nLagerbestand, 0) AS decimal(18,4)) AS total,
        CAST(ISNULL({stammReorderPointExpression}, 0) AS decimal(18,4)) AS reorderPoint
    FROM dbo.tArtikel a WITH (NOLOCK)
    WHERE a.kArtikel IS NOT NULL
),
merged AS (
    SELECT
        COALESCE(n.jtlProductId, s.jtlProductId) AS jtlProductId,
        CASE WHEN {MergeCondition}
            THEN ISNULL(n.available, 0)
            ELSE ISNULL(s.available, 0)
        END AS available,
        CASE WHEN {MergeCondition}
            THEN ISNULL(n.reserved, 0)
            ELSE ISNULL(s.reserved, 0)
        END AS reserved,
        CASE WHEN {MergeCondition}
            THEN ISNULL(n.total, 0)
            ELSE ISNULL(s.total, 0)
        END AS total,
        COALESCE(NULLIF(n.reorderPoint, 0), s.reorderPoint, 0) AS reorderPoint
    FROM normal_stock n
    FULL OUTER JOIN stammartikel_stock s
        ON s.jtlProductId = n.jtlProductId
)
SELECT
    jtlProductId,
    CAST(0 AS int) AS jtlWarehouseId,
    CAST('Default' AS nvarchar(255)) AS warehouseName,
    available,
    reserved,
    total,
    reorderPoint
FROM merged
WHERE jtlProductId IS NOT NULL
ORDER BY jtlProductId ASC
OFFSET @offset ROWS FETCH NEXT @batchSize ROWS ONLY";
        }

        public static string BuildMergedArticleStockSummaryQuery(bool useReportProduct)
        {
            var normalStock = useReportProduct
                ? @"
    SELECT
        CAST(p.ProductInternalId AS bigint) AS jtlProductId,
        CAST(ISNULL(p.AvailableStock, 0) AS decimal(18,4)) AS available,
        CAST(ISNULL(p.ReservedStock, 0) AS decimal(18,4)) AS reserved,
        CAST(ISNULL(p.TotalStock, 0) AS decimal(18,4)) AS total
    FROM Report.Product p WITH (NOLOCK)
    WHERE p.ProductInternalId IS NOT NULL"
                : @"
    SELECT
        CAST(v.kArtikel AS bigint) AS jtlProductId,
        CAST(ISNULL(v.fVerfuegbar, 0) AS decimal(18,4)) AS available,
        CAST(ISNULL(v.fReserviert, 0) AS decimal(18,4)) AS reserved,
        CAST(ISNULL(v.fLagerbestand, 0) AS decimal(18,4)) AS total
    FROM dbo.vLagerbestandEx v WITH (NOLOCK)
    WHERE v.kArtikel IS NOT NULL";

            return $@"
WITH normal_stock AS (
{normalStock}
),
stammartikel_stock AS (
    SELECT
        CAST(a.kArtikel AS bigint) AS jtlProductId,
        CAST(ISNULL(a.nLagerbestand, 0) AS decimal(18,4)) AS available,
        CAST(0 AS decimal(18,4)) AS reserved,
        CAST(ISNULL(a.nLagerbestand, 0) AS decimal(18,4)) AS total
    FROM dbo.tArtikel a WITH (NOLOCK)
    WHERE a.kArtikel IS NOT NULL
),
merged AS (
    SELECT
        COALESCE(n.jtlProductId, s.jtlProductId) AS jtlProductId,
        CASE WHEN {MergeCondition}
            THEN ISNULL(n.available, 0)
            ELSE ISNULL(s.available, 0)
        END AS available,
        CASE WHEN {MergeCondition}
            THEN ISNULL(n.reserved, 0)
            ELSE ISNULL(s.reserved, 0)
        END AS reserved,
        CASE WHEN {MergeCondition}
            THEN ISNULL(n.total, 0)
            ELSE ISNULL(s.total, 0)
        END AS total
    FROM normal_stock n
    FULL OUTER JOIN stammartikel_stock s
        ON s.jtlProductId = n.jtlProductId
)
SELECT
    COUNT(*) AS rowsCount,
    SUM(CASE WHEN total > 0 OR available > 0 THEN 1 ELSE 0 END) AS rowsWithStock,
    COALESCE(SUM(total), 0) AS totalStock,
    COALESCE(SUM(available), 0) AS availableStock,
    COALESCE(SUM(reserved), 0) AS reservedStock
FROM merged
WHERE jtlProductId IS NOT NULL";
        }

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
