/*
  JTL Sales Channel and Payment Separation — Phase 0 diagnostics

  READ-ONLY GUARANTEE:
  - SELECT statements only
  - no temp tables
  - no DDL/DML
  - READ UNCOMMITTED to avoid blocking JTL-Wawi

  Run this against each representative JTL database and save every result set.
*/

SET NOCOUNT ON;
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;

-- 0. Execution identity. Record this result with the evidence package.
SELECT
    DB_NAME() AS database_name,
    @@SERVERNAME AS server_name,
    CAST(SERVERPROPERTY('ProductVersion') AS nvarchar(128)) AS sql_server_product_version,
    CAST(SERVERPROPERTY('ProductLevel') AS nvarchar(128)) AS sql_server_product_level,
    CAST(SERVERPROPERTY('Edition') AS nvarchar(128)) AS sql_server_edition,
    SYSUTCDATETIME() AS diagnostic_executed_at_utc;

-- 0a. Effective database permissions for the connected account. A Phase 0
-- operator must confirm can_select=1 and every write/control permission=0.
SELECT
    ORIGINAL_LOGIN() AS original_login,
    SUSER_SNAME() AS server_login,
    USER_NAME() AS database_user,
    HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'SELECT') AS can_select,
    HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'INSERT') AS can_insert,
    HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'UPDATE') AS can_update,
    HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'DELETE') AS can_delete,
    HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'ALTER') AS can_alter,
    HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'CONTROL') AS can_control;

-- 1. Candidate JTL version metadata objects. Inspect returned rows rather than
-- assuming one version-table name across JTL installations.
SELECT
    s.name AS schema_name,
    o.name AS object_name,
    o.type_desc,
    c.name AS column_name,
    t.name AS data_type,
    c.max_length
FROM sys.objects o
JOIN sys.schemas s ON s.schema_id = o.schema_id
JOIN sys.columns c ON c.object_id = o.object_id
JOIN sys.types t ON t.user_type_id = c.user_type_id
WHERE o.type IN ('U', 'V')
  AND (
       LOWER(o.name) LIKE '%version%'
    OR LOWER(c.name) LIKE '%version%'
    OR LOWER(c.name) LIKE '%build%'
  )
ORDER BY s.name, o.name, c.column_id;

-- 2. Version-specific candidate columns on the order table.
SELECT
    s.name AS schema_name,
    o.name AS object_name,
    c.column_id,
    c.name AS column_name,
    t.name AS data_type,
    c.max_length,
    c.is_nullable
FROM sys.columns c
JOIN sys.objects o ON o.object_id = c.object_id
JOIN sys.schemas s ON s.schema_id = o.schema_id
JOIN sys.types t ON t.user_type_id = c.user_type_id
WHERE s.name = 'Verkauf'
  AND o.name = 'tAuftrag'
  AND (
       LOWER(c.name) LIKE '%plattform%'
    OR LOWER(c.name) LIKE '%shop%'
    OR LOWER(c.name) LIKE '%kanal%'
    OR LOWER(c.name) LIKE '%extern%'
    OR LOWER(c.name) LIKE '%market%'
    OR LOWER(c.name) LIKE '%konto%'
    OR LOWER(c.name) LIKE '%quelle%'
    OR LOWER(c.name) LIKE '%herkunft%'
  )
ORDER BY c.column_id;

-- 3. Candidate marketplace, shop, account, connector, and platform tables/views.
SELECT
    s.name AS schema_name,
    o.name AS object_name,
    o.type_desc
FROM sys.objects o
JOIN sys.schemas s ON s.schema_id = o.schema_id
WHERE o.type IN ('U', 'V')
  AND (
       LOWER(o.name) LIKE '%plattform%'
    OR LOWER(o.name) LIKE '%market%'
    OR LOWER(o.name) LIKE '%shop%'
    OR LOWER(o.name) LIKE '%seller%'
    OR LOWER(o.name) LIKE '%channel%'
    OR LOWER(o.name) LIKE '%konto%'
    OR LOWER(o.name) LIKE '%eazy%'
    OR LOWER(o.name) LIKE '%connector%'
  )
ORDER BY s.name, o.name;

-- 4. Relevant columns on candidate source objects. This exposes possible
-- marketplace/account/shop keys without reading unknown tables dynamically.
SELECT
    s.name AS schema_name,
    o.name AS object_name,
    c.column_id,
    c.name AS column_name,
    t.name AS data_type,
    c.max_length,
    c.is_nullable
FROM sys.objects o
JOIN sys.schemas s ON s.schema_id = o.schema_id
JOIN sys.columns c ON c.object_id = o.object_id
JOIN sys.types t ON t.user_type_id = c.user_type_id
WHERE o.type IN ('U', 'V')
  AND (
       LOWER(o.name) LIKE '%plattform%'
    OR LOWER(o.name) LIKE '%market%'
    OR LOWER(o.name) LIKE '%shop%'
    OR LOWER(o.name) LIKE '%seller%'
    OR LOWER(o.name) LIKE '%channel%'
    OR LOWER(o.name) LIKE '%konto%'
    OR LOWER(o.name) LIKE '%eazy%'
    OR LOWER(o.name) LIKE '%connector%'
  )
  AND (
       LOWER(c.name) LIKE '%name%'
    OR LOWER(c.name) LIKE '%plattform%'
    OR LOWER(c.name) LIKE '%market%'
    OR LOWER(c.name) LIKE '%shop%'
    OR LOWER(c.name) LIKE '%seller%'
    OR LOWER(c.name) LIKE '%konto%'
    OR LOWER(c.name) LIKE '%account%'
    OR LOWER(c.name) LIKE '%extern%'
    OR LOWER(c.name) LIKE '%quelle%'
    OR LOWER(c.name) LIKE '%herkunft%'
  )
ORDER BY s.name, o.name, c.column_id;

-- 5. Current platform/payment/shipping combinations.
SELECT
    ISNULL(p.cName, 'Unknown') AS platform_name,
    ISNULL(za.cName, 'Unknown') AS payment_name,
    ISNULL(va.cName, 'Unknown') AS shipping_name,
    COUNT_BIG(*) AS order_count,
    MIN(a.dErstellt) AS first_order,
    MAX(a.dErstellt) AS last_order
FROM Verkauf.tAuftrag a WITH (NOLOCK)
LEFT JOIN dbo.tPlattform p WITH (NOLOCK) ON p.nPlattform = a.kPlattform
LEFT JOIN dbo.tZahlungsart za WITH (NOLOCK) ON za.kZahlungsart = a.kZahlungsart
LEFT JOIN dbo.tVersandart va WITH (NOLOCK) ON va.kVersandart = a.kVersandArt
GROUP BY ISNULL(p.cName, 'Unknown'), ISNULL(za.cName, 'Unknown'), ISNULL(va.cName, 'Unknown')
ORDER BY order_count DESC;

-- 6. Marketplace-like payment values that require manual source verification.
SELECT
    ISNULL(p.cName, 'Unknown') AS platform_name,
    ISNULL(za.cName, 'Unknown') AS payment_name,
    COUNT_BIG(*) AS order_count,
    MIN(a.dErstellt) AS first_order,
    MAX(a.dErstellt) AS last_order
FROM Verkauf.tAuftrag a WITH (NOLOCK)
LEFT JOIN dbo.tPlattform p WITH (NOLOCK) ON p.nPlattform = a.kPlattform
LEFT JOIN dbo.tZahlungsart za WITH (NOLOCK) ON za.kZahlungsart = a.kZahlungsart
WHERE LOWER(ISNULL(za.cName, '')) LIKE '%amazon%'
   OR LOWER(ISNULL(za.cName, '')) LIKE '%ebay%'
   OR LOWER(ISNULL(za.cName, '')) LIKE '%otto%'
   OR LOWER(ISNULL(za.cName, '')) LIKE '%kaufland%'
   OR LOWER(ISNULL(za.cName, '')) LIKE '%mediamarkt%'
   OR LOWER(ISNULL(za.cName, '')) LIKE '%saturn%'
GROUP BY ISNULL(p.cName, 'Unknown'), ISNULL(za.cName, 'Unknown')
ORDER BY order_count DESC;

-- 7. Representative orders for manual JTL-Wawi tracing.
SELECT TOP (500)
    a.kAuftrag,
    a.cAuftragsNr,
    a.dErstellt,
    ISNULL(p.cName, '') AS platform_name,
    ISNULL(za.cName, '') AS payment_name,
    ISNULL(va.cName, '') AS shipping_name,
    ISNULL(a.cExterneAuftragsnummer, '') AS external_order_number,
    a.kPlattform,
    a.kZahlungsart,
    a.kVersandArt
FROM Verkauf.tAuftrag a WITH (NOLOCK)
LEFT JOIN dbo.tPlattform p WITH (NOLOCK) ON p.nPlattform = a.kPlattform
LEFT JOIN dbo.tZahlungsart za WITH (NOLOCK) ON za.kZahlungsart = a.kZahlungsart
LEFT JOIN dbo.tVersandart va WITH (NOLOCK) ON va.kVersandart = a.kVersandArt
WHERE LOWER(ISNULL(p.cName, '')) LIKE '%amazon%'
   OR LOWER(ISNULL(p.cName, '')) LIKE '%ebay%'
   OR LOWER(ISNULL(p.cName, '')) LIKE '%otto%'
   OR LOWER(ISNULL(p.cName, '')) LIKE '%kaufland%'
   OR LOWER(ISNULL(p.cName, '')) LIKE '%mediamarkt%'
   OR LOWER(ISNULL(p.cName, '')) LIKE '%saturn%'
   OR LOWER(ISNULL(za.cName, '')) LIKE '%amazon%'
   OR LOWER(ISNULL(za.cName, '')) LIKE '%ebay%'
   OR LOWER(ISNULL(za.cName, '')) LIKE '%otto%'
   OR LOWER(ISNULL(za.cName, '')) LIKE '%kaufland%'
   OR LOWER(ISNULL(za.cName, '')) LIKE '%mediamarkt%'
   OR LOWER(ISNULL(za.cName, '')) LIKE '%saturn%'
ORDER BY a.dErstellt DESC;

-- 8. External-order prefixes correlated with broad platforms.
SELECT TOP (200)
    ISNULL(p.cName, 'Unknown') AS platform_name,
    LEFT(LTRIM(RTRIM(ISNULL(a.cExterneAuftragsnummer, ''))), 12) AS external_prefix,
    COUNT_BIG(*) AS order_count,
    MIN(a.dErstellt) AS first_order,
    MAX(a.dErstellt) AS last_order
FROM Verkauf.tAuftrag a WITH (NOLOCK)
LEFT JOIN dbo.tPlattform p WITH (NOLOCK) ON p.nPlattform = a.kPlattform
WHERE LTRIM(RTRIM(ISNULL(a.cExterneAuftragsnummer, ''))) <> ''
GROUP BY ISNULL(p.cName, 'Unknown'), LEFT(LTRIM(RTRIM(ISNULL(a.cExterneAuftragsnummer, ''))), 12)
HAVING COUNT_BIG(*) >= 3
ORDER BY order_count DESC;
