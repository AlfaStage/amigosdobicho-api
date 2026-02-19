import puppeteer, { Browser, Page } from 'puppeteer';
import * as cheerio from 'cheerio';
import { logger } from '../utils/logger.js';

export interface NavigationStep {
    selector: string;
    action: 'click' | 'wait' | 'scroll';
    delay?: number;
}

export interface SiteNavigationConfig {
    homeUrl: string;
    steps: NavigationStep[];
}

// Configurações de navegação para cada site
export const SITE_NAVIGATIONS: Record<string, SiteNavigationConfig> = {
    'resultadofacil.com.br': {
        homeUrl: 'https://www.resultadofacil.com.br',
        steps: [
            { selector: 'body', action: 'wait', delay: 3000 },
            { selector: '.navbar a, .menu a, a[href*="resultado"]', action: 'click', delay: 2000 },
            { selector: 'body', action: 'scroll', delay: 1500 },
            { selector: 'body', action: 'wait', delay: 3000 },
        ]
    },
    'resultadofacil.com.br/palpites-do-dia': {
        homeUrl: 'https://www.resultadofacil.com.br',
        steps: [
            { selector: 'body', action: 'wait', delay: 3000 },
            { selector: 'a[href*="palpites-do-dia"]', action: 'click', delay: 3000 },
            { selector: 'body', action: 'scroll', delay: 1500 },
        ]
    },
    'gigabicho.com.br': {
        homeUrl: 'https://www.gigabicho.com.br',
        steps: [
            { selector: 'body', action: 'wait', delay: 2000 },
            { selector: 'nav a, .menu a, a[href*="resultado"]', action: 'click', delay: 2000 },
            { selector: 'body', action: 'scroll', delay: 1500 },
            { selector: 'body', action: 'wait', delay: 2000 },
        ]
    },
    'ojogodobicho.com': {
        homeUrl: 'https://www.ojogodobicho.com',
        steps: [
            { selector: 'body', action: 'wait', delay: 2000 },
            { selector: '#menu a, nav a, a[href*="resultado"]', action: 'click', delay: 2000 },
            { selector: 'body', action: 'scroll', delay: 1500 },
            { selector: 'body', action: 'wait', delay: 2000 },
        ]
    },
    'amigosdobicho.com/cotacoes': {
        homeUrl: 'https://amigosdobicho.com/cotacoes',
        steps: [
            { selector: 'button', action: 'click', delay: 2000 }, // Botão JOGO DO BICHO
            { selector: 'body', action: 'scroll', delay: 1500 },
            { selector: 'body', action: 'wait', delay: 1000 },
        ]
    }
};

export class BrowserScraper {
    private serviceName = 'BrowserScraper';
    private browser: Browser | null = null;

    async init(): Promise<void> {
        if (!this.browser) {
            this.browser = await puppeteer.launch({
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--disable-gpu',
                    '--window-size=1920,1080'
                ],
                executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined
            });
            logger.info(this.serviceName, `Browser iniciado (Executable: ${process.env.PUPPETEER_EXECUTABLE_PATH || 'bundled'})`);
        }
    }

    async close(): Promise<void> {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
            logger.info(this.serviceName, 'Browser fechado');
        }
    }

    async scrapeWithNavigation(
        targetUrl: string,
        customConfig?: SiteNavigationConfig
    ): Promise<cheerio.CheerioAPI | null> {
        await this.init();

        const urlObj = new URL(targetUrl);
        const fullKey = urlObj.hostname.replace('www.', '') + urlObj.pathname;
        const hostKey = urlObj.hostname.replace('www.', '');

        // Tentar encontrar o match mais específico primeiro (path) e depois o hostname
        const configKey = Object.keys(SITE_NAVIGATIONS)
            .sort((a, b) => b.length - a.length) // Chaves mais longas primeiro
            .find(k => fullKey.includes(k) || hostKey === k);

        const config = customConfig || (configKey ? SITE_NAVIGATIONS[configKey] : null);

        if (!config) {
            logger.warn(this.serviceName, `Nenhuma configuração de navegação encontrada para ${fullKey}`);
            return null;
        }

        let page: Page | null = null;

        try {
            page = await this.browser!.newPage();

            // Configurar viewport e user agent realista
            await page.setViewport({ width: 1920, height: 1080 });
            await page.setUserAgent(
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            );

            // Configurar headers extras
            await page.setExtraHTTPHeaders({
                'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            });

            logger.info(this.serviceName, `Navegando para home: ${config.homeUrl}`);

            // Ir para a home primeiro
            await page.goto(config.homeUrl, {
                waitUntil: 'networkidle2',
                timeout: 60000
            });

            // Executar passos de navegação
            for (let i = 0; i < config.steps.length; i++) {
                const step = config.steps[i];
                logger.info(this.serviceName, `Executando passo ${i + 1}: ${step.action} em ${step.selector}`);

                try {
                    if (step.action === 'wait') {
                        await page.waitForSelector(step.selector, { timeout: 10000 });
                        await this.delay(step.delay || 2000);
                    } else if (step.action === 'click') {
                        // Tentar múltiplos seletores se o primeiro falhar
                        const selectors = step.selector.split(',').map(s => s.trim());
                        let clicked = false;

                        for (const selector of selectors) {
                            try {
                                await page.waitForSelector(selector, { timeout: 5000 });
                                await page.click(selector);
                                clicked = true;
                                logger.info(this.serviceName, `Clique realizado em: ${selector}`);
                                break;
                            } catch (e) {
                                continue;
                            }
                        }

                        if (!clicked) {
                            logger.warn(this.serviceName, `Não foi possível clicar em nenhum dos seletores: ${selectors.join(', ')}`);
                        }

                        await this.delay(step.delay || 2000);
                    } else if (step.action === 'scroll') {
                        await page.evaluate(() => {
                            (globalThis as any).scrollBy(0, (globalThis as any).innerHeight);
                        });
                        await this.delay(step.delay || 1000);
                    }
                } catch (stepError) {
                    logger.warn(this.serviceName, `Erro no passo ${i + 1}:`, stepError);
                    // Continuar para o próximo passo
                }
            }

            // Se tivermos uma URL alvo específica, navegar para ela
            if (targetUrl !== config.homeUrl) {
                logger.info(this.serviceName, `Navegando para URL alvo: ${targetUrl}`);
                await page.goto(targetUrl, {
                    waitUntil: 'networkidle2',
                    timeout: 60000
                });
                await this.delay(3000);
            }

            // Extrair HTML
            const html = await page.content();
            logger.success(this.serviceName, `Página carregada com sucesso via navegador`);

            return cheerio.load(html);

        } catch (error) {
            logger.error(this.serviceName, 'Erro durante navegação:', error);
            return null;
        } finally {
            if (page) {
                await page.close();
            }
        }
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }


}

// Singleton para reutilizar o browser
let browserScraperInstance: BrowserScraper | null = null;

export function getBrowserScraper(): BrowserScraper {
    if (!browserScraperInstance) {
        browserScraperInstance = new BrowserScraper();
    }
    return browserScraperInstance;
}
