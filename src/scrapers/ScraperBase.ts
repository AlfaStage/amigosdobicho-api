import axios from 'axios';
import * as cheerio from 'cheerio';
import { LotericaConfig } from '../config/loterias.js';
import { logger } from '../utils/logger.js';
import { getBrowserScraper } from './BrowserScraper.js';
import { proxyService } from '../services/ProxyService.js';

// Removed Prisma types

export abstract class ScraperBase {
    protected baseUrl: string;
    protected serviceName = 'ScraperBase';
    protected failureCount = 0;
    protected useBrowserFallback = false;
    protected lastErrorDetail: string | null = null;
    private readonly MAX_FAILURES_BEFORE_BROWSER = 5;

    // 5 User-Agents para rotação
    private userAgents = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    ];

    constructor(baseUrl: string) {
        this.baseUrl = baseUrl;
    }

    // Retorna um User-Agent aleatório
    protected getRandomUserAgent(): string {
        return this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
    }

    // Delay aleatório entre min e max ms
    protected async randomDelay(minMs: number = 1500, maxMs: number = 5000): Promise<void> {
        const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
        await new Promise(resolve => setTimeout(resolve, delay));
    }

    // Fetch com retry + proxy como FALLBACK (só após falha sem proxy)
    protected async fetchHtmlWithRetry(
        url: string = this.baseUrl,
        customHeaders: Record<string, string> = {},
        silentCodes: number[] = [403, 404],
        maxRetries: number = Infinity
    ): Promise<cheerio.CheerioAPI | null> {
        // Se já atingiu o limite de falhas, usar browser fallback
        if (this.useBrowserFallback) {
            logger.info(this.serviceName, `Usando browser fallback para ${url}`);
            const $ = await this.fetchWithBrowser(url);
            if (!$) {
                this.lastErrorDetail = 'Browser fallback falhou em carregar a página';
            }
            return $;
        }

        this.lastErrorDetail = null;

        let attempt = 0;
        let useProxy = false; // Starts without proxy

        while (true) {
            const axiosConfig: any = {
                headers: {
                    'User-Agent': this.getRandomUserAgent(),
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                    'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Connection': 'keep-alive',
                    'Upgrade-Insecure-Requests': '1',
                    ...customHeaders
                },
                timeout: 30000,
            };

            // Only use proxy after first failure in this request cycle
            const proxy = useProxy ? proxyService.getNextProxy() : null;
            if (proxy) {
                axiosConfig.proxy = proxyService.buildAxiosProxy(proxy);
            }

            try {
                await this.randomDelay(1500, 5000);

                const { data } = await axios.get(url, axiosConfig);

                this.failureCount = 0;
                this.useBrowserFallback = false;

                if (proxy) proxyService.recordSuccess(proxy.id);

                return cheerio.load(data);
            } catch (error: any) {
                attempt++;
                this.failureCount++;
                const status = error.response?.status;

                if (proxy) proxyService.recordError(proxy.id, `${status || 'timeout'}: ${error.message?.substring(0, 100)}`);

                if (status && silentCodes.includes(status)) {
                    this.lastErrorDetail = `HTTP ${status}: Acesso negado ou página não encontrada (Bloqueio?)`;

                    // Se for 403 e ainda não estivermos usando browser fallback, tentar ativar
                    if (status === 403 && !this.useBrowserFallback) {
                        logger.warn(this.serviceName, `Bloqueio 403 detectado em ${url}. Ativando browser fallback...`);
                        this.useBrowserFallback = true;
                        return await this.fetchWithBrowser(url);
                    }

                    this.failureCount = 0;
                    return null;
                }

                if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
                    this.lastErrorDetail = 'Tempo de conexão esgotado (timeout)';
                } else if (status) {
                    this.lastErrorDetail = `Erro HTTP ${status}: ${error.message}`;
                } else {
                    this.lastErrorDetail = error.message || 'Erro de conexão desconhecido';
                }

                // After FIRST failure, enable proxy usage for subsequent retries
                if (!useProxy && attempt >= 1) {
                    let aliveProxies = proxyService.listAlive();

                    // Se não houver nenhum proxy marcado como vivo, forçar um teste rápido antes de usar
                    if (aliveProxies.length === 0) {
                        logger.info(this.serviceName, 'Ativando proxies pela primeira vez. Testando disponibilidade...');
                        await proxyService.testAllProxies();
                        aliveProxies = proxyService.listAlive();
                    }

                    if (aliveProxies.length > 0) {
                        useProxy = true;
                        logger.info(this.serviceName, `Falha sem proxy. Usando ${aliveProxies.length} proxies para retry...`);
                    }
                }

                // Após 5 falhas consecutivas, ativar browser fallback
                if (this.failureCount >= this.MAX_FAILURES_BEFORE_BROWSER) {
                    logger.warn(this.serviceName, `${this.failureCount} falhas consecutivas. Ativando browser fallback...`);
                    this.useBrowserFallback = true;
                    return await this.fetchWithBrowser(url);
                }

                const backoffMs = Math.min(Math.pow(2, attempt) * 1000, 60000);

                logger.warn(this.serviceName, `Tentativa ${attempt} falhou para ${url}. Status: ${status || 'timeout'}${proxy ? ` (proxy ${proxy.host}:${proxy.port})` : ' (sem proxy)'}. Retry em ${backoffMs / 1000}s...`);

                await new Promise(resolve => setTimeout(resolve, backoffMs));
            }
        }
    }

    private async fetchWithBrowser(url: string): Promise<cheerio.CheerioAPI | null> {
        try {
            const browserScraper = getBrowserScraper();
            const $ = await browserScraper.scrapeWithNavigation(url);

            if ($) {
                // Reset contador de falhas em caso de sucesso
                this.failureCount = 0;
                this.useBrowserFallback = false;
                logger.success(this.serviceName, `Browser fallback funcionou para ${url}`);
            }

            return $;
        } catch (error) {
            logger.error(this.serviceName, 'Browser fallback falhou:', error);
            return null;
        }
    }

    // Reset do contador de falhas (pode ser chamado externamente)
    public resetFailureCount(): void {
        this.failureCount = 0;
        this.useBrowserFallback = false;
        this.lastErrorDetail = null;
    }

    public getLastError(): string | null {
        return this.lastErrorDetail;
    }

    abstract execute(targets?: LotericaConfig[], targetSlug?: string, shouldNotify?: boolean): Promise<void>;
}
