import axios from 'axios';
import * as cheerio from 'cheerio';
import puppeteer from 'puppeteer';
import { getDb, saveDatabase } from '../database/schema.js';
const ESTADOS_API: string[] = ['DF', 'BA', 'GO', 'MG', 'PB', 'RJ', 'SP', 'NA'];
import { getBestProxy } from './ProxyService.js';
import { todayStr } from '../utils/helpers.js';
import { log } from '../utils/Logger.js';
import { Signo, SIGNOS } from './HoroscopoService.js';
import { checkPalpitesPremiados } from './AmigosDoBichoService.js';

const API_BASE = 'https://api.amigosdobicho.com/raffle-results/filter';
const PALPITES_URL = 'https://www.resultadofacil.com.br/palpites-do-dia';
const COTACAO_URL = 'https://amigosdobicho.com/cotacoes';
const HOROSCOPO_URL = 'https://www.ojogodobicho.com/horoscopo.htm';

function getAxiosConfig(): any {
    const proxy = getBestProxy();
    const config: any = {
        timeout: 20000,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
    };
    if (process.env.API_TOKEN) {
        config.headers['x-api-token'] = process.env.API_TOKEN;
    }
    if (proxy && !proxy.protocol.startsWith('socks')) {
        config.proxy = { host: proxy.host, port: parseInt(proxy.port, 10), protocol: proxy.protocol + ':' };
        if (proxy.username && proxy.password) {
            config.proxy.auth = { username: proxy.username, password: proxy.password };
        }
    }
    return config;
}

const API_FALLBACK = 'https://api.amigosdobicho.com/external-results/results/state';

/**
 * Fetches results from the official API for a given state.
 * If empty or error, falls back to the external results API.
 */
export async function fetchResultados(estado: string, date: string = todayStr()): Promise<any[]> {
    let data: any[] = [];
    let apiError = false;

    try {
        const res = await axios.get(API_BASE, {
            ...getAxiosConfig(),
            params: { state: estado, date },
        });
        data = Array.isArray(res.data) ? res.data : [];
    } catch (err: any) {
        apiError = true;
        log.warn('SCRAPER', `Resultados [${estado}]: API principal falhou. Tentando fallback...`, err.message);
    }

    if (data.length === 0) {
        if (!apiError) {
            log.info('SCRAPER', `Resultados [${estado}]: Nenhum dado encontrado na API principal.`);
        }
        try {
            const fallbackUrl = `${API_FALLBACK}/${estado}`;
            const fallbackRes = await axios.get(fallbackUrl, {
                params: { date },
                headers: { 'User-Agent': 'Mozilla/5.0' }
            });
            const fallbackData = Array.isArray(fallbackRes.data) ? fallbackRes.data : (fallbackRes.data?.data || []);

            data = fallbackData.map((item: any) => ({
                lottery: item.raffle?.lottery || item.lottery || '',
                name: item.raffle?.nickname || item.raffle?.alias || item.name || '',
                time: item.raffle?.time || item.time || '',
                results: (item.draws || []).map((d: any) => ({
                    premio: d.position ? parseInt(d.position) : undefined,
                    milhar: d.number,
                    grupo: d.group,
                    bicho: d.animal
                }))
            }));

            if (data.length > 0) {
                log.success('SCRAPER', `Resultados [${estado}]: Fallback recuperou ${data.length} loterias.`);
            }
        } catch (fallbackErr: any) {
            log.error('SCRAPER', `Resultados [${estado}]: API de fallback falhou`, fallbackErr.message);
        }
    }

    return data;
}

/**
 * Fetches all results for all states.
 */
export async function fetchAllResultados(): Promise<any[]> {
    const results: any[] = [];
    for (const estado of ESTADOS_API) {
        const data = await fetchResultados(estado);
        results.push(...data);
    }
    return results;
}

/**
 * Fetches daily palpites from resultadofacil.
 */
export async function fetchPalpites(useProxy = true): Promise<{
    grupos: { bicho: string; grupo: number; dezenas: string }[];
    milhares: string[];
    centenas: string[];
}> {
    let browser: any;
    try {
        log.info('SCRAPER', `Buscando Palpites via Puppeteer (Proxy: ${useProxy})...`);
        let proxy = useProxy ? getBestProxy() : null;
        if (proxy) {
            log.info('SCRAPER', `Usando proxy ${proxy.host}:${proxy.port} (${(proxy as any).country || '??'}) para Palpites`);
        } else {
            log.info('SCRAPER', `Buscando Palpites sem proxy`);
        }

        const args = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'];
        if (proxy) args.push(`--proxy-server=${proxy.protocol}://${proxy.host}:${proxy.port}`);

        browser = await puppeteer.launch({
            headless: true,
            args,
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined
        });
        const page = await browser.newPage();

        if (proxy?.username && proxy?.password) {
            await page.authenticate({ username: proxy.username, password: proxy.password });
        }

        // Stealth: Randomize window properties
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => false });
            // @ts-ignore
            window.chrome = { runtime: {} };
            Object.defineProperty(navigator, 'languages', { get: () => ['pt-BR', 'pt', 'en'] });
        });

        // Verify IP (to confirm proxy is active)
        if (proxy) {
            try {
                await page.goto('https://api.ipify.org?format=json', { waitUntil: 'networkidle2', timeout: 8000 });
                const ipData = JSON.parse(await page.evaluate(() => document.body.innerText));
                log.info('SCRAPER', `IP Verificado: ${ipData.ip}`);
            } catch (e) {
                log.warn('SCRAPER', 'Proxy parece lento ou instável (IP check timeout).');
            }
        }

        log.info('SCRAPER', `Navegando para ${PALPITES_URL}...`);
        let html = '';
        let needsFallback = false;

        try {
            await page.goto(PALPITES_URL, { waitUntil: 'networkidle2', timeout: 30000 });
            await new Promise(r => setTimeout(r, 4000));
            html = await page.content();

            if (html.includes('Checking your browser') || html.length < 5000 || html.includes('Acesso bloqueado') || html.includes('gocache-error-page') || html.toLowerCase().includes('forbidden')) {
                log.warn('SCRAPER', 'Conteúdo detectado como bloqueio (GoCache/Cloudflare/Forbidden).');
                needsFallback = true;
            }
        } catch (err) {
            log.warn('SCRAPER', 'Navegação direta falhou ou deu timeout. Tentando fallback via Google...');
            needsFallback = true;
        }

        // Tenta Fallback via Google se necessário
        if (needsFallback) {
            try {
                // Navigate to Google
                await page.goto('https://www.google.com/search?q=resultado+facil+palpites+do+dia+hoje', { waitUntil: 'networkidle2', timeout: 20000 });
                await new Promise(r => setTimeout(r, 3000));

                const targetLink = await page.evaluate(() => {
                    const links = Array.from(document.querySelectorAll('a'));
                    const match = links.find(a => a.href.includes('resultadofacil.com.br/palpites-do-dia'));
                    return match ? match.href : null;
                });

                if (targetLink) {
                    log.info('SCRAPER', `Link encontrado no Google (${targetLink}). Navegando via Referer...`);
                    await page.goto(targetLink, { waitUntil: 'networkidle2', timeout: 30000 });
                    await new Promise(r => setTimeout(r, 4000));
                    html = await page.content();
                } else {
                    log.error('SCRAPER', 'Link não encontrado no Google. Tentando busca específica...');
                    await page.goto('https://www.google.com/search?q=site:resultadofacil.com.br+"palpites+do+dia"', { waitUntil: 'networkidle2', timeout: 15000 });
                    await new Promise(r => setTimeout(r, 2000));
                    const retryLink = await page.evaluate(() => {
                        const links = Array.from(document.querySelectorAll('a'));
                        const match = links.find(a => a.href.includes('resultadofacil.com.br/palpites-do-dia'));
                        return match ? match.href : null;
                    });
                    if (retryLink) {
                        await page.goto(retryLink, { waitUntil: 'networkidle2', timeout: 30000 });
                        await new Promise(r => setTimeout(r, 4000));
                        html = await page.content();
                    }
                }
            } catch (fallbackErr: any) {
                log.error('SCRAPER', 'Falha fatal no fallback via Google', fallbackErr.message);
                // Se falhou no fallback e estamos usando proxy, força erro para pegar no catch externo
                if (useProxy) throw new Error(`Fallback falhou no proxy: ${fallbackErr.message}`);
            }
        }

        // Se ainda estiver bloqueado ou vazio APÓS fallback, força erro para failover do proxy
        if (useProxy && (html.length < 5000 || html.includes('Acesso bloqueado'))) {
            throw new Error('Bloqueio persistente detectado mesmo após fallback.');
        }

        const cleanHtml = log.sanitize(html);
        log.info('SCRAPER', `Conteúdo recebido: ${html.length} bytes`);
        const $ = cheerio.load(html);

        const text = $('body').text();

        // Extract grupos: "Animal - Grupo XX"
        const grupoRegex = /([A-ZÀ-ÿa-zà-ÿ]+)\s*-\s*Grupo\s*(\d+)/gi;
        const grupos: { bicho: string; grupo: number; dezenas: string }[] = [];
        let match;
        while ((match = grupoRegex.exec(text)) !== null) {
            const bicho = match[1].trim();
            const grupo = parseInt(match[2], 10);
            const afterText = text.slice(match.index + match[0].length, match.index + match[0].length + 200);
            const dezenasMatch = afterText.match(/Dezenas?:\s*([\d,\s]+)/i);
            const dezenas = dezenasMatch ? dezenasMatch[1].trim() : '';
            if (!grupos.find(g => g.grupo === grupo)) {
                grupos.push({ bicho, grupo, dezenas });
            }
        }

        const milhares: string[] = [];
        const centenas: string[] = [];
        $('p, div, span').each((i: number, el: any) => {
            const elText = $(el).text();
            if (elText.includes('-') && /\d{3,4}/.test(elText) && elText.length < 500) {
                const numbers = elText.split('-').map(n => n.trim()).filter(n => /^\d+$/.test(n));
                for (let n of numbers) {
                    if (n.length === 4 && !milhares.includes(n)) milhares.push(n);
                    else if (n.length === 3 && !centenas.includes(n)) centenas.push(n);
                }
            }
        });

        if (grupos.length === 0) log.warn('SCRAPER', 'Nenhum grupo encontrado no texto do site.');
        if (milhares.length === 0) log.warn('SCRAPER', 'Nenhuma milhar/centena encontrada no texto do site.');

        return { grupos, milhares, centenas };
    } catch (err: any) {
        log.error('SCRAPER', `Erro em fetchPalpites (Proxy: ${useProxy})`, err.message || err);

        // Se falhou usando proxy por timeout/rede OU bloqueio, tenta sem proxy
        if (useProxy) {
            log.warn('SCRAPER', 'Falha total usando Proxy. Tentando CONEXÃO DIRETA agora...');
            return fetchPalpites(false);
        }

        return { grupos: [], milhares: [], centenas: [] };
    } finally {
        if (browser) await browser.close();
    }
}

/**
 * Saves palpites to the database.
 */
export function savePalpites(data: string, palpites: {
    grupos: { bicho: string; grupo: number; dezenas: string }[];
    milhares: string[];
    centenas: string[];
}): void {
    const db = getDb();

    // Check if already exists
    const existing = db.exec("SELECT id FROM palpites_dia WHERE data = ?", [data]);
    if (existing.length && existing[0].values.length) return;

    const palpiteId = crypto.randomUUID();
    db.run('INSERT INTO palpites_dia (id, data) VALUES (?, ?)', [palpiteId, data]);

    for (const g of palpites.grupos) {
        db.run(
            'INSERT INTO palpites_grupos (id, palpite_id, bicho, grupo, dezenas) VALUES (?, ?, ?, ?, ?)',
            [crypto.randomUUID(), palpiteId, g.bicho, g.grupo, g.dezenas]
        );
    }

    for (const m of palpites.milhares) {
        db.run(
            'INSERT INTO palpites_milhares (id, palpite_id, numero) VALUES (?, ?, ?)',
            [crypto.randomUUID(), palpiteId, m]
        );
    }

    for (const c of palpites.centenas) {
        db.run(
            'INSERT INTO palpites_centenas (id, palpite_id, numero) VALUES (?, ?, ?)',
            [crypto.randomUUID(), palpiteId, c]
        );
    }

    saveDatabase();
    log.success('SCRAPER', `Palpites salvos para ${data}`, { grupos: palpites.grupos.length, milhares: palpites.milhares.length, centenas: palpites.centenas.length });

    // After saving palpites, check if any EXISTING results (from earlier today) are winners
    checkPalpitesPremiados(data);

    // Update Scraping Status
    db.run(
        `INSERT INTO scraping_status (id, loterica_slug, data, horario, status, updated_at)
         VALUES (?, 'palpites', ?, '07:00', 'success', datetime('now'))
         ON CONFLICT(loterica_slug, data, horario) DO UPDATE SET status = 'success', updated_at = datetime('now')`,
        [crypto.randomUUID(), data]
    );
}

/**
 * Fetches cotações from resultadofacil.
 */
export async function fetchCotacoes(): Promise<{ modalidade: string; valor: string }[]> {
    let browser;
    try {
        log.info('SCRAPER', 'Buscando cotações via Puppeteer no domínio amigosdobicho.com...');
        let proxy = getBestProxy();
        if (proxy) {
            log.info('SCRAPER', `Usando proxy ${proxy.host}:${proxy.port} para Cotações`);
        } else {
            log.info('SCRAPER', `Buscando Cotações sem proxy`);
        }

        const args = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'];
        if (proxy) args.push(`--proxy-server=${proxy.protocol}://${proxy.host}:${proxy.port}`);

        browser = await puppeteer.launch({
            headless: true,
            args,
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined
        });
        const page = await browser.newPage();

        if (proxy?.username && proxy?.password) {
            await page.authenticate({ username: proxy.username, password: proxy.password });
        }

        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
        await page.goto(COTACAO_URL, { waitUntil: 'networkidle0', timeout: 30000 });

        const html = await page.content();
        const $ = cheerio.load(html);
        const cotacoes: { modalidade: string; valor: string }[] = [];

        $('*').each((i, el) => {
            const txt = $(el).text().trim();
            // Regex to catch "Milhar 1xR$ 4.000,00" or similar patterns
            const match = txt.match(/^([A-Za-zÀ-ÿ\s/]+?)1x(R\$\s*[\d.,]+)/);
            if (match) {
                let modalidade = match[1].trim();
                const valor = match[2].trim();

                modalidade = modalidade.replace(/^JOGO DO BICHO/i, '').trim();

                if (modalidade.length < 50 && modalidade.length > 2) {
                    cotacoes.push({ modalidade, valor });
                }
            }
        });

        if (cotacoes.length === 0) throw new Error("Não foi possível extrair elementos da SPA");
        return cotacoes;
    } catch (err: any) {
        log.error('SCRAPER', 'fetchCotacoes falhou', err);
        return [];
    } finally {
        if (browser) await browser.close();
    }
}

const SIGNO_SLUGS: Record<string, string> = {
    'Áries': 'aries', 'Touro': 'touro', 'Gêmeos': 'gemeos', 'Câncer': 'cancer',
    'Leão': 'leao', 'Virgem': 'virgem', 'Libra': 'libra', 'Escorpião': 'escorpiao',
    'Sagitário': 'sagitario', 'Capricórnio': 'capricornio', 'Aquário': 'aquario', 'Peixes': 'peixes',
};

/**
 * Fetches horoscopo do dia using Puppeteer from ojogodobicho.com (Multi-page extraction).
 */
export async function fetchHoroscopo() {
    let browser;
    try {
        log.info('SCRAPER', 'Iniciando extração multi-página de Horóscopo em ojogodobicho.com...');
        let proxy = getBestProxy();
        if (proxy) {
            log.info('SCRAPER', `Usando proxy ${proxy.host}:${proxy.port} para Horóscopo`);
        } else {
            log.info('SCRAPER', `Buscando Horóscopo sem proxy`);
        }

        const args = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'];
        if (proxy) args.push(`--proxy-server=${proxy.protocol}://${proxy.host}:${proxy.port}`);

        browser = await puppeteer.launch({
            headless: true,
            args,
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined
        });
        const page = await browser.newPage();

        if (proxy?.username && proxy?.password) {
            await page.authenticate({ username: proxy.username, password: proxy.password });
        }

        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

        const signosResults: any[] = [];

        for (const signoNome of SIGNOS) {
            const slug = SIGNO_SLUGS[signoNome];
            const url = `https://www.ojogodobicho.com/${slug}.htm`;

            try {
                log.info('SCRAPER', `Extraindo signo: ${signoNome}...`);
                await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
                const html = await page.content();
                const $ = cheerio.load(html);

                let texto = "";
                $('p').each((i, el) => {
                    const t = $(el).text().trim();
                    // Join the first few significant paragraphs to form a meaningful "frase do dia"
                    if (t.length > 30 && !t.includes('http') && texto.length < 300) {
                        texto += (texto ? " " : "") + t;
                    }
                });

                const numeros: number[] = [];
                // Look for "Números da sorte para hoje"
                const luckyHeader = $('h4').filter((i, el) => $(el).text().includes('Números da sorte para hoje'));
                if (luckyHeader.length) {
                    luckyHeader.nextAll('ul.inline-list').each((i, el) => {
                        $(el).find('li').each((j, li) => {
                            const valText = $(li).text().trim();
                            if (valText) {
                                const val = parseInt(valText, 10);
                                if (!isNaN(val) && !numeros.includes(val)) {
                                    numeros.push(val);
                                }
                            }
                        });
                    });
                }

                if (texto || numeros.length > 0) {
                    signosResults.push({
                        signo: signoNome,
                        texto: texto || 'Sorte no dia de hoje.',
                        numeros: numeros.slice(0, 10) // Limit to avoid noise
                    });
                }
            } catch (pageErr) {
                log.error('SCRAPER', `Falha ao extrair página do signo ${signoNome}`, pageErr);
            }
        }

        if (signosResults.length === 0) throw new Error("A extração do Horóscopo retornou 0 signos.");

        log.success('SCRAPER', `Horóscopo extraído com sucesso: ${signosResults.length}/12 signos.`);
        return signosResults;

    } catch (err: any) {
        log.error('SCRAPER', 'fetchHoroscopo falhou (Multi-page)', err);
        return [];
    } finally {
        if (browser) await browser.close();
    }
}

/**
 * Saves cotações to the database.
 */
export function saveCotacoes(cotacoes: { modalidade: string; valor: string }[]): void {
    const db = getDb();
    for (const c of cotacoes) {
        db.run(
            `INSERT INTO cotacoes (id, modalidade, valor, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(modalidade) DO UPDATE SET valor = ?, updated_at = datetime('now')`,
            [crypto.randomUUID(), c.modalidade, c.valor, c.valor]
        );
    }

    // Update Scraping Status
    db.run(
        `INSERT INTO scraping_status (id, loterica_slug, data, horario, status, updated_at)
         VALUES (?, 'cotacoes', ?, '07:00', 'success', datetime('now'))
         ON CONFLICT(loterica_slug, data, horario) DO UPDATE SET status = 'success', updated_at = datetime('now')`,
        [crypto.randomUUID(), todayStr()]
    );

    saveDatabase();
}

/**
 * Get palpites for a given date.
 */
export function getPalpitesDia(data: string): any {
    const db = getDb();
    const palpRows = db.exec("SELECT id FROM palpites_dia WHERE data = ?", [data]);
    if (!palpRows.length || !palpRows[0].values.length) return null;

    const palpiteId = palpRows[0].values[0][0] as string;

    const gruposRows = db.exec("SELECT bicho, grupo, dezenas FROM palpites_grupos WHERE palpite_id = ?", [palpiteId]);
    const milharesRows = db.exec("SELECT numero FROM palpites_milhares WHERE palpite_id = ?", [palpiteId]);
    const centenasRows = db.exec("SELECT numero FROM palpites_centenas WHERE palpite_id = ?", [palpiteId]);

    return {
        data,
        grupos: gruposRows.length ? gruposRows[0].values.map((r: any) => ({ bicho: r[0], grupo: r[1], dezenas: r[2] })) : [],
        milhares: milharesRows.length ? milharesRows[0].values.map((r: any) => r[0]) : [],
        centenas: centenasRows.length ? centenasRows[0].values.map((r: any) => r[0]) : [],
    };
}

/**
 * Get premiados by date.
 */
export function getPremiadosDia(data?: string): any[] {
    const db = getDb();
    let query = 'SELECT id, palpite_id, tipo, numero, extracao, premio, data, created_at FROM palpites_premiados';
    const params: any[] = [];
    if (data) { query += ' WHERE data = ?'; params.push(data); }
    query += ' ORDER BY created_at DESC';

    const rows = db.exec(query, params);
    if (!rows.length) return [];
    return rows[0].values.map((r: any) => ({
        id: r[0], palpite_id: r[1], tipo: r[2], numero: r[3],
        extracao: r[4], premio: r[5], data: r[6], created_at: r[7]
    }));
}

/**
 * Get a single premiado by ID.
 */
export function getPremiadoById(id: string): any | null {
    const db = getDb();
    const rows = db.exec(
        'SELECT id, palpite_id, tipo, numero, extracao, premio, data, created_at FROM palpites_premiados WHERE id = ?',
        [id]
    );
    if (!rows.length || !rows[0].values.length) return null;
    const r = rows[0].values[0];
    return {
        id: r[0], palpite_id: r[1], tipo: r[2], numero: r[3],
        extracao: r[4], premio: r[5], data: r[6], created_at: r[7]
    };
}
