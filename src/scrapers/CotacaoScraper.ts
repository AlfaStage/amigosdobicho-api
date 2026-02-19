import * as cheerio from 'cheerio';
import { ScraperBase } from './ScraperBase.js';
import { logger } from '../utils/logger.js';
import db from '../db.js';
import { randomUUID } from 'crypto';
import { LotericaConfig } from '../config/loterias.js';

export interface Cotacao {
    modalidade: string;
    valor: string;
}

export class CotacaoScraper extends ScraperBase {
    protected serviceName = 'CotacaoScraper';

    constructor() {
        const url = process.env.COTACAO_URL || 'https://amigosdobicho.com/cotacoes';
        super(url);
        // Cotações geralmente precisam de renderização JS ou interação
        this.useBrowserFallback = true;
    }

    async execute(targets?: LotericaConfig[], targetSlug?: string, shouldNotify: boolean = true): Promise<void> {
        logger.info(this.serviceName, `Iniciando extração de cotações em: ${this.baseUrl}`);

        const $ = await this.fetchHtmlWithRetry();
        if (!$) {
            logger.error(this.serviceName, 'Falha ao carregar página de cotações');
            return;
        }

        const cotacoes: Cotacao[] = [];

        // Com base na análise, as cotações vêm em cards
        // h3 com o nome da modalidade e um texto com o valor
        $('h3').each((_, element) => {
            const modalidade = $(element).text().trim();
            // O valor geralmente vem logo após o h3 no DOM ou dentro do mesmo card
            // Olhando o snapshot, o texto "1x R$ ..." está próximo
            const valor = $(element).parent().find('p, span, div').filter((_, el) => {
                return $(el).text().includes('R$');
            }).first().text().trim();

            if (modalidade && valor && valor.includes('R$')) {
                cotacoes.push({ modalidade, valor });
            }
        });

        if (cotacoes.length === 0) {
            // Fallback: tentar buscar por seletores de texto específicos se o acima falhar
            logger.warn(this.serviceName, 'Nenhuma cotação encontrada com seletores padrão, tentando alternativa...');

            // Alternativa: buscar todos os textos que contenham R$ e tentar parear com o h3 anterior
            $('h3').each((_, element) => {
                const modalidade = $(element).text().trim();
                let next = $(element).next();
                while (next.length > 0 && next.prop('tagName') !== 'H3') {
                    const text = next.text().trim();
                    if (text.includes('R$')) {
                        cotacoes.push({ modalidade, valor: text });
                        break;
                    }
                    next = next.next();
                }
            });
        }

        logger.success(this.serviceName, `${cotacoes.length} cotações extraídas`);

        if (cotacoes.length > 0) {
            await this.saveToDb(cotacoes);
        }
    }

    private async saveToDb(cotacoes: Cotacao[]): Promise<void> {
        const now = new Date().toISOString();

        const stmt = db.prepare(`
            INSERT INTO cotacoes (id, modalidade, valor, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(modalidade) DO UPDATE SET
                valor = excluded.valor,
                updated_at = excluded.updated_at
        `);

        const transaction = db.transaction((items: Cotacao[]) => {
            for (const item of items) {
                stmt.run(randomUUID(), item.modalidade, item.valor, now);
            }
        });

        try {
            transaction(cotacoes);
            logger.info(this.serviceName, 'Cotações salvas no banco de dados');
        } catch (error) {
            logger.error(this.serviceName, 'Erro ao salvar cotações:', error);
        }
    }
}
