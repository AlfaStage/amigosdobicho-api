import { getDb, saveDatabase } from '../database/schema.js';
import crypto from 'crypto';
import { log } from '../utils/Logger.js';
import { generateDynamicSlug } from '../utils/helpers.js';

export interface HorarioApendizado {
    horario: string;
    dias: number[];
    falhas_consecutivas: number;
}

export interface LotericaBD {
    id: string;
    slug: string;
    nome: string;
    estado: string;
    horarios: HorarioApendizado[];
}

/**
 * Retorna todas as loterias do Banco de Dados.
 * Essa é a nova fonte central (substituindo o antigo lotericas.ts estático).
 */
export function getAllLotericas(): LotericaBD[] {
    const db = getDb();
    const rows = db.exec('SELECT id, slug, nome, estado, horarios FROM lotericas');
    if (!rows.length) return [];

    return rows[0].values.map((r: any) => {
        let parsedHorarios: HorarioApendizado[] = [];
        try {
            const raw = JSON.parse(r[4] as string);
            // Garante que a estrutura antiga ganhe o campo de falhas_consecutivas = 0
            parsedHorarios = raw
                .filter((h: any) => h && typeof h.horario === 'string')
                .map((h: any) => ({
                    horario: h.horario,
                    dias: h.dias || [0, 1, 2, 3, 4, 5, 6],
                    falhas_consecutivas: h.falhas_consecutivas || 0
                }));
        } catch (e) {
            log.warn('DB', `Erro ao fazer parse dos horários da lotérica ${r[1]}`);
        }

        return {
            id: r[0],
            slug: r[1],
            nome: r[2],
            estado: r[3],
            horarios: parsedHorarios
        };
    });
}

/**
 * Retorna uma loteria pelo Slug.
 */
export function getLotericaBySlug(slug: string): LotericaBD | undefined {
    return getAllLotericas().find(l => l.slug === slug);
}

/**
 * Auto-Learning: Descobre ou resgata uma Loteria baseado no nome cru vindo da API externa.
 */
export function learnOrGetLoterica(nomeOriginal: string, estado: string, slugEsperado: string): LotericaBD {
    const loterias = getAllLotericas();

    const existente = loterias.find(l => l.slug === slugEsperado);
    if (existente) return existente;

    // Se chegou aqui, é uma nova loteria que o sistema nunca viu!
    const db = getDb();
    const id = crypto.randomUUID();
    const horariosVazios = JSON.stringify([]);

    log.info('AUTO-LEARN', `🎉 Nova Lotérica Descoberta: ${nomeOriginal} (${estado}) -> Slug: ${slugEsperado}`);

    db.run(
        'INSERT INTO lotericas (id, slug, nome, estado, horarios) VALUES (?, ?, ?, ?, ?)',
        [id, slugEsperado, nomeOriginal, estado, horariosVazios]
    );
    saveDatabase();

    return {
        id,
        slug: slugEsperado,
        nome: nomeOriginal,
        estado,
        horarios: []
    };
}

/**
 * Auto-Learning: Atualiza o JSON de horários para aprender que essa loteria ocorre "neste horário" e "neste dia da semana".
 * Também reseta as falhas_consecutivas caso a API retorne resultados verdadeiros.
 */
export function learnOrConfirmSchedule(slug: string, horario: string, diaDaSemana: number): void {
    if (!horario || typeof horario !== 'string') return;
    const loterica = getLotericaBySlug(slug);
    if (!loterica) return;

    let modified = false;
    let foundTime = false;

    // Normalizar horário (ex: 14:20:00 -> 14:20:00 ... garantir string certa)
    const normalizedTime = horario.split(':').length === 2 ? `${horario}:00` : horario;

    const novosHorarios = loterica.horarios.map(h => {
        if (!h.horario) return h;
        // Se encontramos o slot de tempo que estamos ensinando
        if (h.horario.substring(0, 5) === normalizedTime.substring(0, 5)) {
            foundTime = true;
            // Se o dia não estava no array, o sistema aprende que esse sorteio agora ocorre nesse dia também
            if (!h.dias.includes(diaDaSemana)) {
                h.dias.push(diaDaSemana);
                modified = true;
                log.info('AUTO-LEARN', `📅 Lotérica ${slug} (${normalizedTime}) também corre no dia da semana ${diaDaSemana}.`);
            }
            // Sucesso anula qualquer falha penalizada anteriormente
            if (h.falhas_consecutivas > 0) {
                h.falhas_consecutivas = 0;
                modified = true;
                log.info('AUTO-LEARN', `✅ Lotérica ${slug} (${normalizedTime}) recuperou comunicação. Falhas zeradas.`);
            }
        }
        return h;
    });

    if (!foundTime) {
        // Horário 100% inédito!
        novosHorarios.push({
            horario: normalizedTime,
            dias: [diaDaSemana],
            falhas_consecutivas: 0
        });
        modified = true;
        log.info('AUTO-LEARN', `⏰ Novo Horário Descoberto para ${slug}: ${normalizedTime}`);
    }

    if (modified) {
        const db = getDb();
        db.run('UPDATE lotericas SET horarios = ? WHERE slug = ?', [JSON.stringify(novosHorarios), slug]);
        saveDatabase();
    }
}

/**
 * Limpeza: Penaliza um horário. Se bater o limite (ex: 7), remove do array e desaprende. 
 */
export function penalizeSchedule(slug: string, horario: string): void {
    if (!horario || typeof horario !== 'string') return;
    const loterica = getLotericaBySlug(slug);
    if (!loterica) return;

    const normalizedTime = horario.substring(0, 5);
    const limiteFalhas = 7;
    let removed = false;

    const novosHorarios = loterica.horarios.map(h => {
        if (!h.horario) return h;
        if (h.horario.substring(0, 5) === normalizedTime) {
            h.falhas_consecutivas += 1;
            log.warn('AUTO-LEARN', `📉 Lotérica ${slug} (${horario}) sofreu penalidade: ${h.falhas_consecutivas}/${limiteFalhas} falhas consecutivas ignoradas pela API.`);
        }
        return h;
    }).filter(h => {
        if (h.falhas_consecutivas >= limiteFalhas) {
            log.warn('AUTO-LEARN', `🗑️ Esqueçendo Horário Permanentemente: ${slug} (${h.horario}). Motivo: Ausente na API por ${limiteFalhas} dias sucessivos.`);
            removed = true;
            return false;
        }
        return true;
    });

    const db = getDb();
    db.run('UPDATE lotericas SET horarios = ? WHERE slug = ?', [JSON.stringify(novosHorarios), slug]);
    saveDatabase();
}
