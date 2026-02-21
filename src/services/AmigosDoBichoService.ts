import { getDb, saveDatabase } from '../database/schema.js';
import { calcularGrupo, calcularBicho } from '../config/bichos.js';
import { mapLotteryToSlug } from '../utils/helpers.js';
import { log } from '../utils/Logger.js';
import { notifyAll } from './WebhookService.js';

export interface PremioInput {
    posicao: number;
    milhar: string;
}

export interface ResultadoInput {
    loterica: string;
    estado?: string;
    data: string;
    horario: string;
    nome_original?: string;
    premios: PremioInput[];
}

/**
 * Core domain service for ingesting lottery results.
 * Handles slug mapping, uniqueness checks, atomic transactions,
 * and post-commit hooks (webhooks + premiados check).
 */
export function ingestResult(input: ResultadoInput): { saved: boolean; id?: string } {
    const db = getDb();
    const slug = mapLotteryToSlug(input.loterica, input.estado);

    if (!slug) {
        log.warn('SCRAPER', `Slug não encontrado: "${input.loterica}" (${input.estado})`);
        return { saved: false };
    }

    // Normalize time to HH:mm to avoid duplicates like "12:00" vs "12:00:00"
    const normalizedTime = input.horario.includes(':')
        ? input.horario.split(':').slice(0, 2).map(v => v.padStart(2, '0')).join(':')
        : input.horario;

    // Uniqueness check
    const nomeVal = input.nome_original || '';
    const existing = db.exec(
        "SELECT id FROM resultados WHERE data = ? AND horario = ? AND loterica_slug = ? AND nome_original = ?",
        [input.data, normalizedTime, slug, nomeVal]
    );

    if (existing.length > 0 && existing[0].values.length > 0) {
        return { saved: false };
    }

    // Atomic transaction
    const resultadoId = crypto.randomUUID();

    db.run('BEGIN TRANSACTION');
    try {
        db.run(
            'INSERT INTO resultados (id, data, horario, loterica_slug, nome_original) VALUES (?, ?, ?, ?, ?)',
            [resultadoId, input.data, normalizedTime, slug, nomeVal]
        );

        const stmtPremio = db.prepare(
            'INSERT INTO premios (id, resultado_id, posicao, milhar, grupo, bicho) VALUES (?, ?, ?, ?, ?, ?)'
        );

        for (const p of input.premios) {
            const grupo = calcularGrupo(p.milhar);
            const bicho = calcularBicho(p.milhar);
            stmtPremio.run([crypto.randomUUID(), resultadoId, p.posicao, p.milhar, grupo, bicho]);
        }

        stmtPremio.free();
        db.run('COMMIT');

        saveDatabase();
        log.success('DB', `Resultado salvo: ${slug} ${input.data} ${input.horario}`, { premios: input.premios.length });

        // Post-commit: check palpites premiados for ALL results of the day (retroactive scan)
        checkPalpitesPremiados(input.data);

        return { saved: true, id: resultadoId };
    } catch (err) {
        db.run('ROLLBACK');
        log.error('DB', `Transação falhou para ${slug}`, err);
        return { saved: false };
    }
}

/**
 * Checks if any of today's palpites match the drawn results.
 * Scans ALL results of the given date to ensure retroactive prizes are captured.
 */
export function checkPalpitesPremiados(data: string): void {
    const db = getDb();

    // Get today's palpite
    const palpiteRows = db.exec("SELECT id FROM palpites_dia WHERE data = ?", [data]);
    if (!palpiteRows.length || !palpiteRows[0].values.length) return;

    const palpiteId = palpiteRows[0].values[0][0] as string;

    // Load Palpites
    const milharesRows = db.exec("SELECT numero FROM palpites_milhares WHERE palpite_id = ?", [palpiteId]);
    const milharesPalpite = milharesRows.length ? milharesRows[0].values.map((r: any) => r[0] as string) : [];

    const centenasRows = db.exec("SELECT numero FROM palpites_centenas WHERE palpite_id = ?", [palpiteId]);
    const centenasPalpite = centenasRows.length ? centenasRows[0].values.map((r: any) => r[0] as string) : [];

    const gruposRows = db.exec("SELECT grupo FROM palpites_grupos WHERE palpite_id = ?", [palpiteId]);
    const gruposPalpite = gruposRows.length ? gruposRows[0].values.map((r: any) => r[0] as number) : [];

    // Get ALL results for the day
    const results = getResultados(data);

    for (const res of results) {
        const extracao = res.nome_original && res.nome_original.trim() !== ''
            ? res.nome_original
            : `${res.loterica_slug} - ${res.horario}`;

        for (const p of res.premios) {
            const premioLabel = `${p.posicao}º Prêmio`;
            const grupo = calcularGrupo(p.milhar);
            const centena = p.milhar.slice(-3);

            // Milhar match
            if (milharesPalpite.includes(p.milhar)) {
                insertPremiado(palpiteId, 'milhar', p.milhar, extracao, premioLabel, data, res.loterica_slug);
            }

            // Centena match
            if (centenasPalpite.includes(centena)) {
                insertPremiado(palpiteId, 'centena', centena, extracao, premioLabel, data, res.loterica_slug);
            }

            // Grupo match (ANY POSITION 1-10)
            if (gruposPalpite.includes(grupo)) {
                insertPremiado(palpiteId, 'grupo', `${calcularBicho(p.milhar)} (${String(grupo).padStart(2, '0')})`, extracao, premioLabel, data, res.loterica_slug);
            }
        }
    }
}

function insertPremiado(palpiteId: string, tipo: string, numero: string, extracao: string, premio: string, data: string, slug: string): void {
    const db = getDb();
    try {
        // Unique check: Strict check to avoid duplicate data AND duplicate webhooks
        // We check by palpite, type, number, exact lottery/time and prize position
        const existing = db.exec(
            "SELECT id FROM palpites_premiados WHERE palpite_id = ? AND tipo = ? AND numero = ? AND extracao = ? AND premio = ? AND data = ?",
            [palpiteId, tipo, numero, extracao, premio, data]
        );
        if (existing.length > 0 && existing[0].values.length > 0) return;

        const id = crypto.randomUUID();
        db.run(
            'INSERT INTO palpites_premiados (id, palpite_id, tipo, numero, extracao, premio, data) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [id, palpiteId, tipo, numero, extracao, premio, data]
        );

        log.success('SCRAPER', `Premiado! ${tipo}: ${numero} em ${extracao} (${premio})`);
        saveDatabase();

        // Dispatch individual Webhook for this specific hit
        notifyAll('palpite.premiado', {
            id,
            palpite_id: palpiteId,
            tipo,
            numero,
            extracao,
            premio,
            data,
            loterica: slug
        });

    } catch (err) {
        log.error('DB', 'Erro ao inserir premiado', err);
    }
}

/**
 * Get results for a specific date and optional loterica slug.
 */
export function getResultados(data: string, loterica?: string): any[] {
    const db = getDb();
    let query = `
    SELECT r.id, r.data, r.horario, r.loterica_slug, r.nome_original, r.created_at,
           l.nome as loterica_nome, l.estado
    FROM resultados r
    JOIN lotericas l ON l.slug = r.loterica_slug
    WHERE r.data = ?
  `;
    const params: any[] = [data];
    if (loterica) { query += ' AND r.loterica_slug = ?'; params.push(loterica); }
    query += ' ORDER BY r.data DESC, r.horario DESC';

    const rows = db.exec(query, params);
    if (!rows.length) return [];

    return rows[0].values.map((row: any[]) => {
        const id = row[0] as string;
        const premiosRows = db.exec(
            'SELECT posicao, milhar, grupo, bicho FROM premios WHERE resultado_id = ? ORDER BY posicao',
            [id]
        );
        const premios = premiosRows.length ? premiosRows[0].values.map((p: any[]) => ({
            posicao: p[0], milhar: p[1], grupo: p[2], bicho: p[3]
        })) : [];

        return {
            id: row[0], data: row[1], horario: row[2], loterica_slug: row[3],
            nome_original: row[4], created_at: row[5], loterica_nome: row[6], estado: row[7], premios
        };
    });
}



/**
 * Get a single result by ID.
 */
export function getResultadoById(id: string): any | null {
    const db = getDb();
    const rows = db.exec(`
    SELECT r.id, r.data, r.horario, r.loterica_slug, r.nome_original, r.created_at,
           l.nome as loterica_nome, l.estado
    FROM resultados r
    JOIN lotericas l ON l.slug = r.loterica_slug
    WHERE r.id = ?
  `, [id]);

    if (!rows.length || !rows[0].values.length) return null;

    const row = rows[0].values[0];
    const premiosRows = db.exec(
        'SELECT posicao, milhar, grupo, bicho FROM premios WHERE resultado_id = ? ORDER BY posicao',
        [id]
    );
    const premios = premiosRows.length ? premiosRows[0].values.map((p: any) => ({
        posicao: p[0], milhar: p[1], grupo: p[2], bicho: p[3]
    })) : [];

    return {
        id: row[0], data: row[1], horario: row[2], loterica_slug: row[3],
        nome_original: row[4], created_at: row[5], loterica_nome: row[6], estado: row[7], premios
    };
}
