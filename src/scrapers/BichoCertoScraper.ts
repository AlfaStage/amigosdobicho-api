import { ScraperBase } from './ScraperBase.js';
import db from '../db.js';
import { randomUUID } from 'crypto';
import { WebhookService } from '../services/WebhookService.js';
import { LOTERIAS, LotericaConfig } from '../config/loterias.js';
import { LoteriaPendente } from '../services/ScraperService.js';
import { logger } from '../utils/logger.js';

export class BichoCertoScraper extends ScraperBase {
    private webhookService = new WebhookService();
    protected serviceName = 'BichoCertoScraper';

    constructor() {
        super('https://bichocerto.com/');
    }

    async execute(targets: LoteriaPendente[] | LotericaConfig[] = LOTERIAS, targetSlug?: string, shouldNotify: boolean = true): Promise<void> {
        logger.info(this.serviceName, 'Iniciando varredura...');

        const loteriasPendentes: LoteriaPendente[] = this.isLoteriaPendenteArray(targets)
            ? targets
            : (targets as LotericaConfig[]).map(l => ({ loteria: l, horariosPendentes: l.horarios || [] }));

        const loteriasAlvo = loteriasPendentes.filter(lp => lp.loteria.urlBichoCerto);

        for (const lp of loteriasAlvo) {
            try {
                if (lp.loteria.urlBichoCerto) {
                    await this.scrapeUrl(lp.loteria.urlBichoCerto, lp.loteria, lp.horariosPendentes, shouldNotify);
                }
            } catch (e: any) {
                logger.warn(this.serviceName, `Falha ao acessar ${lp.loteria.nome}: ${e.message}`);
            }
        }
    }

    private isLoteriaPendenteArray(targets: any[]): targets is LoteriaPendente[] {
        return targets.length > 0 && 'loteria' in targets[0] && 'horariosPendentes' in targets[0];
    }

    private async scrapeUrl(url: string, loteria: LotericaConfig, horariosPendentes: string[], shouldNotify: boolean): Promise<boolean> {
        const headers = {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
            'Referer': 'https://www.google.com/'
        };

        const $ = await this.fetchHtmlWithRetry(url, headers);
        if (!$) return false;

        logger.info(this.serviceName, `Página carregada: ${loteria.nome} (${loteria.slug})`);

        // No Bicho Certo, os resultados costumam estar em tabelas com classe .table-resultados ou similar
        // Muitas vezes o horário está em um cabeçalho h4 ou th
        const tables = $('table');
        const dataHojeIso = new Date().toISOString().split('T')[0];
        let foundResults = false;

        tables.each((i, tableEl) => {
            const table = $(tableEl);

            // Procura o horário no contexto próximo
            let textoContexto = table.prevAll('h2, h3, h4, .title, .horario').first().text().trim();
            if (!textoContexto) {
                textoContexto = table.find('caption').text().trim() || table.find('th').first().text().trim();
            }

            // Melhorado para capturar '9 horas', '9h', '9:00', '9'
            const horarioMatch = textoContexto.match(/(\d{1,2})\s*(?:[h:](\d{1,2})|horas)?/i);
            if (!horarioMatch) return;

            const hora = horarioMatch[1].padStart(2, '0');
            const minuto = horarioMatch[2] ? horarioMatch[2].padStart(2, '0') : '00';
            const horario = `${hora}:${minuto}`;

            if (!horariosPendentes.includes(horario)) return;

            logger.info(this.serviceName, `Identificado horário ${horario} na tabela ${i}`);

            const premios: any[] = [];
            const rows = table.find('tr');

            rows.each((ri, rowEl) => {
                const cells = $(rowEl).find('td');
                // Estrutura típica: [Posição] [Premio/Milhar] [Grupo/Bicho]
                if (cells.length < 2) return;

                const posTxt = $(cells[0]).text().trim();
                const posicaoMatch = posTxt.match(/(\d)[º°]*/);
                if (!posicaoMatch) return;

                const posicao = parseInt(posicaoMatch[1]);
                let milhar = $(cells[1]).text().trim().replace(/[^\d]/g, '');

                // Trata casos onde o milhar pode estar em outra coluna ou formatado
                if (!milhar || milhar.length < 3) {
                    // Tenta procurar em outras células se a segunda falhar
                    cells.each((ci, cell) => {
                        const txt = $(cell).text().trim().replace(/[^\d]/g, '');
                        if (txt.length >= 3 && txt.length <= 4) {
                            milhar = txt;
                            return false; // break
                        }
                    });
                }

                if (!milhar || milhar.length < 3) return;

                const bichoTxt = cells.length > 2 ? $(cells[2]).text().trim() : '';
                const bichoMatch = bichoTxt.match(/([A-Záâãéêíóôõúç\s]+)\s*\(?(\d+)?\)?/i);

                const bicho = bichoMatch ? bichoMatch[1].trim() : 'Desconhecido';
                const grupo = bichoMatch && bichoMatch[2] ? parseInt(bichoMatch[2]) : this.getGrupoFromMilhar(milhar);

                premios.push({ posicao, milhar, grupo, bicho });
            });

            if (premios.length >= 5) {
                this.saveResult(loteria.slug, dataHojeIso, horario, premios, shouldNotify);
                foundResults = true;
            }
        });

        return foundResults;
    }

    private getGrupoFromMilhar(milhar: string): number {
        const m = parseInt(milhar);
        if (isNaN(m)) return 0;
        const dezenas = m % 100;
        if (dezenas === 0) return 25;
        return Math.ceil(dezenas / 4);
    }

    private saveResult(loteriaSlug: string, data: string, horario: string, premios: any[], shouldNotify: boolean = true): void {
        try {
            const exists = db.prepare('SELECT id FROM resultados WHERE loterica_slug = ? AND data = ? AND horario = ?')
                .get(loteriaSlug, data, horario);

            if (exists) return;

            const resultadoId = randomUUID();
            db.prepare('INSERT INTO resultados (id, loterica_slug, data, horario) VALUES (?, ?, ?, ?)')
                .run(resultadoId, loteriaSlug, data, horario);

            const insertPremio = db.prepare('INSERT INTO premios (id, resultado_id, posicao, milhar, grupo, bicho) VALUES (?, ?, ?, ?, ?, ?)');

            for (const p of premios) {
                insertPremio.run(randomUUID(), resultadoId, p.posicao, p.milhar, p.grupo, p.bicho);
            }

            logger.success(this.serviceName, `Gravado como REDUNDÂNCIA (BichoCerto): ${loteriaSlug} - ${data} ${horario}`);

            if (shouldNotify) {
                const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3002}`;
                this.webhookService.notifyAll('novo_resultado', {
                    id: resultadoId,
                    loterica: loteriaSlug,
                    data,
                    horario,
                    premios,
                    share_url: `${baseUrl}/v1/resultados/${resultadoId}/html`,
                    image_url: `${baseUrl}/v1/resultados/${resultadoId}/image`
                }).catch(() => { });
            }

        } catch (error) {
            logger.error(this.serviceName, 'Erro ao salvar resultado (redundância):', error);
        }
    }
}
