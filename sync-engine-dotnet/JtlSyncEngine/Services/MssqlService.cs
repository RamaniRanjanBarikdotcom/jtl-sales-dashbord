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
  CASE WHEN COL_LENGTH('Verkauf.tAuftrag','nStatus')                IS NOT NULL THEN 1 ELSE 0 END AS hasNStatus,
  CASE WHEN COL_LENGTH('Verkauf.tAuftrag','dBearbeitet')            IS NOT NULL THEN 1 ELSE 0 END AS hasDBearbeitet,
  -- Verkauf.tAuftragPosition optional columns
  CASE WHEN COL_LENGTH('Verkauf.tAuftragPosition','fMwSt')   IS NOT NULL THEN 1 ELSE 0 END AS hasPosMwSt,
  CASE WHEN COL_LENGTH('Verkauf.tAuftragPosition','fEkNetto') IS NOT NULL THEN 1 ELSE 0 END AS hasPosEk,
  CASE WHEN COL_LENGTH('Verkauf.tAuftragPosition','fRabatt')  IS NOT NULL THEN 1 ELSE 0 END AS hasPosRabatt,
  CASE WHEN COL_LENGTH('Verkauf.tAuftragPosition','fWertNettoGesamtFixiert') IS NOT NULL THEN 1 ELSE 0 END AS hasPosWertFixiert,
  -- Lookup tables
  CASE WHEN OBJECT_ID('dbo.tAbfrageStatus') IS NOT NULL THEN 1 ELSE 0 END AS hasTAbfrage,
  CASE WHEN OBJECT_ID('dbo.tPlattform')     IS NOT NULL THEN 1 ELSE 0 END AS hasTPlattform,
  CASE WHEN COALESCE(OBJECT_ID('dbo.tVersandart'), OBJECT_ID('dbo.tversandart')) IS NOT NULL THEN 1 ELSE 0 END AS hasTVersandart,
  CASE WHEN OBJECT_ID('dbo.tZahlungsart')   IS NOT NULL THEN 1 ELSE 0 END AS hasTZahlungsart,
  -- dbo.tArtikel optional columns
  CASE WHEN COL_LENGTH('dbo.tArtikel','dMod')           IS NOT NULL THEN 1 ELSE 0 END AS hasArtikelDMod,
  CASE WHEN COL_LENGTH('dbo.tArtikel','cBarcode')        IS NOT NULL THEN 1 ELSE 0 END AS hasBarcode,
  CASE WHEN COL_LENGTH('dbo.tArtikel','fGewicht')        IS NOT NULL THEN 1 ELSE 0 END AS hasGewicht,
  CASE WHEN COL_LENGTH('dbo.tArtikel','kVaterArtikel')   IS NOT NULL THEN 1 ELSE 0 END AS hasKVater,
  CASE WHEN COL_LENGTH('dbo.tArtikel','nIstVater')       IS NOT NULL THEN 1 ELSE 0 END AS hasNIstVater,
  CASE WHEN COL_LENGTH('dbo.tArtikel','nDelete')         IS NOT NULL THEN 1 ELSE 0 END AS hasNDelete,
  CASE WHEN COL_LENGTH('dbo.tArtikel','fMindestbestand') IS NOT NULL THEN 1 ELSE 0 END AS hasMindest,
  CASE WHEN COL_LENGTH('dbo.tArtikel','cSuchbegriffe')   IS NOT NULL THEN 1 ELSE 0 END AS hasSuchbegriffe,
  -- Stock & reorder point columns on tArtikel (authoritative source per user's SSMS query)
  CASE WHEN COL_LENGTH('dbo.tArtikel','nLagerbestand')  IS NOT NULL THEN 1 ELSE 0 END AS hasNLagerbestand,
  CASE WHEN COL_LENGTH('dbo.tArtikel','nMidestbestand') IS NOT NULL THEN 1 ELSE 0 END AS hasNMidestbestand,
  CASE WHEN COL_LENGTH('dbo.tArtikel','cLagerArtikel')  IS NOT NULL THEN 1 ELSE 0 END AS hasCLagerArtikel,
  -- Article support tables
  CASE WHEN OBJECT_ID('dbo.tArtikelBeschreibung') IS NOT NULL THEN 1 ELSE 0 END AS hasTArtBeschr,
  CASE WHEN OBJECT_ID('dbo.tWarengruppe')         IS NOT NULL THEN 1 ELSE 0 END AS hasTWarengruppe,
  -- Category tables — detect EACH separately so query uses the right table name
  CASE WHEN OBJECT_ID('dbo.tKategorieArtikel')  IS NOT NULL THEN 1 ELSE 0 END AS hasTKategorieArtikel,
  CASE WHEN OBJECT_ID('dbo.tArtikelInKategorie') IS NOT NULL THEN 1 ELSE 0 END AS hasTArtikelInKategorie,
  CASE WHEN OBJECT_ID('dbo.tKategorieSprache')   IS NOT NULL THEN 1 ELSE 0 END AS hasTKategorieSprache,
  -- dbo.tKunde optional columns
  CASE WHEN COL_LENGTH('dbo.tKunde','dGeaendert') IS NOT NULL THEN 1 ELSE 0 END AS hasKundeGeaendert,
  CASE WHEN COL_LENGTH('dbo.tKunde','cKundenNr')  IS NOT NULL THEN 1 ELSE 0 END AS hasKundenNr,
  CASE WHEN COL_LENGTH('dbo.tKunde','nDelete')    IS NOT NULL THEN 1 ELSE 0 END AS hasKundeNDelete,
  -- dbo.tRechnungsadresse
  CASE WHEN OBJECT_ID('dbo.tRechnungsadresse') IS NOT NULL THEN 1 ELSE 0 END AS hasTRechnung,
  CASE WHEN COL_LENGTH('dbo.tRechnungsadresse','kRechnungsadresse') IS NOT NULL THEN 1 ELSE 0 END AS hasKRechnung,
  -- dbo.tlagerbestand optional columns
  CASE WHEN COL_LENGTH('dbo.tlagerbestand','kWarenLager')          IS NOT NULL THEN 1 ELSE 0 END AS hasKWarenLager,
  CASE WHEN COL_LENGTH('dbo.tlagerbestand','fInAuftraegen')        IS NOT NULL THEN 1 ELSE 0 END AS hasFInAuftraegen,
  CASE WHEN COL_LENGTH('dbo.tlagerbestand','fVerfuegbarGesperrt')  IS NOT NULL THEN 1 ELSE 0 END AS hasFGesperrt,
  -- Preferred per-warehouse inventory table
  CASE WHEN OBJECT_ID('dbo.tlagerbestandProLagerLagerartikel') IS NOT NULL THEN 1 ELSE 0 END AS hasTLagerbestandPro,
  -- Warehouse master table
  CASE WHEN OBJECT_ID('dbo.tWarenLager') IS NOT NULL THEN 1 ELSE 0 END AS hasTWarenLager,
  -- dbo.tPreis (selling prices per article)
  CASE WHEN OBJECT_ID('dbo.tPreis') IS NOT NULL THEN 1 ELSE 0 END AS hasTPreis,
  CASE WHEN COL_LENGTH('dbo.tPreis','fNettoPreis')   IS NOT NULL THEN 1 ELSE 0 END AS hasPreisNetto,
  CASE WHEN COL_LENGTH('dbo.tPreis','kKundengruppe') IS NOT NULL THEN 1 ELSE 0 END AS hasPreisKundengruppe,
  -- Verkauf.tAuftragAdresse (order-level delivery address)
  CASE WHEN OBJECT_ID('Verkauf.tAuftragAdresse') IS NOT NULL THEN 1 ELSE 0 END AS hasTAuftragAdresse";

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
                    _schema.HasNStatus                = I(rdr, "hasNStatus");
                    _schema.HasDBearbeitet            = I(rdr, "hasDBearbeitet");
                    _schema.HasPositionMwSt           = I(rdr, "hasPosMwSt");
                    _schema.HasPositionEkNetto        = I(rdr, "hasPosEk");
                    _schema.HasPositionRabatt         = I(rdr, "hasPosRabatt");
                    _schema.HasPositionWertFixiert    = I(rdr, "hasPosWertFixiert");
                    _schema.HasTAbfrageStatus         = I(rdr, "hasTAbfrage");
                    _schema.HasTPlattform             = I(rdr, "hasTPlattform");
                    _schema.HasTversandart            = I(rdr, "hasTVersandart");
                    _schema.HasTZahlungsart           = I(rdr, "hasTZahlungsart");
                    _schema.HasArtikelDMod            = I(rdr, "hasArtikelDMod");
                    _schema.HasArtikelBarcode         = I(rdr, "hasBarcode");
                    _schema.HasArtikelGewicht         = I(rdr, "hasGewicht");
                    _schema.HasKVaterArtikel          = I(rdr, "hasKVater");
                    _schema.HasNIstVater              = I(rdr, "hasNIstVater");
                    _schema.HasNDelete                = I(rdr, "hasNDelete");
                    _schema.HasFMindestbestand        = I(rdr, "hasMindest");
                    _schema.HasNLagerbestand          = I(rdr, "hasNLagerbestand");
                    _schema.HasNMidestbestand         = I(rdr, "hasNMidestbestand");
                    _schema.HasCLagerArtikel          = I(rdr, "hasCLagerArtikel");
                    _schema.HasCSuchbegriffe          = I(rdr, "hasSuchbegriffe");
                    _schema.HasTArtikelBeschreibung   = I(rdr, "hasTArtBeschr");
                    _schema.HasTWarengruppe           = I(rdr, "hasTWarengruppe");
                    _schema.HasTKategorieArtikel      = I(rdr, "hasTKategorieArtikel");
                    _schema.HasTArtikelInKategorie    = I(rdr, "hasTArtikelInKategorie");
                    _schema.HasTKategorieSprache      = I(rdr, "hasTKategorieSprache");
                    _schema.HasKundeGeaendert         = I(rdr, "hasKundeGeaendert");
                    _schema.HasKundenNr               = I(rdr, "hasKundenNr");
                    _schema.HasKundeNDelete           = I(rdr, "hasKundeNDelete");
                    _schema.HasTRechnungsadresse      = I(rdr, "hasTRechnung");
                    _schema.HasKRechnungsadresse      = I(rdr, "hasKRechnung");
                    _schema.HasKWarenLager            = I(rdr, "hasKWarenLager");
                    _schema.HasFInAuftraegen          = I(rdr, "hasFInAuftraegen");
                    _schema.HasFVerfuegbarGesperrt    = I(rdr, "hasFGesperrt");
                    _schema.HasTLagerbestandPro       = I(rdr, "hasTLagerbestandPro");
                    _schema.HasTWarenLager            = I(rdr, "hasTWarenLager");
                    _schema.HasTPreis                 = I(rdr, "hasTPreis");
                    _schema.HasTPreisNetto            = I(rdr, "hasPreisNetto");
                    _schema.HasTPreisKundengruppe     = I(rdr, "hasPreisKundengruppe");
                    _schema.HasTAuftragAdresse        = I(rdr, "hasTAuftragAdresse");
                }
            }
            catch (Exception ex)
            {
                _log.Warn("MssqlService", $"Schema detection failed, using safe defaults: {ex.Message}");
                _schema = new JtlSchema();
            }

            _log.Info("MssqlService", $"JTL Schema detected: " +
                $"WertFixiert={_schema.HasPositionWertFixiert} | kWarenLager={_schema.HasKWarenLager} | " +
                $"tWarenLager={_schema.HasTWarenLager} | LagerbestandPro={_schema.HasTLagerbestandPro} | " +
                $"dGeaendert={_schema.HasKundeGeaendert} | kVaterArtikel={_schema.HasKVaterArtikel} | " +
                $"nIstVater={_schema.HasNIstVater} | KategorieArtikel={_schema.HasTKategorieArtikel} | " +
                $"ArtikelDMod={_schema.HasArtikelDMod} | tAuftragAdresse={_schema.HasTAuftragAdresse} | " +
                $"nStatus={_schema.HasNStatus} | dBearbeitet={_schema.HasDBearbeitet}");

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
        //
        // Uses OUTER APPLY to aggregate positions per order (matching the
        // production SSMS query). This avoids GROUP BY complexity and gives
        // us fWertNettoGesamtFixiert / fWertBruttoGesamtFixiert (finalized
        // totals that include discounts) when available, with fallback to
        // computed fAnzahl*fVkNetto for older JTL versions.
        // ─────────────────────────────────────────────────────────────────────
        public async Task<List<JtlOrder>> GetOrdersPageAsync(
            DateTime lastSyncTime, DateTime syncEndTime, int offset, int batchSize,
            CancellationToken ct = default)
        {
            var s = await EnsureSchemaAsync(ct);

            // SELECT columns from the order header
            var sel = new StringBuilder();
            sel.Append("a.kAuftrag, a.cAuftragsNr, a.dErstellt, a.kKunde, a.kVersandArt, a.kZahlungsart, a.nStorno");
            sel.Append(s.HasNStatus ? ", a.nStatus" : ", 0 AS nStatus");

            // Customer number from tKunde via LEFT JOIN
            sel.Append(", ISNULL(k.cKundenNr,'') AS cKundenNr");
            sel.Append(s.HasCExterneAuftragsnummer  ? ", a.cExterneAuftragsnummer" : ", '' AS cExterneAuftragsnummer");
            sel.Append(s.HasTPlattform && s.HasKPlattform ? ", ISNULL(p.cName,'') AS channel_name" : ", '' AS channel_name");
            sel.Append(s.HasTversandart  ? ", ISNULL(va.cName,'') AS versandart_name"  : ", '' AS versandart_name");
            sel.Append(s.HasTZahlungsart ? ", ISNULL(za.cName,'') AS zahlungsart_name" : ", '' AS zahlungsart_name");
            sel.Append(s.HasTAbfrageStatus && s.HasKAbfrageStatus ? ", ISNULL(tas.cName,'Offen') AS cStatus" : ", 'Offen' AS cStatus");

            // Delivery address from tAuftragAdresse via OUTER APPLY (matching user's query)
            if (s.HasTAuftragAdresse)
            {
                sel.Append(", ISNULL(adr.cPLZ,'')  AS cPLZ");
                sel.Append(", ISNULL(adr.cOrt,'')  AS cOrt");
                sel.Append(", ISNULL(adr.cLand,'') AS cLand");
            }
            else if (s.HasTRechnungsadresse)
            {
                sel.Append(", ISNULL(ra.cPLZ,'') AS cPLZ");
                sel.Append(", ISNULL(ra.cOrt,'') AS cOrt");
                sel.Append(", ISNULL(ra.cLand,'') AS cLand");
            }
            else
            {
                sel.Append(", '' AS cPLZ, '' AS cOrt, '' AS cLand");
            }

            // Revenue from OUTER APPLY pos (aggregated positions)
            sel.Append(", CAST(ROUND(ISNULL(pos.fGesamtsummeNetto,0),2) AS DECIMAL(18,2)) AS fGesamtsummeNetto");
            sel.Append(", CAST(ROUND(ISNULL(pos.fGesamtsumme,0),2)     AS DECIMAL(18,2)) AS fGesamtsumme");
            sel.Append(", CAST(ROUND(ISNULL(pos.fVersandkostenNetto,0),2) AS DECIMAL(18,2)) AS fVersandkostenNetto");
            sel.Append(", ISNULL(pos.items,'') AS items_summary");

            // Build JOINs
            var joins = new StringBuilder();

            // tKunde for cKundenNr (matching user's query)
            joins.AppendLine("LEFT JOIN dbo.tKunde k WITH (NOLOCK) ON k.kKunde=a.kKunde");

            if (s.HasTPlattform && s.HasKPlattform)
                joins.AppendLine("LEFT JOIN dbo.tPlattform p WITH (NOLOCK) ON p.nPlattform=a.kPlattform");
            if (s.HasTversandart)
                joins.AppendLine("LEFT JOIN dbo.tVersandart va WITH (NOLOCK) ON va.kVersandart=a.kVersandArt");
            if (s.HasTZahlungsart)
                joins.AppendLine("LEFT JOIN dbo.tZahlungsart za WITH (NOLOCK) ON za.kZahlungsart=a.kZahlungsart");
            if (s.HasTAbfrageStatus && s.HasKAbfrageStatus)
                joins.AppendLine("LEFT JOIN dbo.tAbfrageStatus tas WITH (NOLOCK) ON tas.kAbfrageStatus=a.kAbfrageStatus");

            // Delivery address via OUTER APPLY TOP 1 (matches user's SSMS query)
            if (s.HasTAuftragAdresse)
            {
                joins.AppendLine(@"OUTER APPLY (
    SELECT TOP 1 la.cPLZ, la.cOrt, la.cLand
    FROM Verkauf.tAuftragAdresse la WITH (NOLOCK)
    WHERE la.kAuftrag=a.kAuftrag AND la.nTyp=1
) adr");
            }
            else if (s.HasTRechnungsadresse)
            {
                var orderBy = s.HasKRechnungsadresse ? "ORDER BY kRechnungsadresse DESC" : "";
                joins.AppendLine($@"OUTER APPLY (
    SELECT TOP 1 ISNULL(r.cPLZ,'') AS cPLZ, ISNULL(r.cOrt,'') AS cOrt, ISNULL(r.cLand,'') AS cLand
    FROM dbo.tRechnungsadresse r WITH (NOLOCK)
    WHERE r.kKunde=a.kKunde {orderBy}
) ra");
            }

            // OUTER APPLY for position aggregates — uses fWertNettoGesamtFixiert when available
            // This matches the user's SSMS query exactly
            string nettoExpr, bruttoExpr;
            if (s.HasPositionWertFixiert)
            {
                nettoExpr  = "ISNULL(ap.fWertNettoGesamtFixiert,0)";
                bruttoExpr = "ISNULL(ap.fWertBruttoGesamtFixiert,0)";
            }
            else if (s.HasPositionMwSt)
            {
                nettoExpr  = "ISNULL(ap.fAnzahl,0)*ISNULL(ap.fVkNetto,0)";
                bruttoExpr = "ISNULL(ap.fAnzahl,0)*ISNULL(ap.fVkNetto,0)*(1+ISNULL(ap.fMwSt,0)/100.0)";
            }
            else
            {
                nettoExpr  = "ISNULL(ap.fAnzahl,0)*ISNULL(ap.fVkNetto,0)";
                bruttoExpr = "ISNULL(ap.fAnzahl,0)*ISNULL(ap.fVkNetto,0)*1.19";
            }

            joins.AppendLine($@"OUTER APPLY (
    SELECT
        SUM({nettoExpr}) AS fGesamtsummeNetto,
        SUM({bruttoExpr}) AS fGesamtsumme,
        SUM(CASE WHEN ap.nType=2 THEN {nettoExpr} ELSE 0 END) AS fVersandkostenNetto,
        STRING_AGG(
            CASE
                WHEN ap.nType IN (0,1) AND NULLIF(ap.cArtNr,'') IS NOT NULL THEN ap.cArtNr
                WHEN ap.nType IN (0,1) AND NULLIF(ap.cName,'')  IS NOT NULL THEN ap.cName
                ELSE NULL
            END,
            ', '
        ) AS items
    FROM Verkauf.tAuftragPosition ap WITH (NOLOCK)
    WHERE ap.kAuftrag=a.kAuftrag
) pos");

            var sql = $@"
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
SELECT {sel}
FROM Verkauf.tAuftrag a WITH (NOLOCK)
{joins}
WHERE { (s.HasDBearbeitet ? "COALESCE(a.dBearbeitet, a.dErstellt)" : "a.dErstellt") }>=@lastSyncTime
  AND { (s.HasDBearbeitet ? "COALESCE(a.dBearbeitet, a.dErstellt)" : "a.dErstellt") }<@syncEndTime
ORDER BY a.dErstellt ASC, a.kAuftrag ASC
OFFSET @offset ROWS FETCH NEXT @batchSize ROWS ONLY";

            await using var conn = await OpenConnectionAsync(ct);
            await using var cmd = new SqlCommand(sql, conn);
            cmd.CommandTimeout = 180;
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
                    NStatus                = rdr["nStatus"] == DBNull.Value ? 0 : Convert.ToInt32(rdr["nStatus"]),
                    FVersandkostenNetto    = rdr["fVersandkostenNetto"] == DBNull.Value ? 0m : Convert.ToDecimal(rdr["fVersandkostenNetto"]),
                    ChannelName            = rdr["channel_name"]?.ToString() ?? "",
                    VersandartName         = rdr["versandart_name"]?.ToString() ?? "",
                    ZahlungsartName        = rdr["zahlungsart_name"]?.ToString() ?? "",
                    CStatus                = rdr["cStatus"]?.ToString() ?? "Offen",
                    CPLZ                   = rdr["cPLZ"]?.ToString() ?? "",
                    COrt                   = rdr["cOrt"]?.ToString() ?? "",
                    CLand                  = rdr["cLand"]?.ToString() ?? "",
                    FGesamtsumme           = rdr["fGesamtsumme"] == DBNull.Value ? 0m : Convert.ToDecimal(rdr["fGesamtsumme"]),
                    FGesamtsummeNetto      = rdr["fGesamtsummeNetto"] == DBNull.Value ? 0m : Convert.ToDecimal(rdr["fGesamtsummeNetto"]),
                    ItemsSummary           = rdr["items_summary"]?.ToString() ?? ""
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
            // Safe: orderIds is IEnumerable<long>; format "D" produces digits only, no injection possible.
            var idList = string.Join(",", orderIds.Select(id => id.ToString("D")));
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
WHERE ap.kAuftrag IN ({idList})
  AND ap.kArtikel IS NOT NULL
  AND ap.nType IN (0,1)";

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
        // Products (non-paged, kept for backward compat — prefer GetProductsPageAsync)
        // ─────────────────────────────────────────────────────────────────────
        public async Task<List<JtlProduct>> GetProductsAsync(
            DateTime lastSyncTime, CancellationToken ct = default)
        {
            // Delegate to the paged version with a very large page to get all
            return await GetProductsPageAsync(lastSyncTime, DateTime.UtcNow, 0, int.MaxValue, ct);
        }

        // ─────────────────────────────────────────────────────────────────────
        // Customers
        // ─────────────────────────────────────────────────────────────────────
        public async Task<List<JtlCustomer>> GetCustomersAsync(
            DateTime lastSyncTime, CancellationToken ct = default)
        {
            var s = await EnsureSchemaAsync(ct);

            // If dGeaendert doesn't exist, fall back to dErstellt for watermark filtering
            var dateCol       = s.HasKundeGeaendert ? "k.dGeaendert" : "k.dErstellt";
            var dateSelect    = s.HasKundeGeaendert
                ? "k.dErstellt, k.dGeaendert"
                : "k.dErstellt, k.dErstellt AS dGeaendert";
            var kundenNrSelect = s.HasKundenNr ? "k.cKundenNr" : "'' AS cKundenNr";
            // Exclude soft-deleted customers (nDelete=1 means deleted in JTL)
            var nDeleteFilter = s.HasKundeNDelete ? " AND (k.nDelete IS NULL OR k.nDelete=0)" : "";

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

            var effectiveDateExprLegacy = s.HasKundeGeaendert ? "COALESCE(k.dGeaendert, k.dErstellt)" : "k.dErstellt";
            var sql = $@"
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
SELECT k.kKunde, {kundenNrSelect},
    {addrSelect}
    {dateSelect}
FROM dbo.tKunde k WITH (NOLOCK)
{addrJoin}
WHERE {effectiveDateExprLegacy}>=@lastSyncTime{nDeleteFilter}";

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
        // Inventory — full snapshot (non-paged, legacy)
        //
        // Sources from tArtikel (all ~222K products), OUTER APPLY on
        // tlagerbestandProLagerLagerartikel for per-warehouse stock sum.
        // Uses nLagerbestand (authoritative integer total) when available.
        // ─────────────────────────────────────────────────────────────────────
        public async Task<List<JtlInventory>> GetInventoryAsync(CancellationToken ct = default)
        {
            var s = await EnsureSchemaAsync(ct);

            // ── Stock expression ────────────────────────────────────────────
            string stockExpr;
            if (s.HasNLagerbestand)
                stockExpr = "ISNULL(a.nLagerbestand, 0)";
            else if (s.HasTLagerbestandPro)
                stockExpr = "ISNULL(wh.GesamtBestand, 0)";
            else
                stockExpr = "0";

            // ── Reorder point expression ────────────────────────────────────
            string mindestExpr;
            if (s.HasNMidestbestand)
                mindestExpr = "ISNULL(a.nMidestbestand, 0)";
            else if (s.HasFMindestbestand)
                mindestExpr = "ISNULL(a.fMindestbestand, 0)";
            else
                mindestExpr = "0";

            // ── Warehouse OUTER APPLY ───────────────────────────────────────
            var warehouseApply = s.HasTLagerbestandPro
                ? @"OUTER APPLY (
    SELECT SUM(ISNULL(lb.fBestand, 0)) AS GesamtBestand
    FROM dbo.tlagerbestandProLagerLagerartikel lb WITH (NOLOCK)
    WHERE lb.kArtikel = a.kArtikel
) wh"
                : "";

            var deleteFilter = s.HasNDelete ? " AND a.nDelete=0" : "";

            var sql = $@"
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
SELECT a.kArtikel,
    0                AS kWarenLager,
    'Default'        AS warehouse_name,
    {mindestExpr}    AS fMindestbestand,
    {stockExpr}      AS fVerfuegbar,
    0                AS fReserviert,
    {stockExpr}      AS fGesamt,
    0                AS fGesperrt
FROM dbo.tArtikel a WITH (NOLOCK)
{warehouseApply}
WHERE 1=1{deleteFilter}
ORDER BY a.kArtikel ASC";

            await using var conn = await OpenConnectionAsync(ct);
            await using var cmd  = new SqlCommand(sql, conn);
            cmd.CommandTimeout = 300;

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
        // Orders count — for pagination
        // Counts ALL orders (including cancelled) in the time window
        // ─────────────────────────────────────────────────────────────────────
        public async Task<int> GetOrdersCountAsync(
            DateTime lastSyncTime, DateTime syncEndTime, CancellationToken ct = default)
        {
            var s = await EnsureSchemaAsync(ct);
            var dateExpr = s.HasDBearbeitet
                ? "COALESCE(a.dBearbeitet, a.dErstellt)"
                : "a.dErstellt";

            var sql = $@"
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
SELECT COUNT(*)
FROM Verkauf.tAuftrag a WITH (NOLOCK)
WHERE {dateExpr}>=@lastSyncTime
  AND {dateExpr}<@syncEndTime";

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
            DateTime lastSyncTime, DateTime syncEndTime, CancellationToken ct = default)
        {
            var s = await EnsureSchemaAsync(ct);
            var whereFilter = new StringBuilder("1=1");
            if (s.HasNDelete)     whereFilter.Append(" AND a.nDelete=0");
            if (s.HasArtikelDMod)
            {
                whereFilter.Append(
                    " AND ((a.dMod IS NOT NULL AND a.dMod>=@lastSyncTime AND a.dMod<@syncEndTime) " +
                    "OR (@includeNullDMod=1 AND a.dMod IS NULL))");
            }

            var sql = $@"
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
SELECT COUNT(*) FROM dbo.tArtikel a WITH (NOLOCK)
WHERE {whereFilter}";

            await using var conn = await OpenConnectionAsync(ct);
            await using var cmd  = new SqlCommand(sql, conn);
            cmd.CommandTimeout = 60;
            cmd.Parameters.AddWithValue("@lastSyncTime", lastSyncTime);
            cmd.Parameters.AddWithValue("@syncEndTime", syncEndTime);
            if (s.HasArtikelDMod)
            {
                // Full historical run should include legacy rows with NULL dMod.
                // Incremental runs exclude them to prevent re-sending entire catalog.
                var includeNullDMod = lastSyncTime <= new DateTime(2000, 1, 2, 0, 0, 0, DateTimeKind.Utc);
                cmd.Parameters.AddWithValue("@includeNullDMod", includeNullDMod ? 1 : 0);
            }
            return Convert.ToInt32(await cmd.ExecuteScalarAsync(ct));
        }

        // ─────────────────────────────────────────────────────────────────────
        // Products — paged, with parent/child, categories, and search keywords
        // ─────────────────────────────────────────────────────────────────────
        public async Task<List<JtlProduct>> GetProductsPageAsync(
            DateTime lastSyncTime, DateTime syncEndTime, int offset, int batchSize, CancellationToken ct = default)
        {
            var s = await EnsureSchemaAsync(ct);

            var barcodeCol  = s.HasArtikelBarcode ? "a.cBarcode"           : "'' AS cBarcode";
            var gewichtCol  = s.HasArtikelGewicht ? "ISNULL(a.fGewicht,0)" : "0";
            var dModCol     = s.HasArtikelDMod    ? "a.dMod"               : "NULL AS dMod";

            // Parent/child variant columns
            var kVaterCol   = s.HasKVaterArtikel  ? "ISNULL(a.kVaterArtikel,0)" : "0";
            var nIstVaterCol = s.HasNIstVater     ? "ISNULL(a.nIstVater,0)"     : "0";

            // Search keywords
            var suchCol     = s.HasCSuchbegriffe  ? "ISNULL(a.cSuchbegriffe,'')" : "''";

            var beschrJoin  = s.HasTArtikelBeschreibung
                ? "LEFT JOIN dbo.tArtikelBeschreibung ab WITH (NOLOCK) ON ab.kArtikel=a.kArtikel AND ab.kSprache=1 AND ab.kPlattform=1"
                : "";
            var nameExpr    = s.HasTArtikelBeschreibung ? "ISNULL(ab.cName,a.cArtNr)" : "a.cArtNr";

            // Category: prefer category hierarchy tables + tKategorieSprache,
            // fall back to tWarengruppe.
            // IMPORTANT: tKategorieArtikel and tArtikelInKategorie are two different
            // table names used by different JTL Wawi versions — use whichever exists.
            var categoryJoin = "";
            var catName = "''";
            if (s.HasTKategorieSprache && (s.HasTKategorieArtikel || s.HasTArtikelInKategorie))
            {
                // Pick the correct table name based on which one actually exists
                var catLinkTable = s.HasTKategorieArtikel ? "dbo.tKategorieArtikel" : "dbo.tArtikelInKategorie";
                categoryJoin = $@"
OUTER APPLY (
    SELECT TOP 1 ISNULL(ks.cName,'') AS cKategorieName
    FROM {catLinkTable} ka WITH (NOLOCK)
    INNER JOIN dbo.tKategorieSprache ks WITH (NOLOCK) ON ks.kKategorie=ka.kKategorie AND ks.kSprache=1
    WHERE ka.kArtikel=a.kArtikel
) cat";
                catName = "ISNULL(cat.cKategorieName,'')";
            }
            else if (s.HasTWarengruppe)
            {
                categoryJoin = "LEFT JOIN dbo.tWarengruppe wg WITH (NOLOCK) ON wg.kWarengruppe=a.kWarengruppe";
                catName = "ISNULL(wg.cName,'')";
            }

            // Stock source: prefer nLagerbestand on tArtikel (authoritative integer total).
            // Fall back to OUTER APPLY on tlagerbestand for older JTL versions.
            string stockSelectExpr, lbJoin;
            if (s.HasNLagerbestand)
            {
                stockSelectExpr = "ISNULL(a.nLagerbestand, 0)";
                lbJoin = "";
            }
            else
            {
                var lbOrderBy = s.HasKWarenLager ? "ORDER BY kWarenLager ASC" : "";
                stockSelectExpr = "ISNULL(lb.fVerfuegbar, 0)";
                lbJoin = $@"OUTER APPLY (
    SELECT TOP 1 ISNULL(fVerfuegbar,0) AS fVerfuegbar
    FROM dbo.tlagerbestand WITH (NOLOCK)
    WHERE kArtikel=a.kArtikel
    {lbOrderBy}
) lb";
            }

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

            var whereFilter = new StringBuilder("1=1");
            if (s.HasNDelete)     whereFilter.Append(" AND a.nDelete=0");
            if (s.HasArtikelDMod)
            {
                whereFilter.Append(
                    " AND ((a.dMod IS NOT NULL AND a.dMod>=@lastSyncTime AND a.dMod<@syncEndTime) " +
                    "OR (@includeNullDMod=1 AND a.dMod IS NULL))");
            }

            var sql = $@"
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
SELECT a.kArtikel, a.cArtNr,
    {nameExpr}              AS cName,
    ISNULL(a.fEKNetto,0)    AS fEKNetto,
    {vkNettoExpr}           AS fVKNetto,
    ROUND({vkNettoExpr}*1.19,2) AS fVKBrutto,
    {gewichtCol}            AS fGewicht,
    {barcodeCol},
    {dModCol},
    {kVaterCol}             AS kVaterArtikel,
    {nIstVaterCol}          AS nIstVater,
    {suchCol}               AS cSuchbegriffe,
    ISNULL(a.kWarengruppe,0) AS kWarengruppe,
    {catName}               AS category_name,
    {stockSelectExpr}       AS fVerfuegbar
FROM dbo.tArtikel a WITH (NOLOCK)
{beschrJoin}
{lbJoin}
{preisJoin}
{categoryJoin}
WHERE {whereFilter}
ORDER BY a.kArtikel ASC
OFFSET @offset ROWS FETCH NEXT @batchSize ROWS ONLY";

            await using var conn = await OpenConnectionAsync(ct);
            await using var cmd  = new SqlCommand(sql, conn);
            cmd.CommandTimeout = 180;
            cmd.Parameters.AddWithValue("@lastSyncTime", lastSyncTime);
            cmd.Parameters.AddWithValue("@syncEndTime", syncEndTime);
            if (s.HasArtikelDMod)
            {
                var includeNullDMod = lastSyncTime <= new DateTime(2000, 1, 2, 0, 0, 0, DateTimeKind.Utc);
                cmd.Parameters.AddWithValue("@includeNullDMod", includeNullDMod ? 1 : 0);
            }
            cmd.Parameters.AddWithValue("@offset", offset);
            cmd.Parameters.AddWithValue("@batchSize", batchSize);

            var products = new List<JtlProduct>();
            await using var rdr = await cmd.ExecuteReaderAsync(ct);
            while (await rdr.ReadAsync(ct))
            {
                products.Add(new JtlProduct
                {
                    KArtikel      = Convert.ToInt64(rdr["kArtikel"]),
                    CArtNr        = rdr["cArtNr"]?.ToString() ?? "",
                    CName         = rdr["cName"]?.ToString() ?? "",
                    FEKNetto      = Convert.ToDecimal(rdr["fEKNetto"]),
                    FVKNetto      = Convert.ToDecimal(rdr["fVKNetto"]),
                    FVKBrutto     = Convert.ToDecimal(rdr["fVKBrutto"]),
                    FGewicht      = Convert.ToDecimal(rdr["fGewicht"]),
                    CBarcode      = rdr["cBarcode"]?.ToString() ?? "",
                    DMod          = rdr["dMod"] == DBNull.Value ? DateTime.MinValue : Convert.ToDateTime(rdr["dMod"]),
                    KVaterArtikel = rdr["kVaterArtikel"] == DBNull.Value ? 0 : Convert.ToInt64(rdr["kVaterArtikel"]),
                    NIstVater     = rdr["nIstVater"] == DBNull.Value ? 0 : Convert.ToInt32(rdr["nIstVater"]),
                    CSuchbegriffe = rdr["cSuchbegriffe"]?.ToString() ?? "",
                    KWarengruppe  = rdr["kWarengruppe"] == DBNull.Value ? 0 : Convert.ToInt32(rdr["kWarengruppe"]),
                    CategoryName  = rdr["category_name"]?.ToString() ?? "",
                    FVerfuegbar   = Convert.ToDecimal(rdr["fVerfuegbar"])
                });
            }

            return products;
        }

        // ─────────────────────────────────────────────────────────────────────
        // Customers count
        // ─────────────────────────────────────────────────────────────────────
        public async Task<int> GetCustomersCountAsync(
            DateTime lastSyncTime, DateTime syncEndTime, CancellationToken ct = default)
        {
            var s = await EnsureSchemaAsync(ct);
            var dateCol       = s.HasKundeGeaendert ? "k.dGeaendert" : "k.dErstellt";
            var nDeleteFilter = s.HasKundeNDelete ? " AND (k.nDelete IS NULL OR k.nDelete=0)" : "";

            // COALESCE: if dGeaendert IS NULL (customer never modified), fall back to dErstellt.
            // This prevents customers with no modification date from being silently skipped.
            var effectiveDateExpr = s.HasKundeGeaendert ? "COALESCE(k.dGeaendert, k.dErstellt)" : "k.dErstellt";
            var sql = $@"
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
SELECT COUNT(*) FROM dbo.tKunde k WITH (NOLOCK)
WHERE {effectiveDateExpr}>=@lastSyncTime AND {effectiveDateExpr}<@syncEndTime{nDeleteFilter}";

            await using var conn = await OpenConnectionAsync(ct);
            await using var cmd  = new SqlCommand(sql, conn);
            cmd.CommandTimeout = 60;
            cmd.Parameters.AddWithValue("@lastSyncTime", lastSyncTime);
            cmd.Parameters.AddWithValue("@syncEndTime", syncEndTime);
            return Convert.ToInt32(await cmd.ExecuteScalarAsync(ct));
        }

        // ─────────────────────────────────────────────────────────────────────
        // Customers — paged version
        // ─────────────────────────────────────────────────────────────────────
        public async Task<List<JtlCustomer>> GetCustomersPageAsync(
            DateTime lastSyncTime, DateTime syncEndTime, int offset, int batchSize, CancellationToken ct = default)
        {
            var s = await EnsureSchemaAsync(ct);

            var dateCol       = s.HasKundeGeaendert ? "k.dGeaendert" : "k.dErstellt";
            var dateSelect    = s.HasKundeGeaendert
                ? "k.dErstellt, k.dGeaendert"
                : "k.dErstellt, k.dErstellt AS dGeaendert";
            var kundenNrSelect = s.HasKundenNr ? "k.cKundenNr" : "'' AS cKundenNr";
            var nDeleteFilter  = s.HasKundeNDelete ? " AND (k.nDelete IS NULL OR k.nDelete=0)" : "";

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

            // COALESCE: if dGeaendert IS NULL (never modified), fall back to dErstellt.
            var effectiveDateExpr = s.HasKundeGeaendert ? "COALESCE(k.dGeaendert, k.dErstellt)" : "k.dErstellt";
            var sql = $@"
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
SELECT k.kKunde, {kundenNrSelect},
    {addrSelect}
    {dateSelect}
FROM dbo.tKunde k WITH (NOLOCK)
{addrJoin}
WHERE {effectiveDateExpr}>=@lastSyncTime AND {effectiveDateExpr}<@syncEndTime{nDeleteFilter}
ORDER BY k.kKunde ASC
OFFSET @offset ROWS FETCH NEXT @batchSize ROWS ONLY";

            await using var conn = await OpenConnectionAsync(ct);
            await using var cmd  = new SqlCommand(sql, conn);
            cmd.CommandTimeout = 120;
            cmd.Parameters.AddWithValue("@lastSyncTime", lastSyncTime);
            cmd.Parameters.AddWithValue("@syncEndTime", syncEndTime);
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
            var s = await EnsureSchemaAsync(ct);
            // Source: tArtikel — every product is an inventory record.
            // nDelete=0 filter excludes soft-deleted articles (same filter as products sync).
            var deleteFilter = s.HasNDelete ? " WHERE a.nDelete=0" : "";
            var sql = $@"SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
SELECT COUNT(*) FROM dbo.tArtikel a WITH (NOLOCK){deleteFilter}";

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

            // ── Stock expression ────────────────────────────────────────────────
            // Prefer tArtikel.nLagerbestand (authoritative integer total from JTL UI).
            // If not present, fall back to summing fBestand from warehouse table.
            string stockExpr;
            if (s.HasNLagerbestand)
            {
                stockExpr = "ISNULL(a.nLagerbestand, 0)";
            }
            else if (s.HasTLagerbestandPro)
            {
                stockExpr = "ISNULL(wh.GesamtBestand, 0)";
            }
            else
            {
                stockExpr = "ISNULL(a.fVKNetto, 0)"; // last-resort placeholder
            }

            // ── Reorder point expression ───────────────────────────────────────
            // nMidestbestand = integer column (note JTL typo "Midest" not "Mindest").
            // fMindestbestand = decimal column (older JTL versions).
            string mindestExpr;
            if (s.HasNMidestbestand)
                mindestExpr = "ISNULL(a.nMidestbestand, 0)";
            else if (s.HasFMindestbestand)
                mindestExpr = "ISNULL(a.fMindestbestand, 0)";
            else
                mindestExpr = "0";

            // ── Warehouse OUTER APPLY ──────────────────────────────────────────
            // Matches the user's SSMS query: sum fBestand per article across all warehouses.
            // kWarenlager is LOWERCASE in tlagerbestandProLagerLagerartikel (different from
            // tlagerbestand which uses kWarenLager uppercase).
            var warehouseApply = s.HasTLagerbestandPro
                ? @"OUTER APPLY (
    SELECT SUM(ISNULL(lb.fBestand, 0)) AS GesamtBestand
    FROM dbo.tlagerbestandProLagerLagerartikel lb WITH (NOLOCK)
    WHERE lb.kArtikel = a.kArtikel
) wh"
                : "";

            var deleteFilter = s.HasNDelete ? " AND a.nDelete=0" : "";

            var sql = $@"
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
SELECT a.kArtikel,
    0                AS kWarenLager,
    'Default'        AS warehouse_name,
    {mindestExpr}    AS fMindestbestand,
    {stockExpr}      AS fVerfuegbar,
    0                AS fReserviert,
    {stockExpr}      AS fGesamt,
    0                AS fGesperrt
FROM dbo.tArtikel a WITH (NOLOCK)
{warehouseApply}
WHERE 1=1{deleteFilter}
ORDER BY a.kArtikel ASC
OFFSET @offset ROWS FETCH NEXT @batchSize ROWS ONLY";

            await using var conn = await OpenConnectionAsync(ct);
            await using var cmd  = new SqlCommand(sql, conn);
            cmd.CommandTimeout = 180;
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
