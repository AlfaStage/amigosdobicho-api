import { ScraperBase } from './ScraperBase.js';
import db from '../db.js';
import { randomUUID } from 'crypto';
import { WebhookService } from '../services/WebhookService.js';
import { logger } from '../utils/logger.js';
import { LOTERIAS, LotericaConfig } from '../config/loterias.js';
import { LoteriaPendente } from '../services/ScraperService.js';
import { scrapingStatusService } from '../services/ScrapingStatusService.js';

export class GlobalScraper extends ScraperBase {
    private webhookService = new WebhookService();
    protected serviceName = 'GlobalScraper';
    private resultadosEncontrados = 0;
    private erros = 0;

    constructor() {
        super('https://www.ojogodobicho.com/resultados.htm');
    }

    async execute(targets: LoteriaPendente[] | LotericaConfig[] = LOTERIAS, targetSlug?: string, shouldNotify: boolean = true): Promise<void> {
        const startTime = Date.now();
        this.resultadosEncontrados = 0;
        this.erros = 0;

        // Converter para formato padronizado se necessário
        const loteriasPendentes: LoteriaPendente[] = this.isLoteriaPendenteArray(targets)
            ? targets
            : (targets as LotericaConfig[]).map(l => ({ loteria: l, horariosPendentes: l.horarios || [] }));

        logger.info(this.serviceName, `Iniciando varredura global (${loteriasPendentes.length} lotéricas)...`);

        // Filtrar apenas lotéricas alvo que têm URL definida
        const urlsToScrape = loteriasPendentes
            .filter(lp => lp.loteria.url && lp.loteria.url.length > 0)
            .map(lp => ({ url: lp.loteria.url!, horariosPendentes: lp.horariosPendentes }));

        // Agrupar por URL (podem haver múltiplas lotéricas com a mesma URL)
        // OTIMIZAÇÃO: Evita fazer scraping da mesma página várias vezes!
        const urlMap = new Map<string, string[]>();
        for (const item of urlsToScrape) {
            const existing = urlMap.get(item.url) || [];
            // Merge horários pendentes, removendo duplicatas
            const merged = [...new Set([...existing, ...item.horariosPendentes])];
            urlMap.set(item.url, merged);
        }

        const urlsUnicas = urlMap.size;
        logger.info(this.serviceName, `📊 ${loteriasPendentes.length} lotéricas agrupadas em ${urlsUnicas} URLs únicas para economia de requisições`);

        for (const [url, horariosPendentes] of urlMap) {
            try {
                await this.scrapeUrl(url, horariosPendentes, shouldNotify);
            } catch (e) {
                this.erros++;
                logger.error(this.serviceName, `Erro ao processar ${url}:`, e);
            }
        }

        const duracao = Date.now() - startTime;

        // Registrar histórico da execução
        scrapingStatusService.registerScrapingRun(
            'global',
            urlsUnicas,
            this.resultadosEncontrados,
            this.erros,
            duracao,
            `${loteriasPendentes.length} lotéricas em ${urlsUnicas} URLs`
        );

        logger.success(this.serviceName, `Varredura finalizada em ${duracao}ms: ${this.resultadosEncontrados} resultados, ${this.erros} erros`);
    }

    private isLoteriaPendenteArray(targets: any[]): targets is LoteriaPendente[] {
        return targets.length > 0 && 'loteria' in targets[0] && 'horariosPendentes' in targets[0];
    }

    private async scrapeUrl(url: string, horariosPendentes: string[], shouldNotify: boolean): Promise<void> {
        // Usar fetchHtmlWithRetry que tem retry infinito e delay automático
        const $ = await this.fetchHtmlWithRetry(url);
        if (!$) return;

        // OTIMIZAÇÃO: Encontrar TODAS as lotéricas que usam esta URL
        const lotericasComMesmaUrl = LOTERIAS.filter(l => l.url === url);
        if (lotericasComMesmaUrl.length === 0) return;

        logger.info(this.serviceName, `📄 URL ${url.split('/').pop()} tem ${lotericasComMesmaUrl.length} lotérica(s) vinculadas`);

        const tables = $('table');
        if (tables.length === 0) {
            this.lastErrorDetail = 'Nenhuma tabela de resultados encontrada na página (Site mudou a estrutura?)';
            return;
        }

        let totalTabelasProcessadas = 0;

        for (let i = 0; i < tables.length; i++) {
            const table = $(tables[i]);
            const caption = table.find('caption').text().trim();

            const dataMatch = caption.match(/(\d{1,2}) de ([A-Za-zç]+) de (\d{4})/);
            if (!dataMatch) {
                continue;
            }

            totalTabelasProcessadas++;

            const day = dataMatch[1].padStart(2, '0');
            const monthName = dataMatch[2].toLowerCase();
            const year = dataMatch[3];
            const months: { [key: string]: string } = {
                'janeiro': '01', 'fevereiro': '02', 'marco': '03', 'mar\u00E7o': '03',
                'abril': '04', 'maio': '05', 'junho': '06', 'julho': '07',
                'agosto': '08', 'setembro': '09', 'outubro': '10', 'novembro': '11', 'dezembro': '12'
            };
            const month = months[monthName];
            if (!month) continue;

            const dataIso = `${year}-${month}-${day}`;
            const headers: string[] = [];
            table.find('thead th').each((idx, el) => {
                const txt = $(el).text().trim();
                if (txt && idx > 0) headers.push(txt);
            });

            const resultadosMap = new Map<string, any[]>();
            const rows = table.find('tbody tr');

            rows.each((rowIdx, rowEl) => {
                const cells = $(rowEl).find('td');
                const posicao = parseInt($(cells[0]).text().trim());
                if (isNaN(posicao)) return; // No each do cheerio, return pula para o próximo (como continue)

                for (let j = 1; j < cells.length; j++) {
                    if (j - 1 >= headers.length) continue;

                    const horario = headers[j - 1];
                    if (!horario) continue;

                    // Filtrar apenas horários pendentes
                    if (!horariosPendentes.includes(horario)) continue;

                    const cell = $(cells[j]);
                    const conteudo = cell.text().trim();
                    const bichoNome = cell.attr('title') || 'Desconhecido';

                    if (!conteudo || conteudo.includes('0000') || conteudo === '-') continue;

                    const parts = conteudo.split('-');
                    if (parts.length < 2) continue;

                    if (!resultadosMap.has(horario)) resultadosMap.set(horario, []);
                    resultadosMap.get(horario)!.push({
                        posicao,
                        milhar: parts[0],
                        grupo: parseInt(parts[1]),
                        bicho: bichoNome
                    });
                }
            });

            const insertResultado = db.prepare('INSERT OR IGNORE INTO resultados (id, data, horario, loterica_slug) VALUES (?, ?, ?, ?)');
            const getResultadoId = db.prepare('SELECT id FROM resultados WHERE data = ? AND horario = ? AND loterica_slug = ?');
            const insertPremio = db.prepare('INSERT INTO premios (id, resultado_id, posicao, milhar, grupo, bicho) VALUES (?, ?, ?, ?, ?, ?)');

            for (const [horario, premios] of resultadosMap.entries()) {
                // Validação mínima: Pelo menos 1 prêmio para ser considerado sorteio
                if (premios.length === 0) {
                    continue;
                }

                logger.info(this.serviceName, `🔍 Processando ${premios.length} prêmios para o horário ${horario}`);

                // OTIMIZAÇÃO: Gravar o MESMO resultado para TODAS as lotéricas que usam esta URL
                for (const loteria of lotericasComMesmaUrl) {
                    // Verificar se este horário é válido para esta lotérica
                    if (loteria.horarios && !loteria.horarios.includes(horario)) {
                        continue;
                    }

                    db.transaction(() => {
                        let res = getResultadoId.get(dataIso, horario, loteria.slug) as { id: string };
                        if (!res) {
                            const id = randomUUID();
                            insertResultado.run(id, dataIso, horario, loteria.slug);

                            premios.forEach(p => {
                                insertPremio.run(randomUUID(), id, p.posicao, p.milhar, p.grupo, p.bicho);
                            });

                            this.resultadosEncontrados++;
                            logger.success(this.serviceName, `Gravado: ${loteria.slug} - ${dataIso} - ${horario}`);

                            if (shouldNotify) {
                                const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3002}`;
                                this.webhookService.notifyAll('novo_resultado', {
                                    id,
                                    loterica: loteria.slug,
                                    data: dataIso,
                                    horario,
                                    premios,
                                    share_url: `${baseUrl}/v1/resultados/${id}/html`,
                                    image_url: `${baseUrl}/v1/resultados/${id}/image`
                                }).catch(() => { });
                            }
                        }
                    })();
                }
            }
        }

        if (totalTabelasProcessadas === 0) {
            this.lastErrorDetail = 'Página carregada, mas nenhuma tabela de resultados válida foi encontrada.';
        } else if (this.resultadosEncontrados === 0 && horariosPendentes.length > 0) {
            this.lastErrorDetail = 'Tabelas encontradas, mas os resultados para os horários solicitados ainda não foram postados.';
        }
    }
}
