import puppeteer, { type Browser } from 'puppeteer';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import Mustache from 'mustache';
import { getDb } from '../database/schema.js';
import { formatDateBR } from '../utils/helpers.js';
import { calcularBicho } from '../config/bichos.js';
import { log } from '../utils/Logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TEMPLATES_DIR = join(__dirname, '..', '..', '.explicações');
const VIEWPORT_WIDTH = 700;

let browser: Browser | null = null;

/**
 * Ensures a shared Puppeteer browser instance is running.
 */
async function getBrowser(): Promise<Browser> {
    if (!browser || !browser.connected) {
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
        });
    }
    return browser;
}

/**
 * Loads one of the 5 base HTML templates from .explicações/.
 */
function loadBaseTemplate(name: string): string {
    const path = join(TEMPLATES_DIR, name);
    return readFileSync(path, 'utf-8');
}

// Pre-load all templates
const TEMPLATES = {
    resultado: () => loadBaseTemplate('resultados_exemplo.html'),
    palpite: () => loadBaseTemplate('palpites_exemplo.html'),
    premiado_unitario: () => loadBaseTemplate('palpite_premiado_exemplo.html'),
    premiado_dia: () => loadBaseTemplate('palpite_premiado_dia_exemplo.html'),
    cotacao: () => loadBaseTemplate('cotação_exemplo.html'),
};

/**
 * Finds all remote URLs in HTML (background-image, img src) and inlines them as Base64.
 */
async function inlineRemoteImages(html: string): Promise<string> {
    // Match background-image: url('https://...')
    const bgRegex = /background-image:\s*(?:linear-gradient\([^)]*\),\s*)?url\(['"]?(https?:\/\/[^'")\s]+)['"]?\)/g;
    const imgRegex = /<img[^>]+src=["'](https?:\/\/[^"']+)["']/g;

    const urls = new Set<string>();
    let match;

    while ((match = bgRegex.exec(html)) !== null) urls.add(match[1]);
    while ((match = imgRegex.exec(html)) !== null) urls.add(match[1]);

    for (const url of urls) {
        try {
            const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 10000 });
            const contentType = response.headers['content-type'] || 'image/png';
            const base64 = Buffer.from(response.data).toString('base64');
            const dataUri = `data:${contentType};base64,${base64}`;
            html = html.replaceAll(url, dataUri);
        } catch (err: any) {
            log.warn('RENDER', `Falha ao inline imagem: ${url}`, { error: err.message });
        }
    }

    return html;
}

/**
 * Renders HTML to PNG using Headless Browser (Puppeteer).
 * Viewport is locked to 700px width.
 */
async function htmlToPng(html: string): Promise<Buffer> {
    const br = await getBrowser();
    const page = await br.newPage();

    await page.setViewport({ width: VIEWPORT_WIDTH, height: 100 });
    await page.setContent(html, { waitUntil: 'networkidle0' });

    // Get actual content height
    const height = await page.evaluate(() => {
        const body = document.body;
        const html = document.documentElement;
        return Math.max(body.scrollHeight, body.offsetHeight, html.clientHeight, html.scrollHeight, html.offsetHeight);
    });

    await page.setViewport({ width: VIEWPORT_WIDTH, height });

    const screenshot = await page.screenshot({ type: 'png', fullPage: true });
    await page.close();

    return Buffer.from(screenshot);
}

// ==================== RENDER FUNCTIONS ====================

/**
 * Renders a resultado (lottery result) as HTML string.
 */
export function renderResultadoHtml(resultado: any): string {
    const template = TEMPLATES.resultado();

    // Build rows HTML matching the exact structure of resultados_exemplo.html
    const rows = (resultado.premios || []).map((p: any, i: number) => {
        const bgStyle = i % 2 === 1 ? ' background-color: #fafafa;' : '';
        return `
            <tr style="border-bottom: 1px solid #eee;${bgStyle}">
                <td style="padding: 10px 2px; font-weight: 700; text-align: center;">${p.posicao}°</td>
                <td style="padding: 10px 2px; font-weight: 700; text-align: center; letter-spacing: 1px; font-size: 1.1rem;">${p.milhar}</td>
                <td style="padding: 10px 2px; font-weight: 800; text-align: center; color: #f1c40f; font-size: 1.2rem;">${String(p.grupo).padStart(2, '0')}</td>
                <td style="padding: 10px 2px; font-weight: 600; text-align: center; color: #555;">${p.bicho}</td>
            </tr>`;
    }).join('\n');

    // Replace header data
    let html = template;
    const tituloLoterica = resultado.nome_original && resultado.nome_original.trim() !== ''
        ? resultado.nome_original.toUpperCase()
        : `${resultado.loterica_nome || resultado.loterica_slug} - ${resultado.estado || ''}`;

    html = html.replace('CAMPINA GRANDE - PB', tituloLoterica);
    html = html.replace('12:45', resultado.horario || '');
    html = html.replace('19/02/2026', formatDateBR(resultado.data));

    // Replace tbody content
    html = html.replace(/<tbody[^>]*>[\s\S]*?<\/tbody>/, () => `<tbody style="color: #333;">\n${rows}\n        </tbody>`);

    return html;
}

/**
 * Renders a resultado as PNG image buffer.
 */
export async function renderResultadoImage(resultado: any): Promise<Buffer> {
    let html = renderResultadoHtml(resultado);
    html = wrapFullPage(html);
    html = await inlineRemoteImages(html);
    return htmlToPng(html);
}

/**
 * Renders palpites do dia as HTML.
 */
export function renderPalpitesHtml(palpites: any): string {
    const template = TEMPLATES.palpite();
    let html = template;

    // Replace date
    html = html.replace(/\d{2}\/\d{2}\/\d{4}/, formatDateBR(palpites.data));

    // Build HTML blocks
    const gruposHtml = (palpites.grupos || []).map((g: any) => `
        <div style="background: #f4f3ff; border: 1px solid #e0dbff; border-radius: 10px; padding: 10px; text-align: center;">
            <div style="font-size: 0.65rem; color: #999; font-weight: 800; text-transform: uppercase;">Grupo</div>
            <div style="font-size: 1.1rem; font-weight: 900; color: #3f31b3; margin: 2px 0;">${g.bicho.toUpperCase()}</div>
            <div style="font-size: 0.75rem; color: #555; font-weight: 700;">${g.dezenas.replace(/,/g, ' -')}</div>
        </div>`).join('\n');

    const centenasHtml = (palpites.centenas || []).map((c: string) => {
        const bichoNome = calcularBicho(c);
        return `
        <div style="background: #fffdf5; border: 1px solid #fcf3cf; border-radius: 10px; padding: 10px; text-align: center;">
            <div style="font-size: 0.6rem; color: #999; font-weight: 800; text-transform: uppercase;">${bichoNome}</div>
            <div style="font-size: 1.1rem; font-weight: 900; color: #d4ac0d;">${c}</div>
        </div>`;
    }).join('\n');

    const milharesHtml = (palpites.milhares || []).map((m: string) => {
        const bichoNome = calcularBicho(m);
        return `
        <div style="background: #f4faff; border: 1px solid #d6eaf8; border-radius: 10px; padding: 10px; text-align: center;">
            <div style="font-size: 0.6rem; color: #999; font-weight: 800; text-transform: uppercase;">${bichoNome}</div>
            <div style="font-size: 1.1rem; font-weight: 900; color: #2e86c1; letter-spacing: 1px;">${m}</div>
        </div>`;
    }).join('\n');

    // Replace templates using sections markers
    const regexSec1 = /<!-- SEÇÃO 1: GRUPOS DO DIA -->[\s\S]*?(?=<!-- SEÇÃO 2: CENTENAS DO DIA -->)/i;
    const regexSec2 = /<!-- SEÇÃO 2: CENTENAS DO DIA -->[\s\S]*?(?=<!-- SEÇÃO 3: MILHARES DO DIA -->)/i;
    const regexSec3 = /<!-- SEÇÃO 3: MILHARES DO DIA -->[\s\S]*?(?=<!-- Rodapé -->)/i;

    html = html.replace(regexSec1, `<!-- SEÇÃO 1: GRUPOS DO DIA -->
    <div style="background-color: #f8f9fa; padding: 10px 15px; border-bottom: 1px solid #eee;">
        <span style="font-size: 0.75rem; font-weight: 800; color: #3f31b3; text-transform: uppercase;">⭐ Grupos do Dia</span>
    </div>
    <div style="padding: 12px; display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px;">
        ${gruposHtml}
    </div>\n\n    `);

    html = html.replace(regexSec2, `<!-- SEÇÃO 2: CENTENAS DO DIA -->
    <div style="background-color: #f8f9fa; padding: 10px 15px; border-bottom: 1px solid #eee; border-top: 1px solid #eee;">
        <span style="font-size: 0.75rem; font-weight: 800; color: #d4ac0d; text-transform: uppercase;">⭐ Centenas do Dia</span>
    </div>
    <div style="padding: 12px; display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 8px;">
        ${centenasHtml}
    </div>\n\n    `);

    html = html.replace(regexSec3, `<!-- SEÇÃO 3: MILHARES DO DIA -->
    <div style="background-color: #f8f9fa; padding: 10px 15px; border-bottom: 1px solid #eee; border-top: 1px solid #eee;">
        <span style="font-size: 0.75rem; font-weight: 800; color: #2e86c1; text-transform: uppercase;">⭐ Milhares do Dia</span>
    </div>
    <div style="padding: 12px; display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 8px;">
        ${milharesHtml}
    </div>\n\n    `);

    return html;
}

export async function renderPalpitesImage(palpites: any): Promise<Buffer> {
    let html = renderPalpitesHtml(palpites);
    html = wrapFullPage(html);
    html = await inlineRemoteImages(html);
    return htmlToPng(html);
}

/**
 * Renders a single premiado (hit) as HTML.
 */
export function renderPremiadoUnitarioHtml(premiado: any): string {
    const template = TEMPLATES.premiado_unitario();
    let html = template;

    // Replace dynamic data in the template
    html = html.replace('LOOK - GOIÁS (07h)', premiado.extracao || '');
    html = html.replace('2326', premiado.numero || '');
    html = html.replace('CARNEIRO (Grupo 07)', premiado.numero || '');
    html = html.replace(/\d{2}\/\d{2}\/\d{4}/, formatDateBR(premiado.data));

    return html;
}

export async function renderPremiadoUnitarioImage(premiado: any): Promise<Buffer> {
    let html = renderPremiadoUnitarioHtml(premiado);
    html = wrapFullPage(html);
    html = await inlineRemoteImages(html);
    return htmlToPng(html);
}

/**
 * Renders all premiados do dia as HTML (grid layout).
 */
export function renderPremiadosDiaHtml(premiados: any[], data: string): string {
    const template = TEMPLATES.premiado_dia();
    let html = template;

    // Replace date
    html = html.replace(/\d{2}\/\d{2}\/\d{4}/, formatDateBR(data));

    // Separate by type
    const grupos = premiados.filter(p => p.tipo === 'grupo');
    const centenas = premiados.filter(p => p.tipo === 'centena');
    const milhares = premiados.filter(p => p.tipo === 'milhar');

    // Build cards for each section
    const buildCards = (items: any[], colorMain: string, colorBg: string, colorBorder: string, label: string) => {
        return items.map(item => `
        <div style="background: ${colorBg}; border: 1px solid ${colorBorder}; border-radius: 12px; padding: 12px; text-align: center; display: flex; flex-direction: column; justify-content: center; min-height: 95px;">
            <div style="font-size: 0.65rem; color: #999; font-weight: 700; text-transform: uppercase;">${label}</div>
            <div style="font-size: 1.2rem; font-weight: 900; color: ${colorMain}; margin: 4px 0; letter-spacing: 1px;">${item.numero}</div>
            <div style="font-weight: 800; font-size: 0.7rem; color: #333; text-transform: uppercase;">${item.extracao}</div>
            <div style="font-size: 0.65rem; color: ${colorMain}; font-weight: 900; margin-top: 4px;">${item.premio}</div>
        </div>`).join('\n');
    };

    const grupoCards = buildCards(grupos, '#27ae60', '#fafffb', '#e8f5e9', 'Grupo');
    const centenaCards = buildCards(centenas, '#f1c40f', '#fffdf5', '#fcf3cf', 'Centena');
    const milharCards = buildCards(milhares, '#2e86c1', '#f4faff', '#d6eaf8', 'Milhar');

    // Replace sections in template - find the grid divs and replace their contents
    // Replace grupos section
    const grupoGridRegex = /(⭐ Grupos Premiados[\s\S]*?<\/div>\s*<div[^>]*display:\s*grid[^>]*>)([\s\S]*?)(<\/div>\s*<!--\s*SEÇÃO 2)/;
    html = html.replace(grupoGridRegex, (match, p1, p2, p3) => p1 + '\n' + (grupoCards || '<!-- Nenhum grupo premiado -->') + p3);

    // Replace centenas section
    const centenaGridRegex = /(⭐ Centenas Premiadas[\s\S]*?<\/div>\s*<div[^>]*display:\s*grid[^>]*>)([\s\S]*?)(<\/div>\s*<!--\s*SEÇÃO 3)/;
    html = html.replace(centenaGridRegex, (match, p1, p2, p3) => p1 + '\n' + (centenaCards || '<!-- Nenhuma centena premiada -->') + p3);

    // Replace milhares section
    const milharGridRegex = /(⭐ Milhares Premiadas[\s\S]*?<\/div>\s*<div[^>]*display:\s*grid[^>]*>)([\s\S]*?)(<\/div>\s*<!--\s*Rodapé)/;
    html = html.replace(milharGridRegex, (match, p1, p2, p3) => p1 + '\n' + (milharCards || '<!-- Nenhuma milhar premiada -->') + p3);

    return html;
}

export async function renderPremiadosDiaImage(premiados: any[], data: string): Promise<Buffer> {
    let html = renderPremiadosDiaHtml(premiados, data);
    html = wrapFullPage(html);
    html = await inlineRemoteImages(html);
    return htmlToPng(html);
}

/**
 * Renders cotações as HTML.
 */
export function renderCotacoesHtml(cotacoes: any[]): string {
    const template = TEMPLATES.cotacao();
    let html = template;

    const rows = cotacoes.map((c: any, i: number) => {
        const bgStyle = i % 2 === 1 ? ' background-color: #fafafa;' : '';
        return `
            <tr style="border-bottom: 1px solid #eee;${bgStyle}">
                <td style="padding: 12px 8px; font-weight: 700; text-align: center; color: #2c3e50;">${c.modalidade}</td>
                <td style="padding: 12px 8px; font-weight: 800; text-align: center; color: #27ae60; font-size: 1.1rem;">${c.valor}</td>
            </tr>`;
    }).join('\n');

    html = html.replace(/<tbody[^>]*>[\s\S]*?<\/tbody>/, `<tbody>\n${rows}\n        </tbody>`);

    return html;
}

export async function renderCotacoesImage(cotacoes: any[]): Promise<Buffer> {
    let html = renderCotacoesHtml(cotacoes);
    html = wrapFullPage(html);
    html = await inlineRemoteImages(html);
    return htmlToPng(html);
}

/**
 * Wraps HTML snippet in a full page with proper styling.
 */
function wrapFullPage(html: string): string {
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=${VIEWPORT_WIDTH}">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { width: ${VIEWPORT_WIDTH}px; font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: transparent; }
</style>
</head>
<body>
${html}
</body>
</html>`;
}

/**
 * Closes the shared browser instance.
 */
export async function closeBrowser(): Promise<void> {
    if (browser) {
        await browser.close();
        browser = null;
    }
}
