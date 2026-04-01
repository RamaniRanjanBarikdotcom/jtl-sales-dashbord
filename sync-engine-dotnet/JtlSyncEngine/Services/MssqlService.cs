using System;
using System.Collections.Generic;
using System.Data;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using JtlSyncEngine.JtlModels;
using Microsoft.Data.SqlClient;

namespace JtlSyncEngine.Services
{
    public class MssqlService
    {
        private readonly ConfigService _config;
        private readonly LogService _log;
        private static readonly int[] RetryDelaysSeconds = { 5, 10, 20, 30, 60 };

        public MssqlService(ConfigService config, LogService log)
        {
            _config = config;
            _log = log;
        }

        private async Task<SqlConnection> OpenConnectionAsync(CancellationToken ct = default)
        {
            var connectionString = _config.BuildConnectionString();
            Exception? lastEx = null;

            for (int attempt = 0; attempt <= RetryDelaysSeconds.Length; attempt++)
            {
                try
                {
                    var conn = new SqlConnection(connectionString);
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

            throw new InvalidOperationException($"Failed to connect to SQL Server after {RetryDelaysSeconds.Length + 1} attempts", lastEx);
        }

        public async Task<bool> TestConnectionAsync(CancellationToken ct = default)
        {
            try
            {
                await using var conn = await OpenConnectionWithoutRetryAsync(ct);
                return true;
            }
            catch (Exception ex)
            {
                _log.Error("MssqlService", "Connection test failed", ex);
                return false;
            }
        }

        private async Task<SqlConnection> OpenConnectionWithoutRetryAsync(CancellationToken ct = default)
        {
            var connectionString = _config.BuildConnectionString();
            var conn = new SqlConnection(connectionString);
            await conn.OpenAsync(ct);
            return conn;
        }

        public async Task<List<JtlOrder>> GetOrdersPageAsync(
            DateTime lastSyncTime, DateTime syncEndTime, int offset, int batchSize,
            CancellationToken ct = default)
        {
            const string sql = @"
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
SELECT
    a.kAuftrag, a.cAuftragsNr, a.dErstellt, a.kKunde, a.cKundenNr,
    a.cExterneAuftragsnummer, a.kVersandArt, a.kZahlungsart, a.nStorno,
    ISNULL(p.cName, '') AS channel_name,
    ISNULL(va.cName, '') AS versandart_name,
    ISNULL(za.cName, '') AS zahlungsart_name,
    CAST(ROUND(SUM(ISNULL(ap.fVkNetto,0)*ISNULL(ap.fAnzahl,0)*(1+ISNULL(ap.fMwSt,0)/100.0)),2) AS DECIMAL(18,2)) AS fGesamtsumme,
    CAST(ROUND(SUM(ISNULL(ap.fVkNetto,0)*ISNULL(ap.fAnzahl,0)),2) AS DECIMAL(18,2)) AS fGesamtsummeNetto
FROM Verkauf.tAuftrag a WITH (NOLOCK)
LEFT JOIN Verkauf.tAuftragPosition ap WITH (NOLOCK) ON ap.kAuftrag = a.kAuftrag AND ap.nType = 1
LEFT JOIN dbo.tPlattform p WITH (NOLOCK) ON p.nPlattform = a.kPlattform
LEFT JOIN dbo.tversandart va WITH (NOLOCK) ON va.kVersandArt = a.kVersandArt
LEFT JOIN dbo.tZahlungsart za WITH (NOLOCK) ON za.kZahlungsart = a.kZahlungsart
WHERE ISNULL(a.nStorno,0)=0 AND a.dErstellt>=@lastSyncTime AND a.dErstellt<@syncEndTime
GROUP BY a.kAuftrag,a.cAuftragsNr,a.dErstellt,a.kKunde,a.cKundenNr,a.cExterneAuftragsnummer,a.kVersandArt,a.kZahlungsart,a.nStorno,p.cName,va.cName,za.cName
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
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                orders.Add(new JtlOrder
                {
                    KAuftrag = Convert.ToInt64(reader["kAuftrag"]),
                    CAuftragsNr = reader["cAuftragsNr"]?.ToString() ?? "",
                    DErstellt = reader["dErstellt"] == DBNull.Value ? DateTime.MinValue : Convert.ToDateTime(reader["dErstellt"]),
                    KKunde = reader["kKunde"] == DBNull.Value ? 0 : Convert.ToInt64(reader["kKunde"]),
                    CKundenNr = reader["cKundenNr"]?.ToString() ?? "",
                    CExterneAuftragsnummer = reader["cExterneAuftragsnummer"]?.ToString() ?? "",
                    KVersandArt = reader["kVersandArt"] == DBNull.Value ? 0 : Convert.ToInt32(reader["kVersandArt"]),
                    KZahlungsart = reader["kZahlungsart"] == DBNull.Value ? 0 : Convert.ToInt32(reader["kZahlungsart"]),
                    NStorno = reader["nStorno"] == DBNull.Value ? 0 : Convert.ToInt32(reader["nStorno"]),
                    ChannelName = reader["channel_name"]?.ToString() ?? "",
                    VersandartName = reader["versandart_name"]?.ToString() ?? "",
                    ZahlungsartName = reader["zahlungsart_name"]?.ToString() ?? "",
                    FGesamtsumme = reader["fGesamtsumme"] == DBNull.Value ? 0m : Convert.ToDecimal(reader["fGesamtsumme"]),
                    FGesamtsummeNetto = reader["fGesamtsummeNetto"] == DBNull.Value ? 0m : Convert.ToDecimal(reader["fGesamtsummeNetto"])
                });
            }

            return orders;
        }

        public async Task<List<JtlOrderItem>> GetOrderItemsAsync(IEnumerable<long> orderIds, CancellationToken ct = default)
        {
            var idList = string.Join(",", orderIds);
            if (string.IsNullOrEmpty(idList)) return new List<JtlOrderItem>();

            var sql = $@"
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
SELECT ap.kAuftragPosition, ap.kAuftrag, ISNULL(ap.kArtikel,0) AS kArtikel,
    ISNULL(ap.fAnzahl,0) AS fAnzahl,
    ISNULL(ap.fVkNetto,0) AS fVkNetto,
    ISNULL(ap.fVkNetto,0)*(1+ISNULL(ap.fMwSt,0)/100.0) AS fVkBrutto,
    ISNULL(ap.fEkNetto,0) AS fEkNetto,
    ISNULL(ap.fRabatt,0) AS fRabatt,
    ISNULL(ap.cName, ap.cArtNr) AS cName, ap.cArtNr
FROM Verkauf.tAuftragPosition ap WITH (NOLOCK)
WHERE ap.kAuftrag IN ({idList}) AND ap.nType=1";

            await using var conn = await OpenConnectionAsync(ct);
            await using var cmd = new SqlCommand(sql, conn);
            cmd.CommandTimeout = 120;

            var items = new List<JtlOrderItem>();
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                items.Add(new JtlOrderItem
                {
                    KAuftragPosition = Convert.ToInt64(reader["kAuftragPosition"]),
                    KAuftrag = Convert.ToInt64(reader["kAuftrag"]),
                    KArtikel = Convert.ToInt64(reader["kArtikel"]),
                    FAnzahl = Convert.ToDecimal(reader["fAnzahl"]),
                    FVkNetto = Convert.ToDecimal(reader["fVkNetto"]),
                    FVkBrutto = Convert.ToDecimal(reader["fVkBrutto"]),
                    FEkNetto = Convert.ToDecimal(reader["fEkNetto"]),
                    FRabatt = Convert.ToDecimal(reader["fRabatt"]),
                    CName = reader["cName"]?.ToString() ?? "",
                    CArtNr = reader["cArtNr"]?.ToString() ?? ""
                });
            }

            return items;
        }

        public async Task<List<JtlProduct>> GetProductsAsync(DateTime lastSyncTime, CancellationToken ct = default)
        {
            // OUTER APPLY TOP 1 on tlagerbestand prevents duplicate rows when an article
            // has stock in multiple warehouses (one row per warehouse in the old LEFT JOIN).
            // (a.dMod IS NULL OR ...) ensures products that were never modified are still synced.
            const string sql = @"
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
SELECT a.kArtikel, a.cArtNr, ISNULL(ab.cName, a.cArtNr) AS cName,
    ISNULL(a.fEKNetto,0) AS fEKNetto, ISNULL(a.fVKNetto,0) AS fVKNetto,
    ROUND(ISNULL(a.fVKNetto,0)*1.19,2) AS fVKBrutto,
    ISNULL(a.fGewicht,0) AS fGewicht, a.cBarcode, a.dMod,
    a.kWarengruppe, ISNULL(wg.cName,'') AS category_name,
    ISNULL(lb.fVerfuegbar,0) AS fVerfuegbar
FROM dbo.tArtikel a WITH (NOLOCK)
LEFT JOIN dbo.tArtikelBeschreibung ab WITH (NOLOCK)
    ON ab.kArtikel=a.kArtikel AND ab.kSprache=1 AND ab.kPlattform=1
OUTER APPLY (
    SELECT TOP 1 ISNULL(fVerfuegbar,0) AS fVerfuegbar
    FROM dbo.tlagerbestand WITH (NOLOCK)
    WHERE kArtikel=a.kArtikel
    ORDER BY kWarenLager ASC
) lb
LEFT JOIN dbo.tWarengruppe wg WITH (NOLOCK) ON wg.kWarengruppe=a.kWarengruppe
WHERE a.kVaterArtikel=0 AND a.nDelete=0 AND a.cArtNr IS NOT NULL AND a.cArtNr<>''
  AND (a.dMod IS NULL OR a.dMod>=@lastSyncTime)";

            await using var conn = await OpenConnectionAsync(ct);
            await using var cmd = new SqlCommand(sql, conn);
            cmd.CommandTimeout = 180;
            cmd.Parameters.AddWithValue("@lastSyncTime", lastSyncTime);

            var products = new List<JtlProduct>();
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                products.Add(new JtlProduct
                {
                    KArtikel = Convert.ToInt64(reader["kArtikel"]),
                    CArtNr = reader["cArtNr"]?.ToString() ?? "",
                    CName = reader["cName"]?.ToString() ?? "",
                    FEKNetto = Convert.ToDecimal(reader["fEKNetto"]),
                    FVKNetto = Convert.ToDecimal(reader["fVKNetto"]),
                    FVKBrutto = Convert.ToDecimal(reader["fVKBrutto"]),
                    FGewicht = Convert.ToDecimal(reader["fGewicht"]),
                    CBarcode = reader["cBarcode"]?.ToString() ?? "",
                    DMod = reader["dMod"] == DBNull.Value ? DateTime.MinValue : Convert.ToDateTime(reader["dMod"]),
                    KWarengruppe = reader["kWarengruppe"] == DBNull.Value ? 0 : Convert.ToInt32(reader["kWarengruppe"]),
                    CategoryName = reader["category_name"]?.ToString() ?? "",
                    FVerfuegbar = Convert.ToDecimal(reader["fVerfuegbar"])
                });
            }

            return products;
        }

        public async Task<List<JtlCustomer>> GetCustomersAsync(DateTime lastSyncTime, CancellationToken ct = default)
        {
            // OUTER APPLY TOP 1 on tRechnungsadresse prevents duplicate customer rows when
            // a customer has multiple billing addresses stored in the table.
            const string sql = @"
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
SELECT k.kKunde, k.cKundenNr,
    ISNULL(r.cMail,'') AS cMail, ISNULL(r.cVorname,'') AS cVorname,
    ISNULL(r.cName,'') AS cNachname, ISNULL(r.cFirma,'') AS cFirma,
    ISNULL(r.cPLZ,'') AS cPLZ, ISNULL(r.cOrt,'') AS cOrt,
    ISNULL(r.cLand,'DE') AS cLand, k.dErstellt, k.dGeaendert
FROM dbo.tKunde k WITH (NOLOCK)
OUTER APPLY (
    SELECT TOP 1 cMail, cVorname, cName, cFirma, cPLZ, cOrt, cLand
    FROM dbo.tRechnungsadresse WITH (NOLOCK)
    WHERE kKunde=k.kKunde
    ORDER BY kRechnungsadresse DESC
) r
WHERE k.dGeaendert>=@lastSyncTime";

            await using var conn = await OpenConnectionAsync(ct);
            await using var cmd = new SqlCommand(sql, conn);
            cmd.CommandTimeout = 120;
            cmd.Parameters.AddWithValue("@lastSyncTime", lastSyncTime);

            var customers = new List<JtlCustomer>();
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                customers.Add(new JtlCustomer
                {
                    KKunde = Convert.ToInt64(reader["kKunde"]),
                    CKundenNr = reader["cKundenNr"]?.ToString() ?? "",
                    CMail = reader["cMail"]?.ToString() ?? "",
                    CVorname = reader["cVorname"]?.ToString() ?? "",
                    CNachname = reader["cNachname"]?.ToString() ?? "",
                    CFirma = reader["cFirma"]?.ToString() ?? "",
                    CPLZ = reader["cPLZ"]?.ToString() ?? "",
                    COrt = reader["cOrt"]?.ToString() ?? "",
                    CLand = reader["cLand"]?.ToString() ?? "DE",
                    DErstellt = reader["dErstellt"] == DBNull.Value ? DateTime.MinValue : Convert.ToDateTime(reader["dErstellt"]),
                    DGeaendert = reader["dGeaendert"] == DBNull.Value ? DateTime.MinValue : Convert.ToDateTime(reader["dGeaendert"])
                });
            }

            return customers;
        }

        public async Task<List<JtlInventory>> GetInventoryAsync(CancellationToken ct = default)
        {
            const string sql = @"
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
SELECT lb.kArtikel, 0 AS kWarenLager, 'Default' AS warehouse_name,
    ISNULL(lb.fVerfuegbar,0) AS fVerfuegbar,
    ISNULL(lb.fInAuftraegen,0) AS fReserviert,
    ISNULL(lb.fLagerbestand,0) AS fGesamt,
    ISNULL(lb.fVerfuegbarGesperrt,0) AS fGesperrt
FROM dbo.tlagerbestand lb WITH (NOLOCK)
WHERE ISNULL(lb.fLagerbestand,0)>0 OR ISNULL(lb.fVerfuegbar,0)>0";

            await using var conn = await OpenConnectionAsync(ct);
            await using var cmd = new SqlCommand(sql, conn);
            cmd.CommandTimeout = 120;

            var inventory = new List<JtlInventory>();
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                inventory.Add(new JtlInventory
                {
                    KArtikel = Convert.ToInt64(reader["kArtikel"]),
                    KWarenLager = Convert.ToInt32(reader["kWarenLager"]),
                    WarehouseName = reader["warehouse_name"]?.ToString() ?? "Default",
                    FVerfuegbar = Convert.ToDecimal(reader["fVerfuegbar"]),
                    FReserviert = Convert.ToDecimal(reader["fReserviert"]),
                    FGesamt = Convert.ToDecimal(reader["fGesamt"]),
                    FGesperrt = Convert.ToDecimal(reader["fGesperrt"])
                });
            }

            return inventory;
        }

        public async Task<int> GetOrdersCountAsync(DateTime lastSyncTime, DateTime syncEndTime, CancellationToken ct = default)
        {
            const string sql = @"
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
SELECT COUNT(*) FROM Verkauf.tAuftrag a WITH (NOLOCK)
WHERE ISNULL(a.nStorno,0)=0 AND a.dErstellt>=@lastSyncTime AND a.dErstellt<@syncEndTime";

            await using var conn = await OpenConnectionAsync(ct);
            await using var cmd = new SqlCommand(sql, conn);
            cmd.CommandTimeout = 60;
            cmd.Parameters.AddWithValue("@lastSyncTime", lastSyncTime);
            cmd.Parameters.AddWithValue("@syncEndTime", syncEndTime);
            var result = await cmd.ExecuteScalarAsync(ct);
            return Convert.ToInt32(result);
        }
    }
}
