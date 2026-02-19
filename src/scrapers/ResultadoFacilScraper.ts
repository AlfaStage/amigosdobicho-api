import { ScraperBase } from './ScraperBase.js';
import db from '../db.js';
import { randomUUID } from 'crypto';
import { WebhookService } from '../services/WebhookService.js';
import { LOTERIAS, LotericaConfig } from '../config/loterias.js';
import { LoteriaPendente } from '../services/ScraperService.js';
import { logger } from '../utils/logger.js';

export class ResultadoFacilScraper extends ScraperBase {
    private webhookService = new WebhookService();
    protected serviceName = 'ResultadoFacilScraper';

    constructor() {
        super('https://www.resultadofacil.com.br/');
    }

    async execute(targets: LoteriaPendente[] | LotericaConfig[] = LOTERIAS, targetSlug?: string, shouldNotify: boolean = true): Promise<void> {
        logger.info(this.serviceName, 'Iniciando varredura...');

        // Converter para formato padronizado se necessário
        const loteriasPendentes: LoteriaPendente[] = this.isLoteriaPendenteArray(targets)
            ? targets
            : (targets as LotericaConfig[]).map(l => ({ loteria: l, horariosPendentes: l.horarios || [] }));

        // Pegar loterias com URL do ResultadoFacil (por estado OU direto por banca)
        const loteriasAlvo = loteriasPendentes.filter(lp => lp.loteria.urlResultadoFacil || lp.loteria.urlResultadoFacilDireto);

        for (const lp of loteriasAlvo) {
            let success = false;

            // Tenta primeiro por URL de estado (se disponível)
            if (lp.loteria.urlResultadoFacil) {
                try {
                    success = await this.scrapeUrl(lp.loteria.urlResultadoFacil, lp.loteria, lp.horariosPendentes, shouldNotify);
                } catch (e: any) {
                    logger.warn(this.serviceName, `Falha no URL por estado para ${lp.loteria.nome}: ${e.message}`);
                }
            }

            // Se não teve sucesso e tem URL direto por banca, usa como fallback
            if (!success && lp.loteria.urlResultadoFacilDireto) {
                try {
                    logger.info(this.serviceName, `Tentando URL direto por banca para ${lp.loteria.nome}...`);
                    await this.scrapeUrl(lp.loteria.urlResultadoFacilDireto, lp.loteria, lp.horariosPendentes, shouldNotify);
                } catch (e: any) {
                    logger.warn(this.serviceName, `Falha no URL direto para ${lp.loteria.nome}: ${e.message}`);
                }
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

        // Forçar 403 para cair no browser fallback localmente se necessário, 
        // mas aqui vamos usar o fetchHtmlWithRetry que já gerencia isso
        const $ = await this.fetchHtmlWithRetry(url, headers);
        if (!$) return false;

        logger.info(this.serviceName, `Página carregada: ${loteria.nome} (${loteria.slug})`);

        // No Resultado Fácil, os resultados geralmente vêm em tabelas dentro de blocos
        // Vamos procurar por tabelas e tentar identificar o horário pelo título próximo (h3, h4 ou texto)

        const tables = $('table');
        if (tables.length === 0) {
            this.lastErrorDetail = 'Nenhuma tabela de resultados encontrada na página';
            return false;
        }

        const dataHojeIso = new Date().toISOString().split('T')[0];
        let foundResults = false;
        let horariosDetectadosCount = 0;

        tables.each((i, tableEl) => {
            const table = $(tableEl);

            // Tentar achar o horário no h3/h4 anterior ou no texto da célula de cabeçalho
            let textoContexto = table.prevAll('h3, h4, .title, .header').first().text().trim();
            if (!textoContexto) {
                textoContexto = table.find('caption').text().trim() || table.find('th').first().text().trim();
            }

            // Procurar por padrão de horário (11:20 ou 11h20)
            const horarioMatch = textoContexto.match(/(\d{1,2})[h:](\d{2})/i);
            if (!horarioMatch) return;

            const horario = `${horarioMatch[1].padStart(2, '0')}:${horarioMatch[2]}`;
            horariosDetectadosCount++;

            // Verificar se este horário é o que estamos procurando
            if (!horariosPendentes.includes(horario)) return;

            logger.info(this.serviceName, `Identificado horário ${horario} na tabela ${i}`);

            const premios: any[] = [];
            const rows = table.find('tr');

            rows.each((ri, rowEl) => {
                const cells = $(rowEl).find('td');
                if (cells.length < 2) return;

                const posTxt = $(cells[0]).text().trim();
                const posicaoMatch = posTxt.match(/(\d)[º°]*/);
                if (!posicaoMatch) return;

                const posicao = parseInt(posicaoMatch[1]);
                const milhar = $(cells[1]).text().trim().replace(/[^\d]/g, '');

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

        if (!foundResults) {
            if (horariosDetectadosCount === 0) {
                this.lastErrorDetail = 'Página carregada, mas não foram identificados blocos de horários/resultados.';
            } else {
                this.lastErrorDetail = 'Blocos de horários encontrados, mas os prêmios ainda não foram publicados.';
            }
        }

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

            logger.success(this.serviceName, `Gravado como FALLBACK: ${loteriaSlug} - ${data} ${horario} (${premios.length} prêmios)`);

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
            logger.error(this.serviceName, 'Erro ao salvar resultado (fallback):', error);
        }
    }
}
