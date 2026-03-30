import { getPool, sql } from '../connection';

export interface RawProduct {
    kArtikel:      number;
    cArtNr:        string;
    cName:         string;
    fEKNetto:      number;
    fVKNetto:      number;
    fVKBrutto:     number;
    fGewicht:      number;
    cBarcode:      string | null;
    dMod:          Date;
    kKategorie:    number | null;
    category_name: string | null;
    fVerfuegbar:   number;
}

export async function queryProducts(lastSyncTime: Date): Promise<RawProduct[]> {
    const pool = await getPool();
    const req  = pool.request();
    req.input('lastSyncTime', sql.DateTime2, lastSyncTime);

    const result = await req.query<RawProduct>(`
        SELECT
            a.kArtikel,
            a.cArtNr,
            ISNULL(ab.cName, a.cArtNr)          AS cName,
            ISNULL(a.fEKNetto,  0)               AS fEKNetto,
            ISNULL(a.fVKNetto,  0)               AS fVKNetto,
            ROUND(ISNULL(a.fVKNetto, 0) * 1.19, 2) AS fVKBrutto,
            ISNULL(a.fGewicht,  0)               AS fGewicht,
            a.cBarcode,
            a.dMod,
            a.kWarengruppe                       AS kKategorie,
            ISNULL(wg.cName, '')                 AS category_name,
            ISNULL(lb.fVerfuegbar, 0)            AS fVerfuegbar
        FROM dbo.tArtikel a WITH (NOLOCK)
        LEFT JOIN dbo.tArtikelBeschreibung ab WITH (NOLOCK)
            ON ab.kArtikel   = a.kArtikel
           AND ab.kSprache   = 1
           AND ab.kPlattform = 1
        LEFT JOIN dbo.tlagerbestand lb WITH (NOLOCK)
            ON lb.kArtikel = a.kArtikel
        LEFT JOIN dbo.tWarengruppe wg WITH (NOLOCK)
            ON wg.kWarengruppe = a.kWarengruppe
        WHERE a.kVaterArtikel = 0
          AND a.cArtNr IS NOT NULL
          AND a.cArtNr <> ''
          AND a.dMod >= @lastSyncTime
    `);
    return result.recordset;
}
