namespace JtlSyncEngine.JtlModels
{
    public class JtlOrderItem
    {
        public long KAuftragPosition { get; set; }
        public long KAuftrag { get; set; }
        public long KArtikel { get; set; }
        public decimal FAnzahl { get; set; }
        public decimal FVkNetto { get; set; }
        public decimal FVkBrutto { get; set; }
        public decimal FEkNetto { get; set; }
        public decimal FRabatt { get; set; }
        public string CName { get; set; } = "";
        public string CArtNr { get; set; } = "";
    }
}
