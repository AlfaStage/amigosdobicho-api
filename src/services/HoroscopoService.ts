import { saveDatabase } from '../database/schema.js';

export const SIGNOS = [
    'Áries', 'Touro', 'Gêmeos', 'Câncer', 'Leão', 'Virgem',
    'Libra', 'Escorpião', 'Sagitário', 'Capricórnio', 'Aquário', 'Peixes',
] as const;

export type Signo = typeof SIGNOS[number];

export interface HoroscopoEntry {
    signo: Signo;
    texto: string;
    numeros: number[];
}

export interface HoroscopoDia {
    data: string;
    signos: HoroscopoEntry[];
}

export function getHoroscopo(db: any, data: string): HoroscopoDia | null {
    const rows = db.exec(
        'SELECT signo, texto, numeros FROM horoscopo WHERE data = ? ORDER BY signo',
        [data]
    );

    if (rows.length && rows[0].values.length) {
        const signos: HoroscopoEntry[] = rows[0].values.map((row: any[]) => ({
            signo: row[0] as Signo,
            texto: row[1] as string,
            numeros: JSON.parse(row[2] as string || '[]'),
        }));
        return { data, signos };
    }

    return null;
}

/**
 * Saves horoscope entries for a date.
 */
export function saveHoroscopo(db: any, data: string, entries: HoroscopoEntry[]): void {
    const stmt = db.prepare(
        'INSERT OR REPLACE INTO horoscopo (id, data, signo, texto, numeros) VALUES (?, ?, ?, ?, ?)'
    );

    for (const entry of entries) {
        stmt.run([crypto.randomUUID(), data, entry.signo, entry.texto, JSON.stringify(entry.numeros)]);
    }

    stmt.free();
    saveDatabase();
}
