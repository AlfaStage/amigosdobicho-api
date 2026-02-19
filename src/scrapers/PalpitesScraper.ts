import { ScraperBase } from './ScraperBase.js';
import db from '../db.js';
import { randomUUID } from 'crypto';
import { logger } from '../utils/logger.js';
import { WebhookService } from '../services/WebhookService.js';
import * as cheerio from 'cheerio';
import { LotericaConfig } from '../config/loterias.js';
import { scrapingStatusService } from '../services/ScrapingStatusService.js';

interface PalpiteGrupo {
    bicho: string;
    grupo: number;
    dezenas: string;
}

export class PalpitesScraper extends ScraperBase {
    private webhookService = new WebhookService();
    protected serviceName = 'PalpitesScraper';

    constructor() {
        super('https://www.resultadofacil.com.br/palpites-do-dia');
    }

    // Mantendo assinatura compatível
    async execute(targets?: LotericaConfig[], targetSlug?: string, shouldNotify: boolean = true): Promise<void> {
        // Agora só temos mode='palpites'. Bingos são calculados internamente.
        if (targetSlug === 'bingos') {
            logger.info(this.serviceName, 'Scraping de Bingos desativado (cálculo interno agora).');
            return;
        }

        const mode = 'palpites';
        const horario = '07:00';
        const dataHojeIso = new Date().toISOString().split('T')[0];

        logger.info(this.serviceName, `Iniciando varredura modo: ${mode}`);

        scrapingStatusService.registerAttempt(mode, horario, dataHojeIso);
        scrapingStatusService.registerPending(mode, 'Palpites do Dia', horario, dataHojeIso);

        const $ = await this.fetchHtmlWithRetry();
        if (!$) {
            const errorMsg = this.getLastError() || 'Falha ao carregar página de palpites';
            logger.error(this.serviceName, errorMsg);
            scrapingStatusService.registerError(mode, horario, dataHojeIso, errorMsg);
            return;
        }

        await this.scrapePalpitesDoDia($, dataHojeIso);
    }

    private async scrapePalpitesDoDia($: cheerio.CheerioAPI, data: string) {
        // Verificar se já existe
        const exists = db.prepare('SELECT id FROM palpites_dia WHERE data = ?').get(data);
        if (exists) {
            logger.info(this.serviceName, `Palpites para ${data} já coletados.`);
            return;
        }

        const grupos: PalpiteGrupo[] = [];
        const milhares: string[] = [];
        const centenas: string[] = [];

        // Estratégia melhorada de seletores:
        // O site usa cards ou seções. Vamos tentar buscar por elementos textuais que contêm "Grupo", "Milhar", etc.
        // e navegar a partir deles.

        $('h4, h3, div, span, p').each((i: number, el: any) => {
            // Limitar a busca para evitar processar a página inteira se ela for muito grande?
            // cheerio é rápido, não deve ser problema.
            const elObj = $(el);
            const text = elObj.text().trim();

            // 1. Grupos/Bichos
            if (text.includes('Grupo') && text.includes('-')) {
                // Tenta pegar padrão "Bicho - Grupo X"
                const match = text.match(/([A-ZÀ-ÿa-zÀ-ÿ]+)\s*-\s*Grupo\s*(\d+)/i);
                if (match) {
                    const bicho = match[1].trim();
                    const grupo = parseInt(match[2]);

                    // Dezenas costumam estar perto
                    let dezenas = '';
                    // Tenta siblings próximos
                    let next = elObj.next();
                    for (let j = 0; j < 5; j++) {
                        if (next.text().includes('Dezenas')) {
                            const dezMatch = next.text().match(/Dezenas:?\s*([\d,\s]+)/i);
                            if (dezMatch) dezenas = dezMatch[1].trim();
                            break;
                        }
                        next = next.next();
                    }

                    // Se não achou em siblings, tenta parent e find
                    if (!dezenas) {
                        const parent = elObj.parent();
                        const dezText = parent.text().match(/Dezenas:?\s*([\d,\s]+)/i);
                        if (dezText) dezenas = dezText[1].trim();
                    }

                    // Evitar duplicatas
                    if (grupos.findIndex(g => g.grupo === grupo) === -1) {
                        grupos.push({ bicho, grupo, dezenas: dezenas || '' });
                    }
                }
            }

            // 2. Milhar do dia
            if (text.toUpperCase().includes('MILHAR DO DIA')) {
                // Geralmente os números estão em um container próximo
                const container = elObj.parent();
                // Extrair todos números de 4 dígitos do container
                const candidates = container.text().match(/\b\d{4}\b/g);
                if (candidates) {
                    candidates.forEach(num => {
                        if (!milhares.includes(num)) milhares.push(num);
                    });
                }
            }

            // 3. Centena do dia
            if (text.toUpperCase().includes('CENTENA DO DIA')) {
                const container = elObj.parent();
                const candidates = container.text().match(/\b\d{3}\b/g);
                if (candidates) {
                    candidates.forEach(num => {
                        if (!centenas.includes(num)) centenas.push(num);
                    });
                }
            }
        });

        if (grupos.length === 0 && milhares.length === 0) {
            logger.warn(this.serviceName, 'Nenhum palpite encontrado. Verifique manualmente.');
            return;
        }

        this.savePalpites(data, grupos, milhares, centenas);
    }

    private savePalpites(data: string, grupos: PalpiteGrupo[], milhares: string[], centenas: string[]) {
        try {
            const id = randomUUID();
            const insertPalpite = db.prepare('INSERT INTO palpites_dia (id, data) VALUES (?, ?)');
            const insertGrupo = db.prepare('INSERT INTO palpites_grupos (id, palpite_id, bicho, grupo, dezenas) VALUES (?, ?, ?, ?, ?)');
            const insertMilhar = db.prepare('INSERT INTO palpites_milhares (id, palpite_id, numero) VALUES (?, ?, ?)');
            const insertCentena = db.prepare('INSERT INTO palpites_centenas (id, palpite_id, numero) VALUES (?, ?, ?)');

            const transaction = db.transaction(() => {
                insertPalpite.run(id, data);

                for (const g of grupos) {
                    insertGrupo.run(randomUUID() as any, id, g.bicho, g.grupo, g.dezenas);
                }

                for (const m of milhares) {
                    insertMilhar.run(randomUUID() as any, id, m);
                }

                for (const c of centenas) {
                    insertCentena.run(randomUUID() as any, id, c);
                }
            });

            transaction();
            logger.success(this.serviceName, `Palpites salvos para ${data}: ${grupos.length} grupos, ${milhares.length} milhares, ${centenas.length} centenas.`);

            this.webhookService.notifyAll('novos_palpites', { data, grupos, milhares, centenas }).catch(() => { });

            scrapingStatusService.registerSuccess('palpites', '07:00', data, 'scraper', id as any);

        } catch (error: any) {
            logger.error(this.serviceName, 'Erro ao salvar palpites:', error);
            scrapingStatusService.registerError('palpites', '07:00', data, error.message);
        }
    }
}
