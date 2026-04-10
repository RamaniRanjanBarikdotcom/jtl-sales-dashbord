namespace JtlSyncEngine.Models
{
    /// <summary>
    /// Detected once at startup against SQL Server metadata tables (OBJECT_ID /
    /// COL_LENGTH).  Every flag represents one optional column or table that exists
    /// in some JTL Wawi versions but not others.  All queries in MssqlService are
    /// built dynamically from these flags so the engine works on any version.
    /// </summary>
    public class JtlSchema
    {
        // ── Verkauf.tAuftrag ────────────────────────────────────────────────
        public bool HasFVersandkostenNetto    { get; set; }   // shipping cost on order header
        public bool HasCExterneAuftragsnummer { get; set; }   // external order reference
        public bool HasKAbfrageStatus         { get; set; }   // FK to order-status table
        public bool HasKPlattform             { get; set; }   // FK to sales channel table

        // ── Verkauf.tAuftragPosition ────────────────────────────────────────
        public bool HasPositionMwSt   { get; set; }   // VAT % per line
        public bool HasPositionEkNetto { get; set; }  // purchase price per line
        public bool HasPositionRabatt  { get; set; }  // discount % per line
        public bool HasPositionWertFixiert { get; set; }  // fWertNettoGesamtFixiert (finalized totals)

        // ── Lookup tables (JOINed from orders) ─────────────────────────────
        public bool HasTAbfrageStatus { get; set; }   // order status lookup table
        public bool HasTPlattform     { get; set; }   // sales channel lookup
        public bool HasTversandart    { get; set; }   // shipping method lookup
        public bool HasTZahlungsart   { get; set; }   // payment method lookup

        // ── dbo.tArtikel ────────────────────────────────────────────────────
        public bool HasArtikelDMod       { get; set; }  // last-modified timestamp
        public bool HasArtikelBarcode    { get; set; }  // EAN / barcode
        public bool HasArtikelGewicht    { get; set; }  // weight
        public bool HasKVaterArtikel     { get; set; }  // parent-article FK (variant filter)
        public bool HasNIstVater         { get; set; }  // 1 = this is a parent article
        public bool HasNDelete           { get; set; }  // soft-delete flag
        public bool HasTArtikelBeschreibung { get; set; } // article description table
        public bool HasTWarengruppe      { get; set; }  // product category table
        public bool HasCSuchbegriffe     { get; set; }  // search keywords

        // ── Category tables ─────────────────────────────────────────────────
        public bool HasTKategorieArtikel    { get; set; }  // tKategorieArtikel or tArtikelInKategorie
        public bool HasTKategorieSprache    { get; set; }  // category name lookup

        // ── dbo.tKunde ──────────────────────────────────────────────────────
        public bool HasKundeGeaendert { get; set; }  // customer last-modified
        public bool HasKundenNr       { get; set; }  // customer number field
        public bool HasKundeNDelete   { get; set; }  // soft-delete flag on tKunde

        // ── dbo.tRechnungsadresse ───────────────────────────────────────────
        public bool HasTRechnungsadresse  { get; set; }  // billing address table
        public bool HasKRechnungsadresse  { get; set; }  // PK (used for ORDER BY latest)

        // ── Verkauf.tAuftragAdresse ─────────────────────────────────────────
        public bool HasTAuftragAdresse    { get; set; }  // order delivery address table (nTyp=1)

        // ── dbo.tlagerbestand ───────────────────────────────────────────────
        public bool HasKWarenLager        { get; set; }  // per-warehouse rows
        public bool HasFInAuftraegen      { get; set; }  // qty reserved in orders
        public bool HasFVerfuegbarGesperrt { get; set; } // qty blocked

        // ── dbo.tlagerbestandProLagerLagerartikel ───────────────────────────
        public bool HasTLagerbestandPro   { get; set; }  // preferred per-warehouse table

        // ── dbo.tWarenLager ─────────────────────────────────────────────────
        public bool HasTWarenLager    { get; set; }  // warehouse master table

        // ── dbo.tArtikel (reorder) ──────────────────────────────────────────
        public bool HasFMindestbestand { get; set; } // min stock / reorder point

        // ── dbo.tPreis (selling price table) ────────────────────────────────
        public bool HasTPreis             { get; set; }  // price table exists
        public bool HasTPreisNetto        { get; set; }  // fNettoPreis column exists
        public bool HasTPreisKundengruppe { get; set; }  // kKundengruppe column exists
    }
}
