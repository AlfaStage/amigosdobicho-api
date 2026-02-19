import fs from 'fs-extra';
import path from 'path';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { html as toReactNode } from 'satori-html';
import { logger } from '../utils/logger.js';

// Template padrão (embutido no código)
const DEFAULT_TEMPLATE_PATH = path.resolve('src/templates/result.html');
// Template customizado pelo usuário (persistente)
const CUSTOM_TEMPLATE_PATH = process.env.TEMPLATE_PATH || path.resolve('data/custom-template.html');

// Fonte Inter (Regular e Bold) para o Satori renderizar corretamente
const REGULAR_FONT_PATH = path.resolve('src/assets/fonts/Inter-Regular.ttf');
const BOLD_FONT_PATH = path.resolve('src/assets/fonts/Inter-Bold.ttf');

let fontBuffer: Buffer | null = null;
let fontBoldBuffer: Buffer | null = null;

export class RenderService {
    private serviceName = 'RenderService';
    private initPromise: Promise<void> | null = null;

    constructor() {
        this.initPromise = this.initFonts();
    }

    async initFonts() {
        if (fontBuffer && fontBoldBuffer) {
            return;
        }

        try {
            if (!fontBuffer && await fs.pathExists(REGULAR_FONT_PATH)) {
                logger.info(this.serviceName, 'Carregando fonte regular...');
                fontBuffer = await fs.readFile(REGULAR_FONT_PATH);
            }

            if (!fontBoldBuffer && await fs.pathExists(BOLD_FONT_PATH)) {
                logger.info(this.serviceName, 'Carregando fonte negrito...');
                fontBoldBuffer = await fs.readFile(BOLD_FONT_PATH);
            }

            if (!fontBuffer || !fontBoldBuffer) {
                const missing = [];
                if (!fontBuffer) missing.push('Inter-Regular.ttf');
                if (!fontBoldBuffer) missing.push('Inter-Bold.ttf');
                throw new Error(`Fontes locais não encontradas: ${missing.join(', ')}. Verifique src/assets/fonts/`);
            }
            logger.success(this.serviceName, 'Fontes carregadas com sucesso');
        } catch (e: any) {
            logger.error(this.serviceName, 'Falha crítica ao carregar fontes:', e.message);
            throw e;
        }
    }

    // Carregar o template HTML (prioriza customizado, fallback para padrão)
    async getTemplate(): Promise<string> {
        // Primeiro tenta carregar o template customizado
        if (await fs.pathExists(CUSTOM_TEMPLATE_PATH)) {
            return fs.readFile(CUSTOM_TEMPLATE_PATH, 'utf-8');
        }
        // Fallback para o template padrão
        if (await fs.pathExists(DEFAULT_TEMPLATE_PATH)) {
            return fs.readFile(DEFAULT_TEMPLATE_PATH, 'utf-8');
        }
        return '<div style="display: flex;">Template não encontrado</div>';
    }

    // Salvar template (salva no caminho customizado para persistência)
    async saveTemplate(html: string): Promise<void> {
        await fs.ensureDir(path.dirname(CUSTOM_TEMPLATE_PATH));
        await fs.writeFile(CUSTOM_TEMPLATE_PATH, html, 'utf-8');
        logger.success(this.serviceName, `Template salvo em: ${CUSTOM_TEMPLATE_PATH}`);
    }

    // Extrair template de linha de prêmio do HTML
    // Busca por: <!-- PREMIO_ROW -->...<!-- /PREMIO_ROW -->
    private extractRowTemplate(html: string): { rowTemplate: string; htmlWithoutRow: string } | null {
        const regex = /<!-- PREMIO_ROW -->([\s\S]*?)<!-- \/PREMIO_ROW -->/;
        const match = html.match(regex);

        if (match) {
            // Remove ALL occurrences of the PREMIO_ROW block (global), not just the first
            const globalRegex = /<!-- PREMIO_ROW -->[\s\S]*?<!-- \/PREMIO_ROW -->/g;
            return {
                rowTemplate: match[1].trim(),
                htmlWithoutRow: html.replace(globalRegex, '')
            };
        }
        return null;
    }

    // Gerar HTML dos prêmios usando o template de linha
    private generatePremiosFromTemplate(rowTemplate: string, premios: any[]): string {
        return premios.map((p: any, index: number) => {
            const isEven = index % 2 === 1;

            return rowTemplate
                .replace(/{{POSICAO}}/g, String(p.posicao))
                .replace(/{{MILHAR}}/g, String(p.milhar))
                .replace(/{{GRUPO}}/g, String(p.grupo).padStart(2, '0'))
                .replace(/{{BICHO}}/g, String(p.bicho))
                .replace(/{{INDEX}}/g, String(index))
                .replace(/{{IS_EVEN}}/g, isEven ? 'true' : 'false')
                .replace(/{{ROW_BG}}/g, isEven ? '#f9fafb' : '#ffffff')
                .replace(/{{ROW_CLASS}}/g, isEven ? 'row-even' : 'row-odd');
        }).join('');
    }

    // Gerar HTML preenchido com dados
    async renderHtml(resultado: any, overrideHtml?: string): Promise<string> {
        let template = overrideHtml || await this.getTemplate();

        // Tentar extrair template de linha customizado
        const rowExtraction = this.extractRowTemplate(template);

        let premiosHtml: string = '';

        if (rowExtraction) {
            // Usar template de linha customizado para gerar os prêmios
            premiosHtml = this.generatePremiosFromTemplate(rowExtraction.rowTemplate, resultado.premios);

            // O bloco PREMIO_ROW já foi removido globalmente pelo extractRowTemplate
            template = rowExtraction.htmlWithoutRow;

            // Substituir {{PREMIOS}} pelo conteúdo gerado (only place it should appear)
            template = template.replace(/{{PREMIOS}}/g, premiosHtml);
        } else {
            // Se não tem PREMIO_ROW, garantimos que {{PREMIOS}} não apareça como texto puro
            template = template.replace(/{{PREMIOS}}/g, '');
        }

        // Substituição de tokens globais
        const [y, m, d] = resultado.data.split('-');
        const dataFormatada = d && m && y ? `${d}/${m}/${y}` : resultado.data;

        template = template
            .replace(/{{DATA}}/g, dataFormatada)
            .replace(/{{HORARIO}}/g, resultado.horario)
            .replace(/{{LOTERICA}}/g, resultado.loterica);

        // Limpeza final: remover qualquer bloco PREMIO_ROW residual e tokens não processados
        return template
            .replace(/<!-- PREMIO_ROW -->[\s\S]*?<!-- \/PREMIO_ROW -->/gi, '')
            .replace(/{{PREMIOS_GENERATED}}/g, '')
            .replace(/{{PREMIOS}}/g, '');
    }


    // Sanitizar HTML para Satori: garantir que TODOS os divs tenham display: flex
    private sanitizeForSatori(html: string): string {
        return html.replace(/<div([^>]*)>/gi, (match, attrs) => {
            if (/display\s*:\s*flex/i.test(attrs)) {
                return match;
            }

            if (/style\s*=/i.test(attrs)) {
                return match.replace(/style\s*=\s*["']([^"']*)["']/i, (styleMatch, styleContent) => {
                    return `style="${styleContent}; display: flex; flex-direction: column;"`;
                });
            }

            return `<div${attrs} style="display: flex; flex-direction: column;">`;
        });
    }

    // Gerar Imagem (PNG) a partir do resultado
    async renderImage(resultado: any, overrideHtml?: string): Promise<Buffer> {
        if (this.initPromise) {
            await this.initPromise;
        }

        if (!fontBuffer || !fontBoldBuffer) {
            throw new Error("Fontes não carregadas. Verifique src/assets/fonts/");
        }

        const html = await this.renderHtml(resultado, overrideHtml);
        const sanitizedHtml = this.sanitizeForSatori(html);

        const cleanHtml = sanitizedHtml
            .replace(/>\s+</g, '><')
            .replace(/\n\s+/g, '\n')
            .replace(/\s+\n/g, '\n')
            .trim();

        const bodyMatch = cleanHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i);
        const content = bodyMatch ? bodyMatch[1] : cleanHtml;

        // Wrapper com largura 700px para escala correta
        const markup = toReactNode(`<div style="display: flex; flex-direction: column; width: 700px; background-color: transparent;">${content}</div>`) as any;

        // Renderizar SVG em 2x (700px = 350px * 2)
        const svg = await satori(
            markup,
            {
                width: 700,
                height: undefined,
                fonts: [
                    {
                        name: 'Inter',
                        data: fontBuffer!,
                        weight: 400,
                        style: 'normal',
                    },
                    {
                        name: 'Inter',
                        data: fontBoldBuffer!,
                        weight: 700,
                        style: 'normal',
                    },
                ],
            }
        );

        // Gerar PNG em resolução 2x (700px)
        const resvg = new Resvg(svg, {
            fitTo: { mode: 'width', value: 700 },
        });

        return resvg.render().asPng();
    }
}
