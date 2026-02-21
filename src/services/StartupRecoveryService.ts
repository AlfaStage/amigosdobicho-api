/**
 * StartupRecoveryService — Runs ONCE at server boot.
 * Checks for missing data from today and creates a recovery queue.
 */
import { getDb, saveDatabase } from '../database/schema.js';
import { todayStr } from '../utils/helpers.js';
import { fetchAllResultados, fetchPalpites, savePalpites, fetchCotacoes, saveCotacoes, fetchHoroscopo } from './ScraperService.js';
import { getHoroscopo, saveHoroscopo } from './HoroscopoService.js';
import { ingestResult, type ResultadoInput } from './AmigosDoBichoService.js';
import { notifyAll } from './WebhookService.js';
import { mapLotteryToSlug } from '../utils/helpers.js';
import { getLotericaBySlug } from './LotericasService.js';
import { log } from '../utils/Logger.js';
import crypto from 'crypto';

const RECOVERY_DELAY_MS = 2000; // 2s between recovery attempts

interface MissingDraw {
    slug: string;
    estado: string;
    horario: string;
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Main entry point — called once at boot, between DB init and Cron init.
 */
export async function runStartupRecovery(): Promise<void> {
    const today = todayStr();
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    log.separator('RECOVERY', 'STARTUP RECOVERY');
    log.info('RECOVERY', `Verificando dados faltantes de hoje (${today})...`, {
        hora_atual: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
    });

    const db = getDb();

    // 1. Check missing draws based on dynamic database expectations
    const missingDraws: MissingDraw[] = [];

    const statusRows = db.exec(
        "SELECT loterica_slug, horario FROM scraping_status WHERE data = ? AND status IN ('pending', 'retrying')",
        [today]
    );

    if (statusRows.length > 0 && statusRows[0].values.length > 0) {
        for (const row of statusRows[0].values) {
            const [slug, horarioStr] = row as [string, string];

            const [h, m] = horarioStr.split(':').map(Number);
            const scheduledMinutes = h * 60 + m;

            // Only check draws that should have already happened (with 2min grace)
            if (currentMinutes < scheduledMinutes + 2) continue;

            const lotInfo = getLotericaBySlug(slug);
            if (lotInfo) {
                missingDraws.push({ slug, estado: lotInfo.estado, horario: horarioStr });
            }
        }
    }

    // 2. Check palpites
    let palpitesMissing = false;
    if (currentMinutes >= 7 * 60) {  // After 07:00
        const palpRows = db.exec("SELECT id FROM palpites_dia WHERE data = ?", [today]);
        palpitesMissing = !palpRows.length || !palpRows[0].values.length;
    }

    // 3. Check cotações e horoscopo
    let cotacoesMissing = false;
    let horoscopoMissing = false;
    if (currentMinutes >= 7 * 60) {
        const cotRows = db.exec("SELECT id FROM cotacoes LIMIT 1");
        cotacoesMissing = !cotRows.length || !cotRows[0].values.length;

        const horoRows = db.exec("SELECT id FROM horoscopo WHERE data = ?", [today]);
        horoscopoMissing = !horoRows.length || !horoRows[0].values.length;
    }

    // Summary
    const totalMissing = missingDraws.length + (palpitesMissing ? 1 : 0) + (cotacoesMissing ? 1 : 0) + (horoscopoMissing ? 1 : 0);

    if (totalMissing === 0) {
        log.success('RECOVERY', 'Nenhum dado faltante! Tudo em dia ✨');
        log.separator('RECOVERY');
        return;
    }

    log.warn('RECOVERY', `${totalMissing} itens faltantes detectados:`, {
        sorteios: missingDraws.length,
        palpites: palpitesMissing ? 'SIM' : 'OK',
        cotacoes: cotacoesMissing ? 'SIM' : 'OK',
        horoscopo: horoscopoMissing ? 'SIM' : 'OK',
    });

    if (missingDraws.length > 0) {
        log.table('RECOVERY', missingDraws.map(d => ({
            loterica: d.slug, horario: d.horario, estado: d.estado,
        })));
    }

    // 4. Execute recovery: palpites + cotações first
    let recovered = 0;
    let failed = 0;

    if (palpitesMissing) {
        try {
            log.info('RECOVERY', 'Buscando palpites do dia...');
            const palpites = await fetchPalpites();
            if (palpites.grupos.length || palpites.milhares.length) {
                savePalpites(today, palpites);
                log.success('RECOVERY', 'Palpites recuperados', {
                    grupos: palpites.grupos.length,
                    milhares: palpites.milhares.length,
                });
                recovered++;
            } else {
                log.warn('RECOVERY', 'Palpites: API retornou vazio');
                failed++;
            }
        } catch (err) {
            log.error('RECOVERY', 'Falha ao buscar palpites', err);
            failed++;
        }
        await sleep(RECOVERY_DELAY_MS);
    }

    if (cotacoesMissing) {
        try {
            log.info('RECOVERY', 'Buscando cotações...');
            const cotacoes = await fetchCotacoes();
            if (cotacoes.length) {
                saveCotacoes(cotacoes);
                log.success('RECOVERY', 'Cotações recuperadas', { total: cotacoes.length });
                recovered++;
            } else {
                log.warn('RECOVERY', 'Cotações: API retornou vazio');
                failed++;
            }
        } catch (err) {
            log.error('RECOVERY', 'Falha ao buscar cotações', err);
            failed++;
        }
        await sleep(RECOVERY_DELAY_MS);
    }

    if (horoscopoMissing) {
        try {
            log.info('RECOVERY', 'Buscando horóscopo...');
            const horo = await fetchHoroscopo();
            if (horo.length) {
                saveHoroscopo(db, today, horo);
                log.success('RECOVERY', 'Horóscopo recuperado', { total: horo.length });
                recovered++;
            } else {
                log.warn('RECOVERY', 'Horóscopo: API retornou vazio');
                failed++;
            }
        } catch (err) {
            log.error('RECOVERY', 'Falha ao buscar horóscopo', err);
            failed++;
        }
        await sleep(RECOVERY_DELAY_MS);
    }

    // 5. Recovery draws — fetch all results once, then match
    if (missingDraws.length > 0) {
        log.info('RECOVERY', `Buscando resultados para ${missingDraws.length} sorteios faltantes...`);

        const groupedDraws = missingDraws.reduce((acc, draw) => {
            if (!acc[draw.slug]) acc[draw.slug] = [];
            acc[draw.slug].push(draw);
            return acc;
        }, {} as Record<string, MissingDraw[]>);

        try {
            const allResults = await fetchAllResultados();
            log.info('RECOVERY', `API retornou ${allResults.length} resultados brutos`);

            for (const [slug, drawsArr] of Object.entries(groupedDraws)) {
                const horariosJoined = drawsArr.map(d => d.horario).join(', ');
                const estado = drawsArr[0].estado;

                log.info('SCRAPER', `Buscando ${slug} para ${today} ${horariosJoined}...`, { estado });

                const notFound: string[] = [];

                for (const draw of drawsArr) {
                    try {
                        let found = false;

                        for (const r of allResults) {
                            const mappedSlug = mapLotteryToSlug(r.lottery || r.name || '', draw.estado);
                            if (mappedSlug !== draw.slug) continue;

                            const premios = (r.results || r.prizes || r.premios || []).map((p: any, i: number) => ({
                                posicao: p.premio || p.position || p.posicao || i + 1,
                                milhar: String(p.milhar || p.number || p.numero || '').padStart(4, '0'),
                            }));

                            let nomeOriginal = r.lottery || r.name || '';
                            nomeOriginal = nomeOriginal.replace(/\b(nova|novo|loteria|da|de|do|dos|das|extração|extracao)\b/gi, '').replace(/\s+/g, ' ').trim();

                            const input: ResultadoInput = {
                                loterica: draw.slug,
                                estado: draw.estado,
                                data: today,
                                horario: draw.horario,
                                nome_original: nomeOriginal,
                                premios,
                                disableWebhooks: true, // Silenciar webhooks no Recovery
                            };

                            const result = ingestResult(input);
                            if (result.saved) {
                                found = true;
                                // Upsert scraping_status
                                db.run(
                                    `INSERT INTO scraping_status (id, loterica_slug, data, horario, status, updated_at)
                     VALUES (?, ?, ?, ?, 'success', datetime('now'))
                     ON CONFLICT(loterica_slug, data, horario) DO UPDATE SET status = 'success', updated_at = datetime('now')`,
                                    [crypto.randomUUID(), draw.slug, today, draw.horario]
                                );
                                saveDatabase();

                                log.success('RECOVERY', `Recuperado: ${draw.slug} ${draw.horario}`);
                                recovered++;
                                break;
                            }
                        }

                        if (!found) {
                            notFound.push(draw.horario);
                            failed++;
                        }

                        await sleep(500); // Small delay between draws
                    } catch (err) {
                        log.error('RECOVERY', `Erro ao recuperar ${draw.slug} ${draw.horario}`, err);
                        failed++;
                    }
                }

                if (notFound.length > 0) {
                    log.warn('SCRAPER', `⚠️  Resultado não encontrado: ${slug} ${notFound.join(', ')} (retrying)`);
                }
            }
        } catch (err) {
            log.error('RECOVERY', 'Falha fatal ao buscar resultados da API', err);
            failed += missingDraws.length;
        }
    }

    // 6. Final summary
    log.separator('RECOVERY', 'RECOVERY SUMMARY');
    log.info('RECOVERY', `Concluído: ${recovered} recuperados, ${failed} pendentes de ${totalMissing} total`);
    log.separator('RECOVERY');
}
