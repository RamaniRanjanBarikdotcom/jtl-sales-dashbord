import { getPool } from '../connection';

export interface RawInventory {
    kArtikel:        number;
    kWarenLager:     number;
    warehouse_name:  string;
    fVerfuegbar:     number;
    fReserviert:     number;
    fGesamt:         number;
    fMindestbestand: number;
}

// tlagerbestand is a flat per-article table — no warehouse FK in this JTL version
export async function queryInventory(): Promise<RawInventory[]> {
    const pool = await getPool();
    const req  = pool.request();

    const result = await req.query<RawInventory>(`
        SELECT
            wb.kArtikel,
            0                               AS kWarenLager,
            'Default'                       AS warehouse_name,
            ISNULL(wb.fVerfuegbar,    0)    AS fVerfuegbar,
            0                               AS fReserviert,
            ISNULL(wb.fLagerbestand,  0)    AS fGesamt,
            0                               AS fMindestbestand
        FROM dbo.tlagerbestand wb WITH (NOLOCK)
        WHERE ISNULL(wb.fVerfuegbar, 0) > 0
    `);
    return result.recordset;
}
