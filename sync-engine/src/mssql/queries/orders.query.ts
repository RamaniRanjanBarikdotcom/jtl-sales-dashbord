import { getPool, sql } from '../connection';

export interface RawOrder {
    kBestellung:              number;
    cBestellNr:               string;
    dErstellt:                Date;
    kKunde:                   number;
    fGesamtsumme:             number;
    fVersandkostenNetto:      number;
    cStatus:                  string;
    dGeaendert:               Date;
    channel_name:             string | null;
    cExterneAuftragsnummer:   string | null;
    cKundenNr:                string | null;
    zahlungsart_name:         string | null;
    versandart_name:          string | null;
}

export interface RawOrderItem {
    kBestellPos:   number;
    kBestellung:   number;
    kArtikel:      number;
    nAnzahl:       number;
    fVKPreis:      number;
    fVKPreisNetto: number;
    fEKPreis:      number;
    nRabatt:       number;
    cName:         string;
}

export async function queryOrders(
    lastSyncTime: Date,
    syncEndTime: Date,
    offset: number,
    batchSize: number,
): Promise<RawOrder[]> {
    const pool = await getPool();
    const req = pool.request();
    req.input('lastSyncTime', sql.DateTime2, lastSyncTime);
    req.input('syncEndTime',  sql.DateTime2, syncEndTime);
    req.input('offset',       sql.Int,       offset);
    req.input('batchSize',    sql.Int,       batchSize);

    const result = await req.query<RawOrder>(`
        SELECT
            a.kAuftrag                                                              AS kBestellung,
            a.cAuftragsNr                                                           AS cBestellNr,
            a.dErstellt,
            a.kKunde,
            a.cExterneAuftragsnummer,
            k.cKundenNr,
            za.cName                                                                AS zahlungsart_name,
            va.cName                                                                AS versandart_name,
            CAST(ROUND(SUM(ISNULL(ap.fVkPreis, 0) * ISNULL(ap.fAnzahl, 1)), 2) AS DECIMAL(18,2)) AS fGesamtsumme,
            0.0                                                                     AS fVersandkostenNetto,
            'Offen'                                                                 AS cStatus,
            a.dErstellt                                                             AS dGeaendert,
            p.cName                                                                 AS channel_name
        FROM Verkauf.tAuftrag a
        LEFT JOIN Verkauf.tAuftragPosition ap ON ap.kAuftrag = a.kAuftrag
        LEFT JOIN tPlattform p ON p.nPlattform = a.kPlattform
        LEFT JOIN tKunde k ON k.kKunde = a.kKunde
        LEFT JOIN tZahlungsart za ON za.kZahlungsart = a.kZahlungsart
        LEFT JOIN tversandart va ON va.kVersandart = a.kVersandart
        WHERE ISNULL(a.nStorno, 0) = 0
          AND a.dErstellt >= @lastSyncTime
          AND a.dErstellt <  @syncEndTime
        GROUP BY
            a.kAuftrag, a.cAuftragsNr, a.dErstellt, a.kKunde,
            a.cExterneAuftragsnummer, k.cKundenNr, za.cName, va.cName, p.cName
        ORDER BY a.dErstellt ASC
        OFFSET @offset ROWS FETCH NEXT @batchSize ROWS ONLY
    `);
    return result.recordset;
}

export async function queryOrderItems(orderIds: number[]): Promise<RawOrderItem[]> {
    if (orderIds.length === 0) return [];
    const pool = await getPool();
    const req = pool.request();

    const params = orderIds.map((id, i) => {
        req.input(`id${i}`, sql.Int, id);
        return `@id${i}`;
    }).join(',');

    const result = await req.query<RawOrderItem>(`
        SELECT
            ap.kAuftragPosition                       AS kBestellPos,
            ap.kAuftrag                               AS kBestellung,
            ISNULL(ap.kArtikel, 0)                    AS kArtikel,
            ISNULL(ap.fAnzahl, 0)                     AS nAnzahl,
            ISNULL(ap.fVkPreis, 0)                    AS fVKPreis,
            ISNULL(ap.fVkNetto, 0)                    AS fVKPreisNetto,
            ISNULL(ap.fEkNetto, 0)                    AS fEKPreis,
            ISNULL(ap.fRabatt, 0)                     AS nRabatt,
            ISNULL(ap.cName, '')                      AS cName
        FROM Verkauf.tAuftragPosition ap
        WHERE ap.kAuftrag IN (${params})
          AND ap.nType = 1
    `);
    return result.recordset;
}
