using System;
using System.Collections.Generic;

namespace JtlSyncEngine.JtlModels
{
    public class JtlOrder
    {
        public long KAuftrag { get; set; }
        public string CAuftragsNr { get; set; } = "";
        public DateTime DErstellt { get; set; }
        public long KKunde { get; set; }
        public string CKundenNr { get; set; } = "";
        public string CExterneAuftragsnummer { get; set; } = "";
        public int KVersandArt { get; set; }
        public int KZahlungsart { get; set; }
        public int NStorno { get; set; }
        public string ChannelName { get; set; } = "";
        public string VersandartName { get; set; } = "";
        public string ZahlungsartName { get; set; } = "";
        public string CStatus { get; set; } = "Offen";
        public string CPLZ { get; set; } = "";
        public decimal FVersandkostenNetto { get; set; }
        public decimal FGesamtsumme { get; set; }
        public decimal FGesamtsummeNetto { get; set; }

        // Enriched with items after fetch
        public List<JtlOrderItem> Items { get; set; } = new();
    }
}
