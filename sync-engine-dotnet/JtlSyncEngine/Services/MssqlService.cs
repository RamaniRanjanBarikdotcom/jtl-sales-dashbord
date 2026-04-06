using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using JtlSyncEngine.JtlModels;
using JtlSyncEngine.Models;
using Microsoft.Data.SqlClient;

namespace JtlSyncEngine.Services
{
    public class MssqlService
    {
        private readonly ConfigService _config;
        private readonly LogService _log;
        private static readonly int[] RetryDelaysSeconds = { 5, 10, 20, 30, 60 };

        // Cached after first sync; cleared when settings change via ResetSchema()
        private JtlSchema? _schema;

        public MssqlService(ConfigService config, LogService log)
        {
            _config = config;
            _log = log;
        }

        public void ResetSchema() => _schema = null;

        // ─────────────────────────────────────────────────────────────────────
        // Schema detection
        // One query reads SQL Server metadata (OBJECT_ID / COL_LENGTH) to learn
        // which optional tables/columns exist in this JTL Wawi version.
        // All queries below are assembled from these flags — no hard-coded
        // version numbers, works on any JTL Wawi version.
        // ─────────────────────────────────────────────────────────────────────
        private async Task<JtlSchema> EnsureSchemaAsync(CancellationToken ct = default)
        {
            if (_schema != null) return _schema;

            const string sql = @"
SELECT
  -- Verkauf.tAuftrag optional columns
  CASE WHEN COL_LENGTH('Verkauf.tAuftrag','fVersandkostenNetto')    IS NOT NULL THEN 1 ELSE 0 END AS hasFVersandkosten,
  CASE WHEN COL_LENGTH('Verkauf.tAuftrag','cExterneAuftragsnummer') IS NOT NULL THEN 1 ELSE 0 END AS hasCExtern,
  CASE WHEN COL_LENGTH('Verkauf.tAuftrag','kAbfrageStatus')         IS NOT NULL THEN 1 ELSE 0 END AS hasKAbfrage,
  CASE WHEN COL_LENGTH('Verkauf.tAuftrag','kPlattform')             IS NOT NULL THEN 1 ELSE 0 END AS hasKPlattform,
  -- Verkauf.tAuftragPosition optional columns
  CASE WHEN COL_LENGTH('Verkauf.tAuftragPosition','fMwSt')   IS NOT NULL THEN 1 ELSE 0 END AS hasPosMwSt,
  CASE WHEN COL_LENGTH('Verkauf.tAuftragPosition','fEkNetto') IS NOT NULL THEN 1 ELSE 0 END AS hasPosEk,
  CASE WHEN COL_LENGTH('Verkauf.tAuftragPosition','fRabatt')  IS NOT NULL THEN 1 ELSE 0 END AS hasPosRabatt,
  -- Lookup tables
  CASE WHEN OBJECT_ID('dbo.tAbfrageStatus') IS NOT NULL THEN 1 ELSE 0 END AS hasTAbfrage,
  CASE WHEN OBJECT_ID('dbo.tPlattform')     IS NOT NULL THEN 1 ELSE 0 END AS hasTPlattform,
  CASE WHEN OBJECT_ID('dbo.tversandart')    IS NOT NULL THEN 1 ELSE 0 END AS hasTVersandart,
  CASE WHEN OBJECT_ID('dbo.tZahlungsart')   IS NOT NULL THEN 1 ELSE 0 END AS hasTZahlungsart,
  -- dbo.tArtikel optional columns
  CASE WHEN COL_LENGTH('dbo.tArtikel','dMod')           IS NOT NULL THEN 1 ELSE 0 END AS hasArtikelDMod,
  CASE WHEN COL_LENGTH('dbo.tArtikel','cBarcode')        IS NOT NULL THEN 1 ELSE 0 END AS hasBarcode,
  CASE WHEN COL_LENGTH('dbo.tArtikel','fGewicht')        IS NOT NULL THEN 1 ELSE 0 END AS hasGewicht,
  CASE WHEN COL_LENGTH('dbo.tArtikel','kVaterArtikel')   IS NOT NULL THEN 1 ELSE 0 END AS hasKVater,
  CASE WHEN COL_LENGTH('dbo.tArtikel','nDelete')         IS NOT NULL THEN 1 ELSE 0 END AS hasNDelete,
  CASE WHEN COL_LENGTH('dbo.tArtikel','fMindestbestand') IS NOT NULL THEN 1 ELSE 0 END AS hasMindest,
  -- Article support tables
  CASE WHEN OBJECT_ID('dbo.tArtikelBeschreibung') IS NOT NULL THEN 1 ELSE 0 END AS hasTArtBeschr,
  CASE WHEN OBJECT_ID('dbo.tWarengruppe')         IS NOT NULL THEN 1 ELSE 0 END AS hasTWarengruppe,
  -- dbo.tKunde optional columns
  CASE WHEN COL_LENGTH('dbo.tKunde','dGeaendert') IS NOT NULL THEN 1 ELSE 0 END AS hasKundeGeaendert,
  CASE WHEN COL_LENGTH('dbo.tKunde','cKundenNr')  IS NOT NULL THEN 1 ELSE 0 END AS hasKundenNr,
  -- dbo.tRechnungsadresse
  CASE WHEN OBJECT_ID('dbo.tRechnungsadresse') IS NOT NULL THEN 1 ELSE 0 END AS hasTRechnung,
  CASE WHEN COL_LENGTH('dbo.tRechnungsadresse','kRechnungsadresse') IS NOT NULL THEN 1 ELSE 0 END AS hasKRechnung,
  -- dbo.tlagerbestand optional columns
  CASE WHEN COL_LENGTH('dbo.tlagerbestand','kWarenLager')          IS NOT NULL THEN 1 ELSE 0 END AS hasKWarenLager,
  CASE WHEN COL_LENGTH('dbo.tlagerbestand','fInAuftraegen')        IS NOT NULL THEN 1 ELSE 0 END AS hasFInAuftraegen,
  CASE WHEN COL_LENGTH('dbo.tlagerbestand','fVerfuegbarGesperrt')  IS NOT NULL THEN 1 ELSE 0 END AS hasFGesperrt,
  -- Warehouse master table
  CASE WHEN OBJECT_ID('dbo.tWarenLager') IS NOT NULL THEN 1 ELSE 0 END AS hasTWarenLager,
  -- dbo.tPreis (selling prices per article)
  CASE WHEN OBJECT_ID('dbo.tPreis') IS NOT NULL THEN 1 ELSE 0 END AS hasTPreis,
  CASE WHEN COL_LENGTH('dbo.tPreis','fNettoPreis')   IS NOT NULL THEN 1 ELSE 0 END AS hasPreisNetto,
  CASE WHEN COL_LENGTH('dbo.tPreis','kKundengruppe') IS NOT NULL THEN 1 ELSE 0 END AS hasPreisKundengruppe";

            try
            {
                await using var conn = await OpenConnectionAsync(ct);
                await using var cmd = new SqlCommand(sql, conn);
                cmd.CommandTimeout = 30;
                await using var rdr = await cmd.ExecuteReaderAsync(ct);

                _schema = new JtlSchema();
                if (await rdr.ReadAsync(ct))
                {
                    _schema.HasFVersandkostenNetto    = I(rdr, "hasFVersandkosten");
                    _schema.HasCExterneAuftragsnummer = I(rdr, "hasCExtern");
                    _schema.HasKAbfrageStatus         = I(rdr, "hasKAbfrage");
                    _schema.HasKPlattform             = I(rdr, "hasKPlattform");
                    _schema.HasPositionMwSt           = I(rdr, "hasPosMwSt");
                    _schema.HasPositionEkNetto        = I(rdr, "hasPosEk");
                    _schema.HasPositionRabatt         = I(rdr, "hasPosRabatt");
                    _schema.HasTAbfrageStatus         = I(rdr, "hasTAbfrage");
                    _schema.HasTPlattform             = I(rdr, "hasTPlattform");
                    _schema.HasTversandart            = I(rdr, "hasTVersandart");
                    _schema.HasTZahlungsart           = I(rdr, "hasTZahlungsart");
                    _schema.HasArtikelDMod            = I(rdr, "hasArtikelDMod");
                    _schema.HasArtikelBarcode         = I(rdr, "hasBarcode");
                    _schema.HasArtikelGewicht         = I(rdr, "hasGewicht");
                    _schema.HasKVaterArtikel          = I(rdr, "hasKVater");
                    _schema.HasNDelete                = I(rdr, "hasNDelete");
                    _schema.HasFMindestbestand        = I(rdr, "hasMindest");
                    _schema.HasTArtikelBeschreibung   = I(rdr, "hasTArtBeschr");
                    _schema.HasTWarengruppe           = I(rdr, "hasTWarengruppe");
                    _schema.HasKundeGeaendert         = I(rdr, "hasKundeGeaendert");
                    _schema.HasKundenNr               = I(rdr, "hasKundenNr");
                    _schema.HasTRechnungsadresse      = I(rdr, "hasTRechnung");
                    _schema.HasKRechnungsadresse      = I(rdr, "hasKRechnung");
                    _schema.HasKWarenLager            = I(rdr, "hasKWarenLager");
                    _schema.HasFInAuftraegen          = I(rdr, "hasFInAuftraegen");
                    _schema.HasFVerfuegbarGesperrt    = I(rdr, "hasFGesperrt");
                    _schema.HasTWarenLager            = I(rdr, "hasTWarenLager");
                    _schema.HasTPreis                 = I(rdr, "hasTPreis");
                    _schema.HasTPreisNetto            = I(rdr, "hasPreisNetto");
                    _schema.HasTPreisKundengruppe     = I(rdr, "hasPreisKundengruppe");
                }
            }
            catch (Exception ex)
            {
                _log.Warn("MssqlService", $"Schema detection failed, using safe defaults: {ex.Message}");
                _schema = new JtlSchema();
            }

            _log.Info("MssqlService", $"JTL Schema detected: " +
                $"tAbfrageStatus={_schema.HasTAbfrageStatus} | kWarenLager={_schema.HasKWarenLager} | " +
                $"tWarenLager={_schema.HasTWarenLager} | dGeaendert={_schema.HasKundeGeaendert} | " +
                $"fMindestbestand={_schema.HasFMindestbestand} | ArtikelDMod={_schema.HasArtikelDMod} | " +
                $"fVersandkosten={_schema.HasFVersandkostenNetto} | tRechnung={_schema.HasTRechnungsadresse}");

            return _schema;
        }

        // Helper: read int column from reader and return true if == 1
        private static bool I(SqlDataReader r, string col) => Convert.ToInt32(r[col]) == 1;

        // ─────────────────────────────────────────────────────────────────────
        // Connection helpers
        // ─────────────────────────────────────────────────────────────────────
        private async Task<SqlConnection> OpenConnectionAsync(CancellationToken ct = default)
        {
            var cs = _config.BuildConnectionString();
            Exception? lastEx = null;

            for (int attempt = 0; attempt <= RetryDelaysSeconds.Length; attempt++)
            {
                try
                {
                    var conn = new SqlConnection(cs);
                    await conn.OpenAsync(ct);
                    return conn;
                }
                catch (Exception ex) when (!ct.IsCancellationRequested)
                {
                    lastEx = ex;
                    if (attempt < RetryDelaysSeconds.Length)
                    {
                        int delay = RetryDelaysSeconds[attempt];
                        _log.Warn("MssqlService", $"Connection attempt {attempt + 1} failed, retrying in {delay}s: {ex.Message}");
                        await Task.Delay(TimeSpan.FromSeconds(delay), ct);
                    }
                }
            }

            throw new InvalidOperationException(
                $"Failed to connect to SQL Server after {RetryDelaysSeconds.Length + 1} attempts", lastEx);
        }

        public async Task<bool> TestConnectionAsync(CancellationToken ct = default)
        {
            try
            {
                var cs = _config.BuildConnectionString();
                await using var conn = new SqlConnection(cs);
                await conn.OpenAsync(ct);
                ResetSchema();
                return true;
            }
            catch (Exception ex)
            {
                _log.Error("MssqlService", "Connection test failed", ex);
                return false;
            }
        }

        // ─────────────────────────────────────────────────────────────────────
        // Orders — paginated, watermark-filtered
        // ─────────────────────────────────────────────────────────────────────
        public async Task<List<JtlOrder>> GetOrdersPageAsync(
            DateTime lastSyncTime, DateTime syncEndTime, int offset, int batchSize,
            CancellationToken ct = default)
        {
            var s = await EnsureSchemaAsync(ct);

            // Build SELECT columns
            var sel = new StringBuilder();
            sel.Append("a.kAuftrag, a.cAuftragsNr, a.dErstellt, a.kKunde, a.kVersandArt, a.kZahlungsart, a.nStorno");
            sel.Append(s.HasKundenNr               ? ", a.cKundenNr" : ", '' AS cKundenNr");
            sel.Append(s.HasCExterneAuftragsnummer  ? ", a.cExterneAuftragsnummer" : ", '' AS cExterneAuftragsnummer");
            sel.Append(s.HasFVersandkostenNetto     ? ", ISNULL(a.fVersandkostenNetto,0) AS fVersandkostenNetto" : ", 0 AS fVersandkostenNetto");
            sel.Append(s.HasTPlattform && s.HasKPlattform ? ", ISNULL(p.cName,'') AS channel_name" : ", '' AS channel_name");
            sel.Append(s.HasTversandart  ? ", ISNULL(va.cName,'') AS versandart_name"  : ", '' AS versandart_name");
            sel.Append(s.HasTZahlungsart ? ", ISNULL(za.cName,'') AS zahlungsart_name" : ", '' AS zahlungsart_name");
            sel.Append(s.HasTAbfrageStatus && s.HasKAbfrageStatus ? ", ISNULL(tas.cName,'Offen') AS cStatus" : ", 'Offen' AS cStatus");
            sel.Append(s.HasTRechnungsadresse ? ", ISNULL(ra.cPLZ,'') AS cPLZ" : ", '' AS cPLZ");

            // Revenue: use VAT from line if available, else assume 19%
            if (s.HasPositionMwSt)
            {
                sel.Append(", CAST(ROUND(SUM(ISNULL(ap.fVkNetto,0)*ISNULL(ap.fAnzahl,0)*(1+ISNULL(ap.fMwSt,0)/100.0)),2) AS DECIMAL(18,2)) AS fGesamtsumme");
            }
            else
            {
                sel.Append(", CAST(ROUND(SUM(ISNULL(ap.fVkNetto,0)*ISNULL(ap.fAnzahl,0)*1.19),2) AS DECIMAL(18,2)) AS fGesamtsumme");
            }
            sel.Append(", CAST(ROUND(SUM(ISNULL(ap.fVkNetto,0)*ISNULL(ap.fAnzahl,0)),2) AS DECIMAL(18,2)) AS fGesamtsummeNetto");

            // Build JOINs
            var joins = new StringBuilder();
            joins.AppendLine("LEFT JOIN Verkauf.tAuftragPosition ap WITH (NOLOCK) ON ap.kAuftrag=a.kAuftrag AND ap.nType=1");
            if (s.HasTPlattform && s.HasKPlattform)
                joins.AppendLine("LEFT JOIN dbo.tPlattform p WITH (NOLOCK) ON p.nPlattform=a.kPlattform");
            if (s.HasTversandart)
                joins.AppendLine("LEFT JOIN dbo.tversandart va WITH (NOLOCK) ON va.kVersandArt=a.kVersandArt");
            if (s.HasTZahlungsart)
                joins.AppendLine("LEFT JOIN dbo.tZahlungsart za WITH (NOLOCK) ON za.kZahlungsart=a.kZahlungsart");
            if (s.HasTAbfrageStatus && s.HasKAbfrageStatus)
                joins.AppendLine("LEFT JOIN dbo.tAbfrageStatus tas WITH (NOLOCK) ON tas.kAbfrageStatus=a.kAbfrageStatus");
            if (s.HasTRechnungsadresse)
            {
                var orderBy = s.HasKRechnungsadresse ? "ORDER BY kRechnungsadresse DESC" : "";
                joins.AppendLine($@"OUTER APPLY (
    SELECT TOP 1 ISNULL(r.cPLZ,'') AS cPLZ
    FROM dbo.tRechnungsadresse r WITH (NOLOCK)
    WHERE r.kKunde=a.kKunde {orderBy}
) ra");
            }

            // Build GROUP BY (only columns that actually exist)
            var gb = new StringBuilder("a.kAuftrag, a.cAuftragsNr, a.dErstellt, a.kKunde, a.kVersandArt, a.kZahlungsart, a.nStorno");
            if (s.HasKundenNr)               gb.Append(", a.cKundenNr");
            if (s.HasCExterneAuftragsnummer)  gb.Append(", a.cExterneAuftragsnummer");
            if (s.HasFVersandkostenNetto)     gb.Append(", a.fVersandkostenNetto");
            if (s.HasTPlattform && s.HasKPlattform) gb.Append(", p.cName");
            if (s.HasTversandart)             gb.Append(", va.cName");
            if (s.HasTZahlungsart)            gb.Append(", za.cName");
            if (s.HasTAbfrageStatus && s.HasKAbfrageStatus) gb.Append(", tas.cName");
            if (s.HasTRechnungsadresse)       gb.Append(", ra.cPLZ");

            var sql = $@"
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
SELECT {sel}
FROM Verkauf.tAuftrag a WITH (NOLOCK)
{joins}
WHERE ISNULL(a.nStorno,0)=0
  AND a.dErstellt>=@lastSyncTime
  AND a.dErstellt<@syncEndTime
GROUP BY {gb}
ORDER BY a.dErstellt ASC
OFFSET @offset ROWS FETCH NEXT @batchSize ROWS ONLY";

            await using var conn = await OpenConnectionAsync(ct);
            await using var cmd = new SqlCommand(sql, conn);
            cmd.CommandTimeout = 120;
            cmd.Parameters.AddWithValue("@lastSyncTime", lastSyncTime);
            cmd.Parameters.AddWithValue("@syncEndTime", syncEndTime);
            cmd.Parameters.AddWithValue("@offset", offset);
            cmd.Parameters.AddWithValue("@batchSize", batchSize);

            var orders = new List<JtlOrder>();
            await using var rdr = await cmd.ExecuteReaderAsync(ct);
            while (await rdr.ReadAsync(ct))
            {
                orders.Add(new JtlOrder
                {
                    KAuftrag               = Convert.ToInt64(rdr["kAuftrag"]),
                    CAuftragsNr            = rdr["cAuftragsNr"]?.ToString() ?? "",
                    DErstellt              = rdr["dErstellt"] == DBNull.Value ? DateTime.MinValue : Convert.ToDateTime(rdr["dErstellt"]),
                    KKunde                 = rdr["kKunde"] == DBNull.Value ? 0 : Convert.ToInt64(rdr["kKunde"]),
                    CKundenNr              = rdr["cKundenNr"]?.ToString() ?? "",
                    CExterneAuftragsnummer = rdr["cExterneAuftragsnummer"]?.ToString() ?? "",
                    KVersandArt            = rdr["kVersandArt"] == DBNull.Value ? 0 : Convert.ToInt32(rdr["kVersandArt"]),
                    KZahlungsart           = rdr["kZahlungsart"] == DBNull.Value ? 0 : Convert.ToInt32(rdr["kZahlungsart"]),
                    NStorno                = rdr["nStorno"] == DBNull.Value ? 0 : Convert.ToInt32(rdr["nStorno"]),
                    FVersandkostenNetto    = rdr["fVersandkostenNetto"] == DBNull.Value ? 0m : Convert.ToDecimal(rdr["fVersandkostenNetto"]),
                    ChannelName            = rdr["channel_name"]?.ToString() ?? "",
                    VersandartName         = rdr["versandart_name"]?.ToString() ?? "",
                    ZahlungsartName        = rdr["zahlungsart_name"]?.ToString() ?? "",
                    CStatus                = rdr["cStatus"]?.ToString() ?? "Offen",
                    CPLZ                   = rdr["cPLZ"]?.ToString() ?? "",
                    FGesamtsumme           = rdr["fGesamtsumme"] == DBNull.Value ? 0m : Convert.ToDecimal(rdr["fGesamtsumme"]),
                    FGesamtsummeNetto      = rdr["fGesamtsummeNetto"] == DBNull.Value ? 0m : Convert.ToDecimal(rdr["fGesamtsummeNetto"])
                });
            }

            return orders;
        }

        // ─────────────────────────────────────────────────────────────────────
        // Order items — fetched per batch of order IDs
        // ─────────────────────────────────────────────────────────────────────
        public async Task<List<JtlOrderItem>> GetOrderItemsAsync(
            IEnumerable<long> orderIds, CancellationToken ct = default)
        {
            var idList = string.Join(",", orderIds);
            if (string.IsNullOrEmpty(idList)) return new List<JtlOrderItem>();

            var s = await EnsureSchemaAsync(ct);

            // Compute revenue with or without VAT column
            var grossExpr = s.HasPositionMwSt
                ? "ISNULL(ap.fVkNetto,0)*(1+ISNULL(ap.fMwSt,0)/100.0)"
                : "ISNULL(ap.fVkNetto,0)*1.19";

            var ekCol     = s.HasPositionEkNetto ? "ISNULL(ap.fEkNetto,0)" : "0";
            var rabattCol = s.HasPositionRabatt  ? "ISNULL(ap.fRabatt,0)"  : "0";

            var sql = $@"
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
SELECT ap.kAuftragPosition, ap.kAuftrag,
    ISNULL(ap.kArtikel,0)           AS kArtikel,
    ISNULL(ap.fAnzahl,0)            AS fAnzahl,
    ISNULL(ap.fVkNetto,0)           AS fVkNetto,
    {grossExpr}                     AS fVkBrutto,
    {ekCol}                         AS fEkNetto,
    {rabattCol}                     AS fRabatt,
    ISNULL(ap.cName,ap.cArtNr)      AS cName,
    ap.cArtNr
FROM Verkauf.tAuftragPosition ap WITH (NOLOCK)
WHERE ap.kAuftrag IN ({idList}) AND ap.nType=1";

            await using var conn = await OpenConnectionAsync(ct);
            await using var cmd = new SqlCommand(sql, conn);
            cmd.CommandTimeout = 120;

            var items = new List<JtlOrderItem>();
            await using var rdr = await cmd.ExecuteReaderAsync(ct);
            while (await rdr.ReadAsync(ct))
            {
                items.Add(new JtlOrderItem
                {
                    KAuftragPosition = Convert.ToInt64(rdr["kAuftragPosition"]),
                    KAuftrag         = Convert.ToInt64(rdr["kAuftrag"]),
                    KArtikel         = Convert.ToInt64(rdr["kArtikel"]),
                    FAnzahl          = Convert.ToDecimal(rdr["fAnzahl"]),
                    FVkNetto         = Convert.ToDecimal(rdr["fVkNetto"]),
                    FVkBrutto        = Convert.ToDecimal(rdr["fVkBrutto"]),
                    FEkNetto         = Convert.ToDecimal(rdr["fEkNetto"]),
                    FRabatt          = Convert.ToDecimal(rdr["fRabatt"]),
                    CName            = rdr["cName"]?.ToString() ?? "",
                    CArtNr           = rdr["cArtNr"]?.ToString() ?? ""
                });
            }

            return items;
        }

        // ─────────────────────────────────────────────────────────────────────
        // Products
        // ─────────────────────────────────────────────────────────────────────
        public async Task<List<JtlProduct>> GetProductsAsync(
            DateTime lastSyncTime, CancellationToken ct = default)
        {
            var s = await EnsureSchemaAsync(ct);

            // SELECT columns that might be absent
            var barcodeCol  = s.HasArtikelBarcode ? "a.cBarcode"           : "'' AS cBarcode";
            var gewichtCol  = s.HasArtikelGewicht ? "ISNULL(a.fGewicht,0)" : "0";
            var dModCol     = s.HasArtikelDMod    ? "a.dMod"               : "NULL AS dMod";

            // Article description JOIN
            var beschrJoin = s.HasTArtikelBeschreibung
                ? "LEFT JOIN dbo.tArtikelBeschreibung ab WITH (NOLOCK) ON ab.kArtikel=a.kArtikel AND ab.kSprache=1 AND ab.kPlattform=1"
                : "";
            var nameExpr = s.HasTArtikelBeschreibung ? "ISNULL(ab.cName,a.cArtNr)" : "a.cArtNr";

            // Category JOIN
            var warenGruppeJoin = s.HasTWarengruppe
                ? "LEFT JOIN dbo.tWarengruppe wg WITH (NOLOCK) ON wg.kWarengruppe=a.kWarengruppe"
                : "";
            var catName = s.HasTWarengruppe ? "ISNULL(wg.cName,'')" : "''";

            // Stock from inventory — OUTER APPLY with optional ORDER BY
            var lbOrderBy = s.HasKWarenLager ? "ORDER BY kWarenLager ASC" : "";
            var stockApply = @$"
OUTER APPLY (
    SELECT TOP 1 ISNULL(fVerfuegbar,0) AS fVerfuegbar
    FROM dbo.tlagerbestand WITH (NOLOCK)
    WHERE kArtikel=a.kArtikel
    {lbOrderBy}
) lb";

            // Selling price from tPreis (preferred over tArtikel.fVKNetto which is often 0)
            var preisJoin = "";
            var vkNettoExpr = "ISNULL(a.fVKNetto,0)";
            if (s.HasTPreis && s.HasTPreisNetto)
            {
                var kgFilter = s.HasTPreisKundengruppe ? "AND kKundengruppe=0" : "";
                preisJoin = $@"
OUTER APPLY (
    SELECT TOP 1 ISNULL(fNettoPreis,0) AS fPreisNetto
    FROM dbo.tPreis WITH (NOLOCK)
    WHERE kArtikel=a.kArtikel {kgFilter}
    ORDER BY kPreis ASC
) pr";
                vkNettoExpr = "COALESCE(NULLIF(pr.fPreisNetto,0), ISNULL(a.fVKNetto,0))";
            }

            // WHERE filters: only add kVaterArtikel/nDelete if columns exist
            var whereFilter = new StringBuilder("a.cArtNr IS NOT NULL AND a.cArtNr<>''");
            if (s.HasKVaterArtikel) whereFilter.Append(" AND a.kVaterArtikel=0");
            if (s.HasNDelete)       whereFilter.Append(" AND a.nDelete=0");
            // Modified-date filter: if column exists use it, else sync everything
            if (s.HasArtikelDMod)
                whereFilter.Append(" AND (a.dMod IS NULL OR a.dMod>=@lastSyncTime)");

            var sql = $@"
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
SELECT a.kArtikel, a.cArtNr,
    {nameExpr}                         AS cName,
    ISNULL(a.fEKNetto,0)               AS fEKNetto,
    {vkNettoExpr}                      AS fVKNetto,
    ROUND({vkNettoExpr}*1.19,2)        AS fVKBrutto,
    {gewichtCol}                       AS fGewicht,
    {barcodeCol},
    {dModCol},
    ISNULL(a.kWarengruppe,0)           AS kWarengruppe,
    {catName}                          AS category_name,
    ISNULL(lb.fVerfuegbar,0)           AS fVerfuegbar
FROM dbo.tArtikel a WITH (NOLOCK)
{beschrJoin}
{stockApply}
{preisJoin}
{warenGruppeJoin}
WHERE {whereFilter}";

            await using var conn = await OpenConnectionAsync(ct);
            await using var cmd = new SqlCommand(sql, conn);
            cmd.CommandTimeout = 180;
            cmd.Parameters.AddWithValue("@lastSyncTime", lastSyncTime);

            var products = new List<JtlProduct>();
            await using var rdr = await cmd.ExecuteReaderAsync(ct);
            while (await rdr.ReadAsync(ct))
            {
                products.Add(new JtlProduct
                {
                    KArtikel     = Convert.ToInt64(rdr["kArtikel"]),
                    CArtNr       = rdr["cArtNr"]?.ToString() ?? "",
                    CName        = rdr["cName"]?.ToString() ?? "",
                    FEKNetto     = Convert.ToDecimal(rdr["fEKNetto"]),
                    FVKNetto     = Convert.ToDecimal(rdr["fVKNetto"]),
                    FVKBrutto    = Convert.ToDecimal(rdr["fVKBrutto"]),
                    FGewicht     = Convert.ToDecimal(rdr["fGewicht"]),
                    CBarcode     = rdr["cBarcode"]?.ToString() ?? "",
                    DMod         = rdr["dMod"] == DBNull.Value ? DateTime.MinValue : Convert.ToDateTime(rdr["dMod"]),
                    KWarengruppe = rdr["kWarengruppe"] == DBNull.Value ? 0 : Convert.ToInt32(rdr["kWarengruppe"]),
                    CategoryName = rdr["category_name"]?.ToString() ?? "",
                    FVerfuegbar  = Convert.ToDecimal(rdr["fVerfuegbar"])
                });
            }

            return products;
        }

        // ─────────────────────────────────────────────────────────────────────
        // Customers
        // ─────────────────────────────────────────────────────────────────────
        public async Task<List<JtlCustomer>> GetCustomersAsync(
            DateTime lastSyncTime, CancellationToken ct = default)
        {
            var s = await EnsureSchemaAsync(ct);

            // If dGeaendert doesn't exist, fall back to dErstellt for watermark filtering
            var dateCol    = s.HasKundeGeaendert ? "k.dGeaendert" : "k.dErstellt";
            var dateSelect = s.HasKundeGeaendert
                ? "k.dErstellt, k.dGeaendert"
                : "k.dErstellt, k.dErstellt AS dGeaendert";
            var kundenNrSelect = s.HasKundenNr ? "k.cKundenNr" : "'' AS cKundenNr";

            // Billing address join: OUTER APPLY to get one row per customer
            string addrJoin, addrSelect;
            if (s.HasTRechnungsadresse)
            {
                var orderBy = s.HasKRechnungsadresse ? "ORDER BY kRechnungsadresse DESC" : "";
                addrJoin = $@"
OUTER APPLY (
    SELECT TOP 1 cMail, cVorname, cName, cFirma, cPLZ, cOrt, cLand
    FROM dbo.tRechnungsadresse WITH (NOLOCK)
    WHERE kKunde=k.kKunde {orderBy}
) r";
                addrSelect = "ISNULL(r.cMail,'') AS cMail, ISNULL(r.cVorname,'') AS cVorname, " +
                             "ISNULL(r.cName,'') AS cNachname, ISNULL(r.cFirma,'') AS cFirma, " +
                             "ISNULL(r.cPLZ,'') AS cPLZ, ISNULL(r.cOrt,'') AS cOrt, " +
                             "ISNULL(r.cLand,'DE') AS cLand,";
            }
            else
            {
                // No billing address table — use whatever is on tKunde directly if available
                addrJoin = "";
                addrSelect = "'' AS cMail, '' AS cVorname, '' AS cNachname, '' AS cFirma, " +
                             "'' AS cPLZ, '' AS cOrt, 'DE' AS cLand,";
            }

            var sql = $@"
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
SELECT k.kKunde, {kundenNrSelect},
    {addrSelect}
    {dateSelect}
FROM dbo.tKunde k WITH (NOLOCK)
{addrJoin}
WHERE {dateCol}>=@lastSyncTime";

            await using var conn = await OpenConnectionAsync(ct);
            await using var cmd = new SqlCommand(sql, conn);
            cmd.CommandTimeout = 120;
            cmd.Parameters.AddWithValue("@lastSyncTime", lastSyncTime);

            var customers = new List<JtlCustomer>();
            await using var rdr = await cmd.ExecuteReaderAsync(ct);
            while (await rdr.ReadAsync(ct))
            {
                customers.Add(new JtlCustomer
                {
                    KKunde     = Convert.ToInt64(rdr["kKunde"]),
                    CKundenNr  = rdr["cKundenNr"]?.ToString() ?? "",
                    CMail      = rdr["cMail"]?.ToString() ?? "",
                    CVorname   = rdr["cVorname"]?.ToString() ?? "",
                    CNachname  = rdr["cNachname"]?.ToString() ?? "",
                    CFirma     = rdr["cFirma"]?.ToString() ?? "",
                    CPLZ       = rdr["cPLZ"]?.ToString() ?? "",
                    COrt       = rdr["cOrt"]?.ToString() ?? "",
                    CLand      = rdr["cLand"]?.ToString() ?? "DE",
                    DErstellt  = rdr["dErstellt"]  == DBNull.Value ? DateTime.MinValue : Convert.ToDateTime(rdr["dErstellt"]),
                    DGeaendert = rdr["dGeaendert"] == DBNull.Value ? DateTime.MinValue : Convert.ToDateTime(rdr["dGeaendert"])
                });
            }

            return customers;
        }

        // ─────────────────────────────────────────────────────────────────────
        // Inventory — full snapshot
        //
        // KEY FIX: When kWarenLager EXISTS, tlagerbestand already has one row
        // per (article, warehouse) — no GROUP BY needed, join directly.
        // When kWarenLager is ABSENT, aggregate with GROUP BY to handle any
        // duplicate rows per article.
        // This also fixes the previous GROUP BY bug where joined columns
        // (wl.cName, a.fMindestbestand) were in SELECT but not in GROUP BY.
        // ─────────────────────────────────────────────────────────────────────
        public async Task<List<JtlInventory>> GetInventoryAsync(CancellationToken ct = default)
        {
            var s = await EnsureSchemaAsync(ct);

            string sql;

            if (s.HasKWarenLager)
            {
                // ── Per-warehouse rows — no aggregation needed ─────────────
                var warehouseNameExpr = s.HasTWarenLager
                    ? "ISNULL(wl.cName,'Default')"
                    : "'Default'";
                var warehouseJoin = s.HasTWarenLager
                    ? "LEFT JOIN dbo.tWarenLager wl WITH (NOLOCK) ON wl.kWarenLager=lb.kWarenLager"
                    : "";

                var reservedCol = s.HasFInAuftraegen      ? "ISNULL(lb.fInAuftraegen,0)"       : "0";
                var gesperrtCol = s.HasFVerfuegbarGesperrt ? "ISNULL(lb.fVerfuegbarGesperrt,0)" : "0";

                var mindestExpr  = s.HasFMindestbestand ? "ISNULL(a.fMindestbestand,0)" : "0";
                var artikelJoin2 = s.HasFMindestbestand
                    ? "LEFT JOIN dbo.tArtikel a WITH (NOLOCK) ON a.kArtikel=lb.kArtikel"
                    : "";

                sql = $@"
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
SELECT lb.kArtikel, lb.kWarenLager,
    {warehouseNameExpr}              AS warehouse_name,
    {mindestExpr}                    AS fMindestbestand,
    ISNULL(lb.fVerfuegbar,0)         AS fVerfuegbar,
    {reservedCol}                    AS fReserviert,
    ISNULL(lb.fLagerbestand,0)       AS fGesamt,
    {gesperrtCol}                    AS fGesperrt
FROM dbo.tlagerbestand lb WITH (NOLOCK)
{warehouseJoin}
{artikelJoin2}
WHERE lb.kArtikel IS NOT NULL";
            }
            else
            {
                // ── No per-warehouse column — aggregate per article ─────────
                var reservedAgg = s.HasFInAuftraegen       ? "ISNULL(SUM(lb.fInAuftraegen),0)"       : "0";
                var gesperrtAgg = s.HasFVerfuegbarGesperrt ? "ISNULL(SUM(lb.fVerfuegbarGesperrt),0)" : "0";

                // fMindestbestand comes from tArtikel (one per article) — safe to MAX()
                var mindestAgg  = s.HasFMindestbestand ? "ISNULL(MAX(a.fMindestbestand),0)" : "0";
                var artikelJoin3 = s.HasFMindestbestand
                    ? "LEFT JOIN dbo.tArtikel a WITH (NOLOCK) ON a.kArtikel=lb.kArtikel"
                    : "";

                sql = $@"
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
SELECT lb.kArtikel, 0 AS kWarenLager,
    'Default'                        AS warehouse_name,
    {mindestAgg}                     AS fMindestbestand,
    ISNULL(SUM(lb.fVerfuegbar),0)    AS fVerfuegbar,
    {reservedAgg}                    AS fReserviert,
    ISNULL(SUM(lb.fLagerbestand),0)  AS fGesamt,
    {gesperrtAgg}                    AS fGesperrt
FROM dbo.tlagerbestand lb WITH (NOLOCK)
{artikelJoin3}
WHERE lb.kArtikel IS NOT NULL
GROUP BY lb.kArtikel";
            }

            await using var conn = await OpenConnectionAsync(ct);
            await using var cmd  = new SqlCommand(sql, conn);
            cmd.CommandTimeout = 120;

            var inventory = new List<JtlInventory>();
            await using var rdr = await cmd.ExecuteReaderAsync(ct);
            while (await rdr.ReadAsync(ct))
            {
                inventory.Add(new JtlInventory
                {
                    KArtikel        = Convert.ToInt64(rdr["kArtikel"]),
                    KWarenLager     = Convert.ToInt32(rdr["kWarenLager"]),
                    WarehouseName   = rdr["warehouse_name"]?.ToString() ?? "Default",
                    FVerfuegbar     = Convert.ToDecimal(rdr["fVerfuegbar"]),
                    FReserviert     = Convert.ToDecimal(rdr["fReserviert"]),
                    FGesamt         = Convert.ToDecimal(rdr["fGesamt"]),
                    FGesperrt       = Convert.ToDecimal(rdr["fGesperrt"]),
                    FMindestbestand = rdr["fMindestbestand"] == DBNull.Value ? 0m : Convert.ToDecimal(rdr["fMindestbestand"])
                });
            }

            return inventory;
        }

        // ─────────────────────────────────────────────────────────────────────
        // Orders count — for pagination, no schema-variable columns
        // ─────────────────────────────────────────────────────────────────────
        public async Task<int> GetOrdersCountAsync(
            DateTime lastSyncTime, DateTime syncEndTime, CancellationToken ct = default)
        {
            const string sql = @"
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
SELECT COUNT(*) FROM Verkauf.tAuftrag a WITH (NOLOCK)
WHERE ISNULL(a.nStorno,0)=0
  AND a.dErstellt>=@lastSyncTime
  AND a.dErstellt<@syncEndTime";

            await using var conn = await OpenConnectionAsync(ct);
            await using var cmd  = new SqlCommand(sql, conn);
            cmd.CommandTimeout = 60;
            cmd.Parameters.AddWithValue("@lastSyncTime", lastSyncTime);
            cmd.Parameters.AddWithValue("@syncEndTime", syncEndTime);
            return Convert.ToInt32(await cmd.ExecuteScalarAsync(ct));
        }

        // ─────────────────────────────────────────────────────────────────────
        // Products count — for SQL-side pagination (avoids loading all into RAM)
        // ─────────────────────────────────────────────────────────────────────
        public async Task<int> GetProductsCountAsync(
            DateTime lastSyncTime, CancellationToken ct = default)
        {
            var s = await EnsureSchemaAsync(ct);
            var whereFilter = new StringBuilder("a.cArtNr IS NOT NULL AND a.cArtNr<>''");
            if (s.HasKVaterArtikel) whereFilter.Append(" AND a.kVaterArtikel=0");
            if (s.HasNDelete)       whereFilter.Append(" AND a.nDelete=0");
            if (s.HasArtikelDMod)   whereFilter.Append(" AND (a.dMod IS NULL OR a.dMod>=@lastSyncTime)");

            var sql = $@"
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
SELECT COUNT(*) FROM dbo.tArtikel a WITH (NOLOCK)
WHERE {whereFilter}";

            await using var conn = await OpenConnectionAsync(ct);
            await using var cmd  = new SqlCommand(sql, conn);
            cmd.CommandTimeout = 60;
            cmd.Parameters.AddWithValue("@lastSyncTime", lastSyncTime);
            return Convert.ToInt32(await cmd.ExecuteScalarAsync(ct));
        }

        // ─────────────────────────────────────────────────────────────────────
        // Products — paged version so RAM usage is bounded to one page at a time
        // ─────────────────────────────────────────────────────────────────────
        public async Task<List<JtlProduct>> GetProductsPageAsync(
            DateTime lastSyncTime, int offset, int batchSize, CancellationToken ct = default)
        {
            var s = await EnsureSchemaAsync(ct);

            var barcodeCol  = s.HasArtikelBarcode ? "a.cBarcode"           : "'' AS cBarcode";
            var gewichtCol  = s.HasArtikelGewicht ? "ISNULL(a.fGewicht,0)" : "0";
            var dModCol     = s.HasArtikelDMod    ? "a.dMod"               : "NULL AS dMod";
            var beschrJoin  = s.HasTArtikelBeschreibung
                ? "LEFT JOIN dbo.tArtikelBeschreibung ab WITH (NOLOCK) ON ab.kArtikel=a.kArtikel AND ab.kSprache=1 AND ab.kPlattform=1"
                : "";
            var nameExpr    = s.HasTArtikelBeschreibung ? "ISNULL(ab.cName,a.cArtNr)" : "a.cArtNr";
            var warenGruppeJoin = s.HasTWarengruppe
                ? "LEFT JOIN dbo.tWarengruppe wg WITH (NOLOCK) ON wg.kWarengruppe=a.kWarengruppe"
                : "";
            var catName     = s.HasTWarengruppe ? "ISNULL(wg.cName,'')" : "''";
            var lbOrderBy   = s.HasKWarenLager ? "ORDER BY kWarenLager ASC" : "";
            var whereFilter = new StringBuilder("a.cArtNr IS NOT NULL AND a.cArtNr<>''");
            if (s.HasKVaterArtikel) whereFilter.Append(" AND a.kVaterArtikel=0");
            if (s.HasNDelete)       whereFilter.Append(" AND a.nDelete=0");
            if (s.HasArtikelDMod)   whereFilter.Append(" AND (a.dMod IS NULL OR a.dMod>=@lastSyncTime)");

            var sql = $@"
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
SELECT a.kArtikel, a.cArtNr,
    {nameExpr}              AS cName,
    ISNULL(a.fEKNetto,0)    AS fEKNetto,
    ISNULL(a.fVKNetto,0)    AS fVKNetto,
    ROUND(ISNULL(a.fVKNetto,0)*1.19,2) AS fVKBrutto,
    {gewichtCol}            AS fGewicht,
    {barcodeCol},
    {dModCol},
    ISNULL(a.kWarengruppe,0) AS kWarengruppe,
    {catName}               AS category_name,
    ISNULL(lb.fVerfuegbar,0) AS fVerfuegbar
FROM dbo.tArtikel a WITH (NOLOCK)
{beschrJoin}
OUTER APPLY (
    SELECT TOP 1 ISNULL(fVerfuegbar,0) AS fVerfuegbar
    FROM dbo.tlagerbestand WITH (NOLOCK)
    WHERE kArtikel=a.kArtikel
    {lbOrderBy}
) lb
{warenGruppeJoin}
WHERE {whereFilter}
ORDER BY a.kArtikel ASC
OFFSET @offset ROWS FETCH NEXT @batchSize ROWS ONLY";

            await using var conn = await OpenConnectionAsync(ct);
            await using var cmd  = new SqlCommand(sql, conn);
            cmd.CommandTimeout = 180;
            cmd.Parameters.AddWithValue("@lastSyncTime", lastSyncTime);
            cmd.Parameters.AddWithValue("@offset", offset);
            cmd.Parameters.AddWithValue("@batchSize", batchSize);

            var products = new List<JtlProduct>();
            await using var rdr = await cmd.ExecuteReaderAsync(ct);
            while (await rdr.ReadAsync(ct))
            {
                products.Add(new JtlProduct
                {
                    KArtikel     = Convert.ToInt64(rdr["kArtikel"]),
                    CArtNr       = rdr["cArtNr"]?.ToString() ?? "",
                    CName        = rdr["cName"]?.ToString() ?? "",
                    FEKNetto     = Convert.ToDecimal(rdr["fEKNetto"]),
                    FVKNetto     = Convert.ToDecimal(rdr["fVKNetto"]),
                    FVKBrutto    = Convert.ToDecimal(rdr["fVKBrutto"]),
                    FGewicht     = Convert.ToDecimal(rdr["fGewicht"]),
                    CBarcode     = rdr["cBarcode"]?.ToString() ?? "",
                    DMod         = rdr["dMod"] == DBNull.Value ? DateTime.MinValue : Convert.ToDateTime(rdr["dMod"]),
                    KWarengruppe = rdr["kWarengruppe"] == DBNull.Value ? 0 : Convert.ToInt32(rdr["kWarengruppe"]),
                    CategoryName = rdr["category_name"]?.ToString() ?? "",
                    FVerfuegbar  = Convert.ToDecimal(rdr["fVerfuegbar"])
                });
            }

            return products;
        }

        // ─────────────────────────────────────────────────────────────────────
        // Customers count
        // ─────────────────────────────────────────────────────────────────────
        public async Task<int> GetCustomersCountAsync(
            DateTime lastSyncTime, CancellationToken ct = default)
        {
            var s = await EnsureSchemaAsync(ct);
            var dateCol = s.HasKundeGeaendert ? "k.dGeaendert" : "k.dErstellt";

            var sql = $@"
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
SELECT COUNT(*) FROM dbo.tKunde k WITH (NOLOCK)
WHERE {dateCol}>=@lastSyncTime";

            await using var conn = await OpenConnectionAsync(ct);
            await using var cmd  = new SqlCommand(sql, conn);
            cmd.CommandTimeout = 60;
            cmd.Parameters.AddWithValue("@lastSyncTime", lastSyncTime);
            return Convert.ToInt32(await cmd.ExecuteScalarAsync(ct));
        }

        // ─────────────────────────────────────────────────────────────────────
        // Customers — paged version
        // ─────────────────────────────────────────────────────────────────────
        public async Task<List<JtlCustomer>> GetCustomersPageAsync(
            DateTime lastSyncTime, int offset, int batchSize, CancellationToken ct = default)
        {
            var s = await EnsureSchemaAsync(ct);

            var dateCol       = s.HasKundeGeaendert ? "k.dGeaendert" : "k.dErstellt";
            var dateSelect    = s.HasKundeGeaendert
                ? "k.dErstellt, k.dGeaendert"
                : "k.dErstellt, k.dErstellt AS dGeaendert";
            var kundenNrSelect = s.HasKundenNr ? "k.cKundenNr" : "'' AS cKundenNr";

            string addrJoin, addrSelect;
            if (s.HasTRechnungsadresse)
            {
                var orderBy = s.HasKRechnungsadresse ? "ORDER BY kRechnungsadresse DESC" : "";
                addrJoin = $@"
OUTER APPLY (
    SELECT TOP 1 cMail, cVorname, cName, cFirma, cPLZ, cOrt, cLand
    FROM dbo.tRechnungsadresse WITH (NOLOCK)
    WHERE kKunde=k.kKunde {orderBy}
) r";
                addrSelect = "ISNULL(r.cMail,'') AS cMail, ISNULL(r.cVorname,'') AS cVorname, " +
                             "ISNULL(r.cName,'') AS cNachname, ISNULL(r.cFirma,'') AS cFirma, " +
                             "ISNULL(r.cPLZ,'') AS cPLZ, ISNULL(r.cOrt,'') AS cOrt, " +
                             "ISNULL(r.cLand,'DE') AS cLand,";
            }
            else
            {
                addrJoin   = "";
                addrSelect = "'' AS cMail, '' AS cVorname, '' AS cNachname, '' AS cFirma, " +
                             "'' AS cPLZ, '' AS cOrt, 'DE' AS cLand,";
            }

            var sql = $@"
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
SELECT k.kKunde, {kundenNrSelect},
    {addrSelect}
    {dateSelect}
FROM dbo.tKunde k WITH (NOLOCK)
{addrJoin}
WHERE {dateCol}>=@lastSyncTime
ORDER BY k.kKunde ASC
OFFSET @offset ROWS FETCH NEXT @batchSize ROWS ONLY";

            await using var conn = await OpenConnectionAsync(ct);
            await using var cmd  = new SqlCommand(sql, conn);
            cmd.CommandTimeout = 120;
            cmd.Parameters.AddWithValue("@lastSyncTime", lastSyncTime);
            cmd.Parameters.AddWithValue("@offset", offset);
            cmd.Parameters.AddWithValue("@batchSize", batchSize);

            var customers = new List<JtlCustomer>();
            await using var rdr = await cmd.ExecuteReaderAsync(ct);
            while (await rdr.ReadAsync(ct))
            {
                customers.Add(new JtlCustomer
                {
                    KKunde     = Convert.ToInt64(rdr["kKunde"]),
                    CKundenNr  = rdr["cKundenNr"]?.ToString() ?? "",
                    CMail      = rdr["cMail"]?.ToString() ?? "",
                    CVorname   = rdr["cVorname"]?.ToString() ?? "",
                    CNachname  = rdr["cNachname"]?.ToString() ?? "",
                    CFirma     = rdr["cFirma"]?.ToString() ?? "",
                    CPLZ       = rdr["cPLZ"]?.ToString() ?? "",
                    COrt       = rdr["cOrt"]?.ToString() ?? "",
                    CLand      = rdr["cLand"]?.ToString() ?? "DE",
                    DErstellt  = rdr["dErstellt"]  == DBNull.Value ? DateTime.MinValue : Convert.ToDateTime(rdr["dErstellt"]),
                    DGeaendert = rdr["dGeaendert"] == DBNull.Value ? DateTime.MinValue : Convert.ToDateTime(rdr["dGeaendert"])
                });
            }

            return customers;
        }

        // ─────────────────────────────────────────────────────────────────────
        // Inventory count
        // ─────────────────────────────────────────────────────────────────────
        public async Task<int> GetInventoryCountAsync(CancellationToken ct = default)
        {
            const string sql = @"
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
SELECT COUNT(*) FROM dbo.tlagerbestand lb WITH (NOLOCK)";

            await using var conn = await OpenConnectionAsync(ct);
            await using var cmd  = new SqlCommand(sql, conn);
            cmd.CommandTimeout = 60;
            return Convert.ToInt32(await cmd.ExecuteScalarAsync(ct));
        }

        // ─────────────────────────────────────────────────────────────────────
        // Inventory — paged version
        // ─────────────────────────────────────────────────────────────────────
        public async Task<List<JtlInventory>> GetInventoryPageAsync(
            int offset, int batchSize, CancellationToken ct = default)
        {
            var s = await EnsureSchemaAsync(ct);

            string sql;

            if (s.HasKWarenLager)
            {
                var warehouseNameExpr = s.HasTWarenLager ? "ISNULL(wl.cName,'Default')" : "'Default'";
                var warehouseJoin     = s.HasTWarenLager
                    ? "LEFT JOIN dbo.tWarenLager wl WITH (NOLOCK) ON wl.kWarenLager=lb.kWarenLager" : "";
                var reservedCol  = s.HasFInAuftraegen       ? "ISNULL(lb.fInAuftraegen,0)"       : "0";
                var gesperrtCol  = s.HasFVerfuegbarGesperrt ? "ISNULL(lb.fVerfuegbarGesperrt,0)" : "0";
                var mindestExpr  = s.HasFMindestbestand ? "ISNULL(a.fMindestbestand,0)" : "0";
                var artikelJoin  = s.HasFMindestbestand
                    ? "LEFT JOIN dbo.tArtikel a WITH (NOLOCK) ON a.kArtikel=lb.kArtikel" : "";

                sql = $@"
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
SELECT lb.kArtikel, lb.kWarenLager,
    {warehouseNameExpr}              AS warehouse_name,
    {mindestExpr}                    AS fMindestbestand,
    ISNULL(lb.fVerfuegbar,0)         AS fVerfuegbar,
    {reservedCol}                    AS fReserviert,
    ISNULL(lb.fLagerbestand,0)       AS fGesamt,
    {gesperrtCol}                    AS fGesperrt
FROM dbo.tlagerbestand lb WITH (NOLOCK)
{warehouseJoin}
{artikelJoin}
WHERE lb.kArtikel IS NOT NULL
ORDER BY lb.kArtikel ASC
OFFSET @offset ROWS FETCH NEXT @batchSize ROWS ONLY";
            }
            else
            {
                var reservedAgg  = s.HasFInAuftraegen       ? "ISNULL(SUM(lb.fInAuftraegen),0)"       : "0";
                var gesperrtAgg  = s.HasFVerfuegbarGesperrt ? "ISNULL(SUM(lb.fVerfuegbarGesperrt),0)" : "0";
                var mindestAgg   = s.HasFMindestbestand ? "ISNULL(MAX(a.fMindestbestand),0)" : "0";
                var artikelJoin2 = s.HasFMindestbestand
                    ? "LEFT JOIN dbo.tArtikel a WITH (NOLOCK) ON a.kArtikel=lb.kArtikel" : "";

                sql = $@"
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
SELECT lb.kArtikel, 0 AS kWarenLager,
    'Default'                        AS warehouse_name,
    {mindestAgg}                     AS fMindestbestand,
    ISNULL(SUM(lb.fVerfuegbar),0)    AS fVerfuegbar,
    {reservedAgg}                    AS fReserviert,
    ISNULL(SUM(lb.fLagerbestand),0)  AS fGesamt,
    {gesperrtAgg}                    AS fGesperrt
FROM dbo.tlagerbestand lb WITH (NOLOCK)
{artikelJoin2}
WHERE lb.kArtikel IS NOT NULL
GROUP BY lb.kArtikel
ORDER BY lb.kArtikel ASC
OFFSET @offset ROWS FETCH NEXT @batchSize ROWS ONLY";
            }

            await using var conn = await OpenConnectionAsync(ct);
            await using var cmd  = new SqlCommand(sql, conn);
            cmd.CommandTimeout = 120;
            cmd.Parameters.AddWithValue("@offset", offset);
            cmd.Parameters.AddWithValue("@batchSize", batchSize);

            var inventory = new List<JtlInventory>();
            await using var rdr = await cmd.ExecuteReaderAsync(ct);
            while (await rdr.ReadAsync(ct))
            {
                inventory.Add(new JtlInventory
                {
                    KArtikel        = Convert.ToInt64(rdr["kArtikel"]),
                    KWarenLager     = Convert.ToInt32(rdr["kWarenLager"]),
                    WarehouseName   = rdr["warehouse_name"]?.ToString() ?? "Default",
                    FVerfuegbar     = Convert.ToDecimal(rdr["fVerfuegbar"]),
                    FReserviert     = Convert.ToDecimal(rdr["fReserviert"]),
                    FGesamt         = Convert.ToDecimal(rdr["fGesamt"]),
                    FGesperrt       = Convert.ToDecimal(rdr["fGesperrt"]),
                    FMindestbestand = rdr["fMindestbestand"] == DBNull.Value ? 0m : Convert.ToDecimal(rdr["fMindestbestand"])
                });
            }

            return inventory;
        }
    }
}
