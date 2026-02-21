import cron from 'node-cron';
import { LOTERICAS } from '../config/lotericas.js';
import { getDb, saveDatabase } from '../database/schema.js';
import { todayStr } from '../utils/helpers.js';
import { fetchAllResultados, fetchPalpites, savePalpites, fetchCotacoes, saveCotacoes } from './ScraperService.js';
import { ingestResult, type ResultadoInput } from './AmigosDoBichoService.js';
import { notifyAll } from './WebhookService.js';
import { runProxySweep } from './ProxyService.js';
import { mapLotteryToSlug } from '../utils/helpers.js';
import { calcularGrupo, calcularBicho } from '../config/bichos.js';
import { log } from '../utils/Logger.js';

const DELAY_MS = 60_000; // 1 minute delay after scheduled time

/**
 * Initializes all cron jobs.
 */
export function initCronJobs(): void {
    log.separator('CRON', 'SCHEDULERS');
    log.info('CRON', 'Inicializando schedulers...');

    // Every minute: check if any lottery draw should be fetched
    cron.schedule('* * * * *', () => checkScheduledDraws());

    // Morning 07:00: fetch palpites and cotações
    cron.schedule('0 7 * * *', () => morningRoutine());

    // Every hour: proxy sweep
    cron.schedule('0 * * * *', () => {
        runProxySweep().catch(err => log.error('PROXY', 'Proxy sweep falhou', err));
    });

    // Every 10 minutes: retry failed scraping
    cron.schedule('*/10 * * * *', () => retryFailed());

    // Último dia do mês às 23:00: auditoria de marketing e hot-swap
    cron.schedule('0 23 28-31 * *', () => {
        // Verifica se o dia seguinte é dia 1 (ou seja, hoje é o último dia do mês)
        const amanhã = new Date();
        amanhã.setDate(amanhã.getDate() + 1);

        if (amanhã.getDate() === 1) {
            log.info('CRON', 'Último dia do mês detectado. Executando checkup e Hot-Swap das lotéricas...');
            import('./MarketingAuditService.js').then(module => {
                module.MarketingAuditService.runAudit().catch(err => {
                    log.error('CRON', 'Falha na auditoria mensal de marketing.', err);
                });
            }).catch(e => {
                log.error('CRON', 'Erro ao carregar módulo MarketingAuditService.', e);
            });
        }
    });

    log.info('CRON', 'Schedulers ativos:', {
        draw_monitor: '1min',
        morning_palpites: '07:00',
        proxy_sweep: '1h',
        retry_failed: '10min',
        monthly_audit: '23:00 ultimo dia_mes',
    });
}

/**
 * Checks if any draw should be fetched right now.
 */
async function checkScheduledDraws(): Promise<void> {
    const now = new Date();
    const today = todayStr();
    const db = getDb();

    const groupedByLottery: Record<string, string[]> = {};

    for (const lot of LOTERICAS) {
        for (const horarioObj of lot.horarios) {
            const horarioStr = horarioObj.horario;

            // Check if today's day of the week is allowed for this schedule
            if (!horarioObj.dias.includes(now.getDay())) {
                continue;
            }

            const [h, m] = horarioStr.split(':').map(Number);
            const scheduled = new Date(now);
            scheduled.setHours(h, m, 0, 0);

            const elapsed = now.getTime() - scheduled.getTime();

            // Window: between 1 min and 5 min after scheduled time
            if (elapsed >= DELAY_MS && elapsed < 5 * 60_000) {
                // Check if already processed
                const statusRows = db.exec(
                    "SELECT status FROM scraping_status WHERE loterica_slug = ? AND data = ? AND horario = ?",
                    [lot.slug, today, horarioStr]
                );

                if (statusRows.length && statusRows[0].values.length) {
                    const status = statusRows[0].values[0][0] as string;
                    if (status === 'success') continue;
                } else {
                    // Create pending entry
                    db.run(
                        `INSERT OR IGNORE INTO scraping_status (id, loterica_slug, data, horario, status)
             VALUES (?, ?, ?, ?, 'pending')`,
                        [crypto.randomUUID(), lot.slug, today, horarioStr]
                    );
                }

                if (!groupedByLottery[lot.slug]) groupedByLottery[lot.slug] = [];
                groupedByLottery[lot.slug].push(horarioStr);
            }
        }
    }

    for (const [slug, horarios] of Object.entries(groupedByLottery)) {
        const lot = LOTERICAS.find(l => l.slug === slug);
        if (lot) {
            await scrapeForLotteryGroup(lot.slug, lot.estado, today, horarios);
        }
    }
}

/**
 * Scrapes results for a specific lottery group (grouping missing times).
 */
async function scrapeForLotteryGroup(slug: string, estado: string, data: string, horarios: string[]): Promise<void> {
    const db = getDb();

    try {
        log.info('SCRAPER', `Buscando ${slug} para ${data} ${horarios.join(', ')}...`, { estado });
        const results = await fetchAllResultados();
        const notFound: string[] = [];

        for (const horario of horarios) {
            let found = false;

            for (const r of results) {
                const mappedSlug = mapLotteryToSlug(r.lottery || r.name || '', estado);
                if (mappedSlug !== slug) continue;

                // STRICT TIME MATCH: Validate result time from API against scheduled slot
                const apiTime = r.time ? r.time.split(':').slice(0, 2).map((v: string) => v.padStart(2, '0')).join(':') : null;
                const slotTime = horario.split(':').slice(0, 2).map(v => v.padStart(2, '0')).join(':');

                if (apiTime && slotTime) {
                    const [apiH, apiM] = apiTime.split(':').map(Number);
                    const [slotH, slotM] = slotTime.split(':').map(Number);
                    const diffMins = Math.abs((apiH * 60 + apiM) - (slotH * 60 + slotM));

                    if (diffMins > 35) {
                        // Skip if the result is for a different time (tolerance of 35 mins for nominal vs actual draw time)
                        continue;
                    }
                }

                const premios = (r.results || r.prizes || r.premios || []).map((p: any, i: number) => ({
                    posicao: p.premio || p.position || p.posicao || i + 1,
                    milhar: String(p.milhar || p.number || p.numero || '').padStart(4, '0'),
                }));

                if (premios.length === 0) continue;

                const input: ResultadoInput = {
                    loterica: slug,
                    estado,
                    data,
                    horario,
                    nome_original: r.name || r.lottery || '',
                    premios,
                };

                const result = ingestResult(input);
                if (result.saved) {
                    found = true;
                    // Update scraping status
                    db.run(
                        `UPDATE scraping_status SET status = 'success', updated_at = datetime('now')
               WHERE loterica_slug = ? AND data = ? AND horario = ?`,
                        [slug, data, horario]
                    );
                    saveDatabase();
                    log.success('SCRAPER', `Resultado salvo: ${slug} ${horario}`, { id: result.id });

                    // Notify webhooks
                    await notifyAll('resultado.novo', {
                        loterica: slug, data, horario, resultado_id: result.id
                    }).catch(() => { });
                    break;
                }
            }

            if (!found) {
                db.run(
                    `UPDATE scraping_status SET status = 'retrying', tentativas = tentativas + 1,
             updated_at = datetime('now') WHERE loterica_slug = ? AND data = ? AND horario = ?`,
                    [slug, data, horario]
                );
                saveDatabase();
                notFound.push(horario);
            }
        }

        if (notFound.length > 0) {
            log.warn('SCRAPER', `⚠️  Resultado não encontrado: ${slug} ${notFound.join(', ')} (retrying)`);
        }

    } catch (err: any) {
        log.error('SCRAPER', `Erro no scraping ${slug} ${horarios.join(', ')}`, err);
        for (const h of horarios) {
            db.run(
                `UPDATE scraping_status SET status = 'error', ultimo_erro = ?,
           tentativas = tentativas + 1, updated_at = datetime('now')
           WHERE loterica_slug = ? AND data = ? AND horario = ?`,
                [err.message, slug, data, h]
            );
        }
        saveDatabase();
    }
}

/**
 * Retry failed/retrying scraping tasks.
 */
async function retryFailed(): Promise<void> {
    const db = getDb();
    const rows = db.exec(
        `SELECT loterica_slug, data, horario FROM scraping_status
     WHERE status IN ('retrying', 'error') AND data = ?`,
        [todayStr()]
    );

    if (!rows.length || !rows[0].values.length) return;

    log.info('CRON', `Retentando ${rows[0].values.length} scraping(s) falhados...`);

    const groupedByLottery: Record<string, string[]> = {};
    for (const row of rows[0].values) {
        const [slug, data, horario] = row as [string, string, string];
        if (!groupedByLottery[slug]) groupedByLottery[slug] = [];
        groupedByLottery[slug].push(horario);
    }

    for (const [slug, horarios] of Object.entries(groupedByLottery)) {
        const lot = LOTERICAS.find(l => l.slug === slug);
        if (lot) {
            await scrapeForLotteryGroup(slug, lot.estado, todayStr(), horarios);
        }
    }
}

/**
 * Morning routine: palpites + cotações at 07:00.
 */
async function morningRoutine(): Promise<void> {
    const today = todayStr();
    log.separator('CRON', 'ROTINA MATINAL');
    log.info('CRON', `Rotina matinal para ${today}...`);

    // Palpites
    try {
        const palpites = await fetchPalpites();
        if (palpites.grupos.length || palpites.milhares.length) {
            savePalpites(today, palpites);
            log.success('CRON', 'Palpites salvos', { grupos: palpites.grupos.length, milhares: palpites.milhares.length });
        } else {
            log.warn('CRON', 'Palpites: API retornou vazio');
        }
    } catch (err) {
        log.error('CRON', 'Erro ao buscar palpites', err);
    }

    // Cotações
    try {
        const cotacoes = await fetchCotacoes();
        if (cotacoes.length) {
            saveCotacoes(cotacoes);
            log.success('CRON', 'Cotações salvas', { total: cotacoes.length });
        } else {
            log.warn('CRON', 'Cotações: API retornou vazio');
        }
    } catch (err) {
        log.error('CRON', 'Erro ao buscar cotações', err);
    }
}
