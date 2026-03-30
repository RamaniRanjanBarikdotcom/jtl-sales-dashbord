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
    }
}
