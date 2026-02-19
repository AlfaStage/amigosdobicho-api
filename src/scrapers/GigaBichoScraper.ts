import { ScraperBase } from './ScraperBase.js';
import db from '../db.js';
import { randomUUID } from 'crypto';
import { WebhookService } from '../services/WebhookService.js';
import { LOTERIAS, LotericaConfig } from '../config/loterias.js';
import { LoteriaPendente } from '../services/ScraperService.js';
import { logger } from '../utils/logger.js';
import * as cheerio from 'cheerio';

export class GigaBichoScraper extends ScraperBase {
    private webhookService = new WebhookService();
    protected serviceName = 'GigaBichoScraper';

    constructor() {
        super('https://www.gigabicho.com.br/');
    }

    async execute(targets: LoteriaPendente[] | LotericaConfig[] = LOTERIAS, targetSlug?: string, shouldNotify: boolean = true): Promise<void> {
        // Converter para formato padronizado se necessário
        const loteriasPendentes: LoteriaPendente[] = this.isLoteriaPendenteArray(targets)
            ? targets
            : (targets as LotericaConfig[]).map(l => ({ loteria: l, horariosPendentes: l.horarios || [] }));

        logger.info(this.serviceName, `Iniciando varredura (${loteriasPendentes.length} lotéricas)...`);

        // Pegar URLs do GigaBicho dos alvos
        const urlsToScrape = loteriasPendentes
            .filter(lp => lp.loteria.urlGigaBicho)
            .map(lp => ({
                url: lp.loteria.urlGigaBicho!,
                slug: lp.loteria.slug,
                horariosPendentes: lp.horariosPendentes
            }));

        if (targetSlug) {
            urlsToScrape.filter(u => u.slug === targetSlug);
        }

        // Agrupar por URL
        const urlMap = new Map<string, { slugs: string[], horariosPendentes: string[] }>();
        for (const item of urlsToScrape) {
            const existing = urlMap.get(item.url) || { slugs: [], horariosPendentes: [] };
            existing.slugs.push(item.slug);
            existing.horariosPendentes = [...new Set([...existing.horariosPendentes, ...item.horariosPendentes])];
            urlMap.set(item.url, existing);
        }

        logger.info(this.serviceName, `URLs únicas para processar: ${urlMap.size}`);

        for (const [url, data] of urlMap) {
            try {
                await this.scrapeUrl(url, data.horariosPendentes, shouldNotify);
            } catch (error) {
                logger.error(this.serviceName, `Erro ao processar ${url}:`, error);
            }
        }

        logger.success(this.serviceName, 'Varredura finalizada.');
    }

    private isLoteriaPendenteArray(targets: any[]): targets is LoteriaPendente[] {
        return targets.length > 0 && 'loteria' in targets[0] && 'horariosPendentes' in targets[0];
    }

    private async scrapeUrl(url: string, horariosPendentes: string[], shouldNotify: boolean): Promise<void> {
        // Usar fetchHtmlWithRetry que tem retry infinito e delay automático
        const $ = await this.fetchHtmlWithRetry(url);
        if (!$) return;

        const rawHtml = $.html();
        const parts = rawHtml.split(/<h3[^>]*>/i);

        if (parts.length <= 1) {
            this.lastErrorDetail = 'Nenhum cabeçalho h3 encontrado na página (Site mudou a estrutura?)';
            return;
        }

        let resultadosProcessados = 0;
        let lotericasDetectadas = 0;

        for (let i = 1; i < parts.length; i++) {
            const part = parts[i];
            const partHeaderMatch = part.match(/^([\s\S]*?)<\/h3>/i);
            if (!partHeaderMatch) continue;

            const titulo = cheerio.load(partHeaderMatch[1]).text().trim();
            const content = part.substring(partHeaderMatch[0].length);
            const $part = cheerio.load(content);

            // Tentar encontrar qual lotérica esse título se refere
            const loteria = this.detectLoteria(titulo, url);
            if (!loteria) {
                continue;
            }

            lotericasDetectadas++;

            const horarioMatch = titulo.match(/(\d{1,2})[h:]?(\d{2})?\s*(horas)?/i);
            if (!horarioMatch) continue;

            const hora = parseInt(horarioMatch[1]);
            const minuto = horarioMatch[2] || '00';
            const horarioFormatado = `${hora.toString().padStart(2, '0')}:${minuto}`;

            // Verificar se este horário está na lista de pendentes
            if (!horariosPendentes.includes(horarioFormatado)) continue;

            let dataIso = '';
            const dataMatch = $part.text().match(/(\d{2})\/(\d{2})\/(\d{4})/);
            if (dataMatch) {
                dataIso = `${dataMatch[3]}-${dataMatch[2]}-${dataMatch[1]}`;
            } else {
                dataIso = new Date().toISOString().split('T')[0];
            }

            const premios: any[] = [];
            const lines = $part.text()
                .split('\n')
                .map(l => l.trim())
                .filter(l => l);

            let buffer: { pos?: number, milhar?: string, bicho?: string } = {};
            let captureStage = 0; // 0=pos, 1=milhar, 2=bicho

            lines.forEach(line => {
                const posMatch = line.match(/^(\d{1,2})º$/);
                if (posMatch) {
                    buffer = { pos: parseInt(posMatch[1]) };
                    captureStage = 1;
                    return;
                }

                if (captureStage === 1) {
                    if (/^\d{3,5}$/.test(line)) { // Ajustado para aceitar Soma (5 dígitos)
                        buffer.milhar = line;
                        captureStage = 2;
                    } else if (line === '--') {
                        captureStage = 0;
                        buffer = {};
                    }
                    return;
                }

                if (captureStage === 2) {
                    buffer.bicho = line.split('(')[0].trim();
                    premios.push({
                        posicao: buffer.pos,
                        milhar: buffer.milhar,
                        grupo: this.getGrupoFromMilhar(buffer.milhar!),
                        bicho: buffer.bicho
                    });
                    buffer = {};
                    captureStage = 0;
                }
            });

            if (premios.length > 0) {
                this.saveResult(loteria.slug, dataIso, horarioFormatado, premios, shouldNotify);
                resultadosProcessados++;
            }
        }

        if (lotericasDetectadas === 0) {
            this.lastErrorDetail = 'Página carregada, mas os títulos dos resultados não conferem com as lotéricas esperadas.';
        } else if (resultadosProcessados === 0 && horariosPendentes.length > 0) {
            this.lastErrorDetail = 'Estrutura detectada, mas os resultados para estes horários ainda não foram publicados.';
        }
    }

    private detectLoteria(titulo: string, url: string): any {
        const tituloLower = titulo.toLowerCase();

        // Buscar loterias que usam essa URL
        const possiveis = LOTERIAS.filter(l => l.urlGigaBicho === url);

        if (possiveis.length === 1) return possiveis[0];

        // Se houver mais de uma (ex: Bahia), tentar diferenciar pelo título
        for (const loteria of possiveis) {
            // Se o nome da lotérica (ex: Maluca Bahia) está no título, é ela
            // Ajuste: remover acentos e ser flexível
            const nomeLoteria = loteria.nome.toLowerCase()
                .replace('bahia', '').trim(); // Removemos "Bahia" para bater em "Maluca" ou vazio

            if (nomeLoteria && tituloLower.includes(nomeLoteria)) {
                return loteria;
            }
        }

        // Default: retornar a primeira se não houver distinção clara
        return possiveis.find(l => !l.nome.toLowerCase().includes('maluca')) || possiveis[0];
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
            // Verificar se já existe
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

            logger.success(this.serviceName, `Gravado: ${loteriaSlug} - ${data} ${horario} (${premios.length} prêmios)`);

            // Webhook opcional
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
            logger.error(this.serviceName, 'Erro ao salvar resultado:', error);
        }
    }
}
