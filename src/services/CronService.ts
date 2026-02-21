import cron from 'node-cron';
import { getDb, saveDatabase } from '../database/schema.js';
import { todayStr } from '../utils/helpers.js';
import { fetchAllResultados, fetchPalpites, savePalpites, fetchCotacoes, saveCotacoes } from './ScraperService.js';
import { ingestResult, type ResultadoInput } from './AmigosDoBichoService.js';
import { notifyAll } from './WebhookService.js';
import { runProxySweep } from './ProxyService.js';
import { mapLotteryToSlug } from '../utils/helpers.js';
import { getAllLotericas, learnOrGetLoterica, learnOrConfirmSchedule, penalizeSchedule } from './LotericasService.js';
import crypto from 'crypto';
import { log } from '../utils/Logger.js';

export function initCronJobs(): void {
    log.separator('CRON', 'SCHEDULERS V2 (ADAPTIVE)');
    log.info('CRON', 'Inicializando schedulers...');

    // A cada 5 minutos: Adaptive Poller escaneará TODA a API em busca de novidades
    cron.schedule('*/5 * * * *', () => adaptivePoller());

    // Morning 07:00: fetch palpites and cotações
    cron.schedule('0 7 * * *', () => morningRoutine());

    // Meia-Noite e Um (00:01): Prepara o Dashboard do dia lendo do cérebro
    cron.schedule('1 0 * * *', () => dailyForecastManager());

    // Final do dia (23:55): Expurgador de fantasmas
    cron.schedule('55 23 * * *', () => forgetStaleSchedules());

    // Every hour: proxy sweep
    cron.schedule('0 * * * *', () => {
        runProxySweep().catch(err => log.error('PROXY', 'Proxy sweep falhou', err));
    });

    // Auditoria de marketing legada (REMOVIDA) na arquitetura V2

    log.info('CRON', 'Schedulers ativos:', {
        adaptive_poller: '5min',
        morning_palpites: '07:00',
        proxy_sweep: '1h',
        daily_forecast: '00:01',
        forget_stale: '23:55'
    });
}

/**
 * Motor passivo que extrai todos os resultados da API, independente do horário.
 * Se a API entregou jogo novo, ele processa, cria uma lotérica dinamicamente, grava o horário e notifica.
 */
async function adaptivePoller(): Promise<void> {
    const today = todayStr();
    const db = getDb();

    try {
        log.info('SCRAPER', `[POLLER] Buscando payload completo da API para ${today}...`);
        const results = await fetchAllResultados();

        if (!results || results.length === 0) {
            log.warn('SCRAPER', '[POLLER] A API não retornou dados nesta passagem.');
            return;
        }

        let processados = 0;
        let novosSalvos = 0;
        const now = new Date();
        const currentDayOfWeek = now.getDay();

        for (const r of results) {
            processados++;

            let nomeOriginal = r.lottery || r.name || 'Desconhecida';
            nomeOriginal = nomeOriginal.replace(/\b(nova|novo|loteria|da|de|do|dos|das|extração|extracao)\b/gi, '').replace(/\s+/g, ' ').trim();
            const estado = r.state || r.estado || 'BR';

            // 1. Descobre ou carrega a Lotérica do Banco
            const lotSlug = mapLotteryToSlug(nomeOriginal, estado);
            const loterica = learnOrGetLoterica(nomeOriginal, estado, lotSlug);

            const apiTime = r.time ? r.time.split(':').slice(0, 2).map((v: string) => v.padStart(2, '0')).join(':') : null;
            if (!apiTime) continue;

            const normalizedTime = `${apiTime}:00`;

            const premios = (r.results || r.prizes || r.premios || []).map((p: any, i: number) => ({
                posicao: p.premio || p.position || p.posicao || i + 1,
                milhar: String(p.milhar || p.number || p.numero || '').padStart(4, '0'),
            }));

            if (premios.length === 0) continue;

            // 2. Tenta inserir na tabela de resultados finais
            const input: ResultadoInput = {
                loterica: lotSlug,
                estado,
                data: today,
                horario: normalizedTime,
                nome_original: nomeOriginal,
                premios,
            };

            const result = ingestResult(input);
            if (result.saved) {
                novosSalvos++;

                // 3. Atualiza ou cria a expectativa no scraping_status
                db.run(
                    `INSERT INTO scraping_status (id, loterica_slug, data, horario, status, updated_at)
                     VALUES (?, ?, ?, ?, 'success', datetime('now'))
                     ON CONFLICT(loterica_slug, data, horario) DO UPDATE SET 
                        status = 'success', updated_at = datetime('now')`,
                    [crypto.randomUUID(), lotSlug, today, normalizedTime]
                );

                // 4. Efetiva o Aprendizado / Recuperação de Status do Horário
                learnOrConfirmSchedule(lotSlug, normalizedTime, currentDayOfWeek);

                log.success('SCRAPER', `Novo Resultado Processado: ${lotSlug} ${normalizedTime}`, { id: result.id });

                await notifyAll('resultado.novo', {
                    loterica: lotSlug, data: today, horario: normalizedTime, resultado_id: result.id
                }).catch(() => { });
            }
        }

        if (novosSalvos > 0) {
            saveDatabase();
        }
        log.info('SCRAPER', `[POLLER] Fim da Varredura. ${processados} encontrados, ${novosSalvos} salvos no BD.`);

    } catch (err: any) {
        log.error('SCRAPER', 'Erro massivo no Poller de Scraping', err);
    }
}

/**
 * Nasce o dia: Lê todos os horários aprendidos pelas loterias ativas e os inscreve na tabela de status
 * com status 'pending' para que a UI de Admin mostre quantos sorteios aquele dia "espera" ter.
 */
export function dailyForecastManager(): void {
    const today = todayStr();
    const now = new Date();
    const currentDayOfWeek = now.getDay();
    const db = getDb();

    log.separator('CRON', 'FORECAST DIÁRIO');
    log.info('CRON', `Alimentando expectativas de sorteios de hoje (${today})...`);

    const loterias = getAllLotericas();
    let esperados = 0;

    for (const lot of loterias) {
        for (const h of lot.horarios) {
            if (h.dias.includes(currentDayOfWeek)) {
                try {
                    db.run(
                        `INSERT OR IGNORE INTO scraping_status (id, loterica_slug, data, horario, status)
                         VALUES (?, ?, ?, ?, 'pending')`,
                        [crypto.randomUUID(), lot.slug, today, h.horario]
                    );
                    esperados++;
                } catch (e) { }
            }
        }
    }

    if (esperados > 0) saveDatabase();
    log.success('CRON', `Forecast completo. Aguardando ${esperados} sorteios ao longo do dia.`);
}

/**
 * Morre o dia: Varre tudo que a UI estava esperando que fosse 'success' mas não foi, alertando
 * ou punindo faltas de horários.
 */
export function forgetStaleSchedules(): void {
    const today = todayStr();
    const db = getDb();

    log.separator('CRON', 'CLEANUP NOTURNO');
    log.info('CRON', `Analisando falhas definitivas de sorteios previstos para hoje (${today})...`);

    const rows = db.exec(
        `SELECT loterica_slug, horario FROM scraping_status 
         WHERE data = ? AND status IN ('pending', 'error', 'retrying')`,
        [today]
    );

    if (rows.length && rows[0].values.length) {
        let punicoes = 0;
        for (const row of rows[0].values) {
            const [slug, horario] = row as [string, string];
            // O serviço de loterias cuida de gerenciar as faltas limitando a 7.
            // Se excedeu 7, o próprio serviço apagada.
            penalizeSchedule(slug, horario);

            db.run(`UPDATE scraping_status SET status = 'error', ultimo_erro = 'Nunca foi retornado pela API hoje'
                   WHERE loterica_slug = ? AND data = ? AND horario = ?`, [slug, today, horario]);
            punicoes++;
        }

        saveDatabase();
        log.info('CRON', `Aplicadas ${punicoes} penalidades a sorteios ausentes.`);
    } else {
        log.success('CRON', `Todos os sorteios previstos para hoje ocorreram com sucesso. Zero penalidades.`);
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
