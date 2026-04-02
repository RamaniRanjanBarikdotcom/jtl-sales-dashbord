namespace JtlSyncEngine.Models
{
    /// <summary>
    /// Holds the results of a one-time schema detection query against the JTL Wawi
    /// database. Different JTL Wawi versions have slightly different table/column
    /// structures. Detecting once at startup lets us build the right SQL for every
    /// supported version without hard-coding version numbers.
    /// </summary>
    public class JtlSchema
    {
        /// <summary>dbo.tAbfrageStatus exists (order-status lookup table). Missing in some older versions.</summary>
        public bool HasTAbfrageStatus { get; set; }

        /// <summary>dbo.tlagerbestand.kWarenLager column exists (per-warehouse stock rows). Absent in single-warehouse JTL installations.</summary>
        public bool HasKWarenLager { get; set; }

        /// <summary>dbo.tWarenLager table exists (warehouse master data).</summary>
        public bool HasTWarenLager { get; set; }

        /// <summary>dbo.tKunde.dGeaendert column exists (customer last-modified timestamp).</summary>
        public bool HasKundeGeaendert { get; set; }

        /// <summary>dbo.tArtikel.fMindestbestand column exists (reorder point / min stock level).</summary>
        public bool HasFMindestbestand { get; set; }
    }
}
