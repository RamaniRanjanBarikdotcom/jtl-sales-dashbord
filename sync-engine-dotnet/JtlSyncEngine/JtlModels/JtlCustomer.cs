using System;

namespace JtlSyncEngine.JtlModels
{
    public class JtlCustomer
    {
        public long KKunde { get; set; }
        public string CKundenNr { get; set; } = "";
        public string CMail { get; set; } = "";
        public string CVorname { get; set; } = "";
        public string CNachname { get; set; } = "";
        public string CFirma { get; set; } = "";
        public string CPLZ { get; set; } = "";
        public string COrt { get; set; } = "";
        public string CLand { get; set; } = "DE";
        public DateTime DErstellt { get; set; }
        public DateTime DGeaendert { get; set; }
    }
}
