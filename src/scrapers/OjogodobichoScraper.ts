import { ScraperBase } from './ScraperBase.js';
import db from '../db.js';
import { randomUUID } from 'crypto';
import { WebhookService } from '../services/WebhookService.js';
import { logger } from '../utils/logger.js';
import { LOTERIAS, LotericaConfig } from '../config/loterias.js';

export class OjogodobichoScraper extends ScraperBase {
    private webhookService = new WebhookService();
    protected override serviceName = 'OjogodobichoScraper';

    constructor() {
        super('https://www.ojogodobicho.com/deu_no_poste.htm');
    }

    async execute(targets: LotericaConfig[] = [], targetSlug?: string, shouldNotify: boolean = true): Promise<void> {
        logger.info(this.serviceName, 'Iniciando scrape de ojogodobicho.com...');
        const $ = await this.fetchHtmlWithRetry();

        if (!$) {
            logger.error(this.serviceName, 'Falha ao obter HTML');
            return;
        }

        const tables = $('table');
        logger.info(this.serviceName, `Encontradas ${tables.length} tabelas`);

        for (let i = 0; i < tables.length; i++) {
            const table = $(tables[i]);
            const caption = table.find('caption').text().trim();
            logger.info(this.serviceName, `Processando tabela: ${caption}`);

            // Tentar extrair data do caption
            const dataMatch = caption.match(/(\d{1,2}) de ([A-Za-zç]+) de (\d{4})/);
            if (!dataMatch) {
                logger.warn(this.serviceName, `Ignorando tabela sem data válida: ${caption}`);
                continue;
            }

            const dia = dataMatch[1].padStart(2, '0');
            const mesNome = dataMatch[2].toLowerCase();
            const ano = dataMatch[3];
            const meses: { [key: string]: string } = {
                'janeiro': '01', 'fevereiro': '02', 'mar\u00E7o': '03', 'abril': '04',
                'maio': '05', 'junho': '06', 'julho': '07', 'agosto': '08',
                'setembro': '09', 'outubro': '10', 'novembro': '11', 'dezembro': '12'
            };
            const mes = meses[mesNome] || meses[mesNome.replace('ç', 'c')];

            if (!mes) {
                logger.error(this.serviceName, `Mês desconhecido: ${mesNome}`);
                continue;
            }

            const dataIso = `${ano}-${mes}-${dia}`;
            logger.info(this.serviceName, `Data extraída: ${dataIso}`);

            const headers: string[] = [];
            table.find('thead th').each((idx, el) => {
                const txt = $(el).text().trim();
                if (txt) headers.push(txt);
            });

            const rows = table.find('tbody tr');

            const insertResultado = db.prepare(`
            INSERT OR IGNORE INTO resultados (id, data, horario, loterica_slug) 
            VALUES (?, ?, ?, ?)
        `);

            const getResultadoId = db.prepare(`
            SELECT id FROM resultados WHERE data = ? AND horario = ? AND loterica_slug = ?
        `);

            const insertPremio = db.prepare(`
            INSERT INTO premios (id, resultado_id, posicao, milhar, grupo, bicho)
            VALUES (?, ?, ?, ?, ?, ?)
        `);

            // Mapa para agrupar prêmios por resultado: Chave = "HORARIO-SLUG"
            const resultadosMap = new Map<string, { premios: any[] }>();

            rows.each((rowIdx, rowEl) => {
                const cells = $(rowEl).find('td');
                const posicaoTxt = $(cells[0]).text().trim();
                const posicao = parseInt(posicaoTxt);

                if (isNaN(posicao)) return;

                for (let j = 1; j < cells.length; j++) {
                    if (j - 1 >= headers.length) break;

                    const cell = $(cells[j]);
                    const horario = headers[j - 1];
                    const conteudo = cell.text().trim();
                    const bichoNome = cell.attr('title') || 'Desconhecido';

                    if (!horario) continue;
                    if (conteudo === '0000-0' || conteudo === '000-0' || conteudo === '') continue;

                    const parts = conteudo.split('-');
                    if (parts.length < 2) continue;

                    const milhar = parts[0];
                    const grupo = parseInt(parts[1]);
                    const lotericaSlug = 'pt-rio'; // Default

                    const key = `${horario}-${lotericaSlug}`;
                    if (!resultadosMap.has(key)) {
                        resultadosMap.set(key, { premios: [] });
                    }
                    resultadosMap.get(key)!.premios.push({ posicao, milhar, grupo, bicho: bichoNome });
                }
            });

            // Processar resultados agrupados
            const runTransaction = db.transaction(() => {
                for (const [key, { premios }] of resultadosMap.entries()) {
                    const [horario, lotericaSlug] = key.split('-');
                    let resultId: string | undefined;

                    // Verifica se já existe o resultado (header)
                    const existing = getResultadoId.get(dataIso, horario, lotericaSlug) as { id: string } | undefined;
                    let isNew = false;

                    if (existing) {
                        resultId = existing.id;
                    } else {
                        resultId = randomUUID();
                        insertResultado.run(resultId, dataIso, horario, lotericaSlug);
                        isNew = true;
                    }

                    // Se for novo, insere premios e notifica
                    // Para evitar duplicidade de premios em re-runs de update, deletamos os premios antigos antes?
                    // Ou assumimos que 'isNew' garante que não tem premios?
                    // INSERT OR IGNORE no resultado significa que se existe, não é new.
                    // Se não é new, não fazemos nada (imutabilidade do resultado do bicho).

                    if (isNew) {
                        const prizesData = [];
                        for (let p = 0; p < premios.length; p++) {
                            const { posicao, milhar, grupo, bicho } = premios[p];
                            insertPremio.run(randomUUID(), resultId, posicao, milhar, grupo, bicho);
                            prizesData.push({ posicao, milhar, grupo, bicho });
                        }

                        // Notificar Webhook (fora da transaction? Não, bom garantir que commitou. Mas aqui dentro é sync)
                        // Vamos logar para fazer depois.
                        logger.success(this.serviceName, `Novo resultado salvo: ${lotericaSlug} ${horario}`);

                        if (shouldNotify) {
                            const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3002}`;
                            // Fire and forget webhook
                            this.webhookService.notifyAll('novo_resultado', {
                                id: resultId,
                                loterica: lotericaSlug,
                                data: dataIso,
                                horario: horario,
                                premios: prizesData,
                                share_url: `${baseUrl}/v1/resultados/${resultId}/html`,
                                image_url: `${baseUrl}/v1/resultados/${resultId}/image`
                            }).catch((err: any) => logger.error(this.serviceName, 'Erro webhook:', err.message));
                        }
                    }
                }
            });

            try {
                runTransaction();
                logger.success(this.serviceName, 'Tabela salva com sucesso');
            } catch (err) {
                logger.error(this.serviceName, 'Erro na transação:', err);
            }
        }
    }
}
