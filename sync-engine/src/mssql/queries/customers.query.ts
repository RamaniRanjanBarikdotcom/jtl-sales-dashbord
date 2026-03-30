import { getPool, sql } from '../connection';

export interface RawCustomer {
    kKunde:     number;
    cMail:      string;
    cVorname:   string;
    cNachname:  string;
    cFirma:     string | null;
    cPLZ:       string | null;
    cOrt:       string | null;
    cLand:      string | null;
    dErstellt:  Date;
    dGeaendert: Date;
}

export async function queryCustomers(lastSyncTime: Date): Promise<RawCustomer[]> {
    const pool = await getPool();
    const req  = pool.request();
    req.input('lastSyncTime', sql.DateTime2, lastSyncTime);

    // tRechnungsadresse: last name = cName (not cNachname), email = cMail
    const result = await req.query<RawCustomer>(`
        SELECT
            k.kKunde,
            ISNULL(r.cMail,    '')  AS cMail,
            ISNULL(r.cVorname, '')  AS cVorname,
            ISNULL(r.cName,    '')  AS cNachname,
            r.cFirma,
            r.cPLZ, r.cOrt, r.cLand,
            k.dErstellt,
            k.dGeaendert
        FROM dbo.tKunde k WITH (NOLOCK)
        LEFT JOIN dbo.tRechnungsadresse r WITH (NOLOCK)
            ON r.kKunde = k.kKunde
        WHERE k.dGeaendert >= @lastSyncTime
    `);
    return result.recordset;
}
