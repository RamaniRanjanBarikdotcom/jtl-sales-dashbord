using System;

namespace JtlSyncEngine.JtlModels
{
    public class JtlProduct
    {
        public long KArtikel { get; set; }
        public string CArtNr { get; set; } = "";
        public string CName { get; set; } = "";
        public decimal FEKNetto { get; set; }
        public decimal FVKNetto { get; set; }
        public decimal FVKBrutto { get; set; }
        public decimal FGewicht { get; set; }
        public string CBarcode { get; set; } = "";
        public DateTime DMod { get; set; }
        public int KWarengruppe { get; set; }
        public string CategoryName { get; set; } = "";
        public decimal FVerfuegbar { get; set; }

        // Parent/child variant relationship
        public long KVaterArtikel { get; set; }     // 0 = standalone, >0 = variant child
        public int NIstVater { get; set; }          // 1 = parent article with variants

        // Search keywords
        public string CSuchbegriffe { get; set; } = "";
    }
}
