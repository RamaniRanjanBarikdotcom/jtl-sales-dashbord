namespace JtlSyncEngine.JtlModels
{
    public class JtlInventory
    {
        public long KArtikel { get; set; }
        public int KWarenLager { get; set; }
        public string WarehouseName { get; set; } = "Default";
        public decimal FVerfuegbar { get; set; }
        public decimal FReserviert { get; set; }
        public decimal FGesamt { get; set; }
        public decimal FGesperrt { get; set; }
        public decimal FMindestbestand { get; set; }
    }
}
