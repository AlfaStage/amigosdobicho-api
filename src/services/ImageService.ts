import fs from 'fs-extra';
import path from 'path';
import { logger } from '../utils/logger.js';
import db from '../db.js';

// Placeholder para importação dinâmica ou uso de API externa de renderização
// Como o ambiente é Node puro, usaríamos 'puppeteer' ou 'satori'.
// Dado que o package.json tem 'satori', 'satori-html' e '@resvg/resvg-js', usaremos satori.
import satori from 'satori';
import { html } from 'satori-html';
import { Resvg } from '@resvg/resvg-js';

export class ImageService {
    private serviceName = 'ImageService';
    private fontBuffer: Buffer | null = null;

    constructor() {
        this.loadFont();
    }

    private async loadFont() {
        try {
            // Tentar carregar uma fonte padrão. Se não tiver, precisa providenciar.
            // Vou assumir que existe alguma fonte ou usar uma padrão do sistema se possível, 
            // mas satori precisa de Buffer de fonte.
            // Para simplificar, vou tentar ler uma fonte do diretório de assets se existir, 
            // senão... Satori precisa de fonte. Vou deixar um TODO e um try/catch.
            const fontPath = path.resolve('assets/fonts/Inter-Regular.ttf');
            if (fs.existsSync(fontPath)) {
                this.fontBuffer = fs.readFileSync(fontPath);
            }
        } catch (e) {
            logger.warn(this.serviceName, 'Fonte não carregada. Imagens podem falhar se não houver fonte.');
        }
    }

    async generateBingoImage(loterica: string, data: string, acertos: any[]): Promise<string> {
        try {
            const template = this.getTemplate('bingo');
            const htmlContent = this.fillTemplate(template.html_content, { loterica, data, acertos });

            const pngBuffer = await this.renderToPng(htmlContent, template.width, template.height);

            const fileName = `bingo-${loterica}-${Date.now()}.png`;
            const filePath = path.resolve('public/images', fileName);

            fs.ensureDirSync(path.dirname(filePath));
            fs.writeFileSync(filePath, pngBuffer);

            // Retornar URL pública (assumindo localhost:3002 por enquanto ou base URL configurada)
            const baseUrl = process.env.BASE_URL || 'http://localhost:3002';
            return `${baseUrl}/public/images/${fileName}`;

        } catch (error: any) {
            logger.error(this.serviceName, `Erro ao gerar imagem de bingo: ${error.message}`);
            return '';
        }
    }

    async generateBingoHtml(loterica: string, data: string, acertos: any[]): Promise<string> {
        // Similar à imagem, mas salva .html e retorna link
        try {
            const template = this.getTemplate('bingo');
            const htmlContent = this.fillTemplate(template.html_content, { loterica, data, acertos });

            const fileName = `bingo-${loterica}-${Date.now()}.html`;
            const filePath = path.resolve('public/share', fileName);

            fs.ensureDirSync(path.dirname(filePath));
            fs.writeFileSync(filePath, htmlContent); // Talvez envolver em <html><body>... se for só fragmento

            const baseUrl = process.env.BASE_URL || 'http://localhost:3002';
            return `${baseUrl}/public/share/${fileName}`;
        } catch (error: any) {
            logger.error(this.serviceName, `Erro ao gerar HTML de bingo: ${error.message}`);
            return '';
        }
    }

    private getTemplate(type: string): { html_content: string, width: number, height: number } {
        const tpl = db.prepare('SELECT html_content, width, height FROM templates WHERE type = ?').get(type) as any;
        if (tpl) return tpl;

        // Fallback
        return {
            html_content: '<div style="display:flex; flex-direction:column; background:white; width:100%; height:100%;"><h1>BINGO DEFAULT</h1></div>',
            width: 1080,
            height: 1080
        };
    }

    private fillTemplate(html: string, data: any): string {
        // Simple mustache-like generic replacement
        // Note: satori-html handles generic HTML structures suitable for React-like styles
        let filled = html;

        filled = filled.replace(/{{loterica}}/g, data.loterica);
        filled = filled.replace(/{{data}}/g, data.data);

        // Handle list iteration simply (mockup logic)
        if (data.acertos && filled.includes('{{#acertos}}')) {
            // Very basic logic -> would be better to use Handlebars.js properly
            // For now, let's construct a string manually for the list part if needed
            // or just replace a block. 
            // To be robust, I should really import 'handlebars' or similar if I can.
            // But let's assume simple string mapping for now to keep deps low if not requested.
            const listItems = data.acertos.map((a: any) => `<li>${a.tipo}: ${a.valor}</li>`).join('');
            filled = filled.replace(/{{acertos}}/g, listItems); // If usage is {{acertos}} instead of block
        }

        return filled;
    }

    private async renderToPng(htmlStr: string, width: number, height: number): Promise<Buffer> {
        // Satori logic
        // Need to parse htmlStr into React-element-like object for Satori
        const markup = html(htmlStr as any); // satori-html return type cast

        const svg = await satori(markup as any, {
            width,
            height,
            fonts: this.fontBuffer ? [{
                name: 'Inter',
                data: this.fontBuffer,
                weight: 400,
                style: 'normal',
            }] : [],
        });

        const resvg = new Resvg(svg, {
            fitTo: { mode: 'width', value: width },
        });

        const pngData = resvg.render();
        return pngData.asPng();
    }
}
