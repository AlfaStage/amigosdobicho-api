import db from '../db.js';
import { logger } from '../utils/logger.js';
import crypto from 'crypto';
import axios from 'axios';
import net from 'net';

export interface ProxyEntry {
    id: string;
    protocol: string;
    host: string;
    port: number;
    username?: string;
    password?: string;
    label?: string;
    source: string;
    country?: string;
    enabled: boolean;
    alive: boolean;
    latency_ms?: number;
    score: number;
    last_tested_at?: string;
    last_used_at?: string;
    last_error?: string;
    success_count: number;
    error_count: number;
    created_at: string;
}

interface RawProxy {
    protocol: string;
    host: string;
    port: number;
    username?: string;
    password?: string;
    source: string;
    country?: string;
}

// Protocol map for 911Proxy
const PROTOCOL_MAP_911: Record<number, string> = { 1: 'https', 2: 'http', 4: 'socks4', 5: 'socks5' };

export class ProxyService {
    private serviceName = 'ProxyService';
    private lastUsedIndex = -1;
    private blacklist = new Set<string>(); // IPs temporariamente blacklistados
    private testInterval: ReturnType<typeof setInterval> | null = null;
    private collectionInterval: ReturnType<typeof setInterval> | null = null;
    private isCollecting = false;
    private isTesting = false;
    private lastCollectedAt: string | null = null;
    private lastTestedAt: string | null = null;

    // ==========================================
    // COLLECTION: Multi-source proxy fetching
    // ==========================================

    /** Collect from all sources in parallel */
    async collectFromAllSources(): Promise<{ total: number; added: number; sources: Record<string, number> }> {
        if (this.isCollecting) {
            logger.warn(this.serviceName, 'Collection already in progress, skipping...');
            return { total: 0, added: 0, sources: {} };
        }

        this.isCollecting = true;
        const sources: Record<string, number> = {};
        let totalAdded = 0;
        let totalFound = 0;

        try {
            logger.info(this.serviceName, '🔄 Coletando proxies de todas as fontes...');

            const results = await Promise.allSettled([
                this.fetchProxyScrape(),
                this.fetchGeonode(),
                this.fetch911Proxy(),
                this.fetchBrightData(),
            ]);

            for (const result of results) {
                if (result.status === 'fulfilled' && result.value.length > 0) {
                    const proxies = result.value;
                    const sourceName = proxies[0]?.source || 'unknown';
                    let addedFromSource = 0;

                    for (const proxy of proxies) {
                        totalFound++;
                        if (this.upsertProxy(proxy)) addedFromSource++;
                    }

                    sources[sourceName] = addedFromSource;
                    totalAdded += addedFromSource;
                    logger.info(this.serviceName, `  ✅ ${sourceName}: ${proxies.length} encontrados, ${addedFromSource} novos`);
                } else if (result.status === 'rejected') {
                    logger.warn(this.serviceName, `  ❌ Fonte falhou: ${result.reason?.message || result.reason}`);
                }
            }

            this.lastCollectedAt = new Date().toISOString();
            logger.success(this.serviceName, `📦 Coleta finalizada: ${totalFound} encontrados, ${totalAdded} adicionados/atualizados`);
        } catch (err: any) {
            logger.error(this.serviceName, 'Erro na coleta:', err.message);
        } finally {
            this.isCollecting = false;
        }

        return { total: totalFound, added: totalAdded, sources };
    }

    /** ProxyScrape */
    private async fetchProxyScrape(): Promise<RawProxy[]> {
        try {
            const { data } = await axios.get(
                'https://api.proxyscrape.com/v4/free-proxy-list/get?request=display_proxies&country=br&proxy_format=protocolipport&format=json&timeout=20000&limit=50',
                { timeout: 15000 }
            );
            if (!data?.proxies) return [];

            return data.proxies.map((p: any) => {
                const match = p.proxy?.match(/^(https?|socks[45]?):\/\/([^:]+):(\d+)$/);
                if (!match) return null;
                return {
                    protocol: match[1],
                    host: match[2],
                    port: parseInt(match[3]),
                    source: 'ProxyScrape',
                    country: 'BR',
                };
            }).filter(Boolean) as RawProxy[];
        } catch (err: any) {
            logger.warn(this.serviceName, `ProxyScrape falhou: ${err.message}`);
            return [];
        }
    }

    /** Geonode */
    private async fetchGeonode(): Promise<RawProxy[]> {
        try {
            const { data } = await axios.get(
                'https://proxylist.geonode.com/api/proxy-list?country=BR&filterUpTime=90&filterLastChecked=30&speed=fast&limit=50&page=1&sort_by=lastChecked&sort_type=desc',
                { timeout: 15000 }
            );
            if (!data?.data) return [];

            return data.data.map((p: any) => {
                const protocol = p.protocols?.[0] || 'http';
                return {
                    protocol,
                    host: p.ip,
                    port: parseInt(p.port),
                    source: 'Geonode',
                    country: 'BR',
                };
            }).filter((p: RawProxy) => p.host && p.port);
        } catch (err: any) {
            logger.warn(this.serviceName, `Geonode falhou: ${err.message}`);
            return [];
        }
    }

    /** 911Proxy */
    private async fetch911Proxy(): Promise<RawProxy[]> {
        try {
            const { data } = await axios.get(
                'https://www.911proxy.com/web_v1/free-proxy/list?page_size=60&page=1&country_code=BR',
                { timeout: 15000 }
            );
            if (data?.code !== 200 || !data?.data?.list) return [];

            return data.data.list
                .filter((p: any) => p.status === 1)
                .map((p: any) => ({
                    protocol: PROTOCOL_MAP_911[p.protocol] || 'http',
                    host: p.ip,
                    port: parseInt(p.port),
                    source: '911Proxy',
                    country: 'BR',
                }))
                .filter((p: RawProxy) => p.host && p.port);
        } catch (err: any) {
            logger.warn(this.serviceName, `911Proxy falhou: ${err.message}`);
            return [];
        }
    }

    /** Bright Data (Paid - from env vars) */
    private async fetchBrightData(): Promise<RawProxy[]> {
        const brightHost = process.env.BRIGHT_DATA_HOST;
        const brightPort = process.env.BRIGHT_DATA_PORT;
        const brightUser = process.env.BRIGHT_DATA_USER;
        const brightPass = process.env.BRIGHT_DATA_PASS;

        if (!brightHost || !brightPort) return [];

        return [{
            protocol: 'http',
            host: brightHost,
            port: parseInt(brightPort),
            username: brightUser,
            password: brightPass,
            source: 'BrightData',
            country: 'BR',
        }];
    }

    // ==========================================
    // DATABASE OPERATIONS
    // ==========================================

    /** Upsert a proxy into the database */
    private upsertProxy(raw: RawProxy): boolean {
        const existing = db.prepare('SELECT id FROM proxies WHERE host = ? AND port = ?').get(raw.host, raw.port) as any;

        if (existing) {
            // Update source and protocol if changed
            db.prepare('UPDATE proxies SET source = ?, protocol = ?, country = ? WHERE id = ?')
                .run(raw.source, raw.protocol, raw.country || null, existing.id);
            return false;
        }

        const id = crypto.randomUUID();
        db.prepare(
            'INSERT INTO proxies (id, protocol, host, port, username, password, source, country, score) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(id, raw.protocol, raw.host, raw.port, raw.username || null, raw.password || null, raw.source, raw.country || null, 50);
        return true;
    }

    /** List all proxies */
    listAll(): ProxyEntry[] {
        return db.prepare('SELECT * FROM proxies ORDER BY score DESC, alive DESC, error_count ASC').all() as ProxyEntry[];
    }

    /** List alive & enabled proxies */
    listAlive(): ProxyEntry[] {
        return db.prepare('SELECT * FROM proxies WHERE enabled = 1 AND alive = 1 ORDER BY score DESC').all() as ProxyEntry[];
    }

    /** Get stats */
    getStats(): {
        total: number; alive: number; dead: number; enabled: number;
        total_success: number; total_errors: number; blacklisted: number;
        lastCollectedAt: string | null; lastTestedAt: string | null;
        bySource: Record<string, number>; byProtocol: Record<string, number>;
    } {
        const total = (db.prepare('SELECT COUNT(*) as c FROM proxies').get() as any).c;
        const alive = (db.prepare('SELECT COUNT(*) as c FROM proxies WHERE alive = 1').get() as any).c;
        const enabled = (db.prepare('SELECT COUNT(*) as c FROM proxies WHERE enabled = 1').get() as any).c;
        const sums = db.prepare('SELECT COALESCE(SUM(success_count), 0) as s, COALESCE(SUM(error_count), 0) as e FROM proxies').get() as any;

        const bySourceRows = db.prepare('SELECT source, COUNT(*) as c FROM proxies GROUP BY source').all() as any[];
        const bySource: Record<string, number> = {};
        for (const r of bySourceRows) bySource[r.source] = r.c;

        const byProtocolRows = db.prepare('SELECT protocol, COUNT(*) as c FROM proxies GROUP BY protocol').all() as any[];
        const byProtocol: Record<string, number> = {};
        for (const r of byProtocolRows) byProtocol[r.protocol] = r.c;

        return {
            total, alive, dead: total - alive, enabled,
            total_success: sums.s, total_errors: sums.e,
            blacklisted: this.blacklist.size,
            lastCollectedAt: this.lastCollectedAt,
            lastTestedAt: this.lastTestedAt,
            bySource, byProtocol,
        };
    }

    // ==========================================
    // PROXY SELECTION (FALLBACK ONLY)
    // ==========================================

    /** Get next alive proxy via round-robin (skipping blacklisted) */
    getNextProxy(): ProxyEntry | null {
        const proxies = this.listAlive().filter(p => !this.blacklist.has(`${p.host}:${p.port}`));
        if (proxies.length === 0) return null;

        this.lastUsedIndex = (this.lastUsedIndex + 1) % proxies.length;
        const proxy = proxies[this.lastUsedIndex];

        db.prepare('UPDATE proxies SET last_used_at = datetime(\'now\') WHERE id = ?').run(proxy.id);
        return proxy;
    }

    /** Build axios proxy config */
    buildAxiosProxy(proxy: ProxyEntry): { host: string; port: number; protocol: string; auth?: { username: string; password: string } } {
        const config: any = { host: proxy.host, port: proxy.port, protocol: proxy.protocol };
        if (proxy.username && proxy.password) {
            config.auth = { username: proxy.username, password: proxy.password };
        }
        return config;
    }

    /** Record success */
    recordSuccess(id: string): void {
        db.prepare('UPDATE proxies SET success_count = success_count + 1, last_error = NULL, score = MIN(score + 2, 100) WHERE id = ?').run(id);
        // Remove from blacklist on success
        const proxy = db.prepare('SELECT host, port FROM proxies WHERE id = ?').get(id) as any;
        if (proxy) this.blacklist.delete(`${proxy.host}:${proxy.port}`);
    }

    /** Record error and blacklist */
    recordError(id: string, error: string): void {
        db.prepare('UPDATE proxies SET error_count = error_count + 1, last_error = ?, score = MAX(score - 5, 0) WHERE id = ?').run(error.substring(0, 200), id);
        const proxy = db.prepare('SELECT host, port FROM proxies WHERE id = ?').get(id) as any;
        if (proxy) this.blacklist.add(`${proxy.host}:${proxy.port}`);
    }

    // ==========================================
    // VALIDATION: TCP Connection Testing
    // ==========================================

    /** Test a single proxy via TCP socket */
    private testProxyTCP(host: string, port: number, timeoutMs: number = 2000): Promise<{ alive: boolean; latency: number }> {
        return new Promise(resolve => {
            const start = Date.now();
            const socket = new net.Socket();

            socket.setTimeout(timeoutMs);

            socket.on('connect', () => {
                const latency = Date.now() - start;
                socket.destroy();
                resolve({ alive: true, latency });
            });

            socket.on('timeout', () => {
                socket.destroy();
                resolve({ alive: false, latency: timeoutMs });
            });

            socket.on('error', () => {
                socket.destroy();
                resolve({ alive: false, latency: Date.now() - start });
            });

            socket.connect(port, host);
        });
    }

    /** Test all proxies and update their status */
    async testAllProxies(): Promise<{ tested: number; alive: number; dead: number }> {
        if (this.isTesting) {
            logger.warn(this.serviceName, 'Tests already in progress, skipping...');
            return { tested: 0, alive: 0, dead: 0 };
        }

        this.isTesting = true;
        let aliveCount = 0;
        let deadCount = 0;

        try {
            const proxies = db.prepare('SELECT * FROM proxies WHERE enabled = 1').all() as ProxyEntry[];
            if (proxies.length === 0) {
                this.isTesting = false;
                return { tested: 0, alive: 0, dead: 0 };
            }

            logger.info(this.serviceName, `🧪 Testando ${proxies.length} proxies...`);

            // Test in batches of 10 to avoid overwhelming
            const batchSize = 10;
            for (let i = 0; i < proxies.length; i += batchSize) {
                const batch = proxies.slice(i, i + batchSize);
                const results = await Promise.all(
                    batch.map(async p => {
                        const result = await this.testProxyTCP(p.host, p.port);
                        return { proxy: p, ...result };
                    })
                );

                for (const { proxy, alive, latency } of results) {
                    db.prepare(
                        'UPDATE proxies SET alive = ?, latency_ms = ?, last_tested_at = datetime(\'now\'), score = ? WHERE id = ?'
                    ).run(
                        alive ? 1 : 0,
                        latency,
                        alive ? Math.min((proxy.score || 50) + 1, 100) : Math.max((proxy.score || 50) - 10, 0),
                        proxy.id
                    );

                    if (alive) {
                        aliveCount++;
                        this.blacklist.delete(`${proxy.host}:${proxy.port}`);
                    } else {
                        deadCount++;
                    }
                }
            }

            this.lastTestedAt = new Date().toISOString();
            logger.success(this.serviceName, `🧪 Teste finalizado: ${aliveCount} vivos, ${deadCount} mortos de ${proxies.length}`);
        } catch (err: any) {
            logger.error(this.serviceName, 'Erro nos testes:', err.message);
        } finally {
            this.isTesting = false;
        }

        return { tested: aliveCount + deadCount, alive: aliveCount, dead: deadCount };
    }

    // ==========================================
    // MANUAL OPERATIONS
    // ==========================================

    /** Add proxies from text (bulk) */
    bulkAdd(text: string): { added: number; skipped: number; errors: string[] } {
        const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('#'));
        let added = 0;
        let skipped = 0;
        const errors: string[] = [];

        for (const line of lines) {
            const parsed = this.parseLine(line);
            if (!parsed) {
                errors.push(`Formato inválido: ${line}`);
                continue;
            }

            const existing = db.prepare('SELECT id FROM proxies WHERE host = ? AND port = ?').get(parsed.host, parsed.port);
            if (existing) {
                skipped++;
                continue;
            }

            const id = crypto.randomUUID();
            try {
                db.prepare(
                    'INSERT INTO proxies (id, protocol, host, port, username, password, source, label, score) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
                ).run(id, parsed.protocol, parsed.host, parsed.port, parsed.username || null, parsed.password || null, 'Manual', parsed.label || null, 50);
                added++;
            } catch (e: any) {
                if (e.message?.includes('UNIQUE')) skipped++;
                else errors.push(`Erro: ${line} - ${e.message}`);
            }
        }

        return { added, skipped, errors };
    }

    /** Parse a proxy line */
    private parseLine(line: string): RawProxy & { label?: string } | null {
        // protocol://user:pass@host:port
        const full = line.match(/^(https?|socks[45]?):\/\/(?:([^:]+):([^@]+)@)?([^:]+):(\d+)$/);
        if (full) return { protocol: full[1], username: full[2], password: full[3], host: full[4], port: parseInt(full[5]), source: 'Manual' };

        // host:port:user:pass
        const colon = line.match(/^([^:]+):(\d+):([^:]+):(.+)$/);
        if (colon) return { protocol: 'http', host: colon[1], port: parseInt(colon[2]), username: colon[3], password: colon[4], source: 'Manual' };

        // host:port
        const simple = line.match(/^([^:]+):(\d+)$/);
        if (simple) return { protocol: 'http', host: simple[1], port: parseInt(simple[2]), source: 'Manual' };

        return null;
    }

    /** Remove a proxy */
    remove(id: string): boolean {
        return db.prepare('DELETE FROM proxies WHERE id = ?').run(id).changes > 0;
    }

    /** Remove all dead proxies */
    removeAllDead(): number {
        return db.prepare('DELETE FROM proxies WHERE alive = 0 AND source != ?').run('BrightData').changes;
    }

    /** Toggle enabled/disabled */
    toggle(id: string): ProxyEntry | null {
        const proxy = db.prepare('SELECT * FROM proxies WHERE id = ?').get(id) as ProxyEntry | undefined;
        if (!proxy) return null;
        db.prepare('UPDATE proxies SET enabled = ? WHERE id = ?').run(proxy.enabled ? 0 : 1, id);
        return db.prepare('SELECT * FROM proxies WHERE id = ?').get(id) as ProxyEntry;
    }

    /** Reset stats */
    resetStats(): void {
        db.prepare('UPDATE proxies SET success_count = 0, error_count = 0, last_error = NULL, score = 50').run();
        this.blacklist.clear();
    }

    /** Clear blacklist */
    clearBlacklist(): void {
        this.blacklist.clear();
    }

    // ==========================================
    // SCHEDULER: Auto-collection + testing
    // ==========================================

    /** Start auto-collection (hourly) */
    startScheduler(): void {
        // Collect every 30 minutes
        this.collectionInterval = setInterval(() => {
            this.collectFromAllSources().catch(err =>
                logger.error(this.serviceName, 'Auto-collection error:', err)
            );
        }, 30 * 60 * 1000);

        // REMOVED manual testing per minute to save resources
        // Testing will be triggered on-demand by scrapers when needed

        logger.info(this.serviceName, '⏰ Scheduler iniciado: coleta a cada 30min (testes sob demanda)');

        // Initial collection after 5 seconds
        setTimeout(() => {
            this.collectFromAllSources().catch(err => logger.error(this.serviceName, 'Initial proxy setup error:', err));
        }, 5000);
    }

    /** Stop scheduler */
    stopScheduler(): void {
        if (this.collectionInterval) clearInterval(this.collectionInterval);
        if (this.testInterval) clearInterval(this.testInterval);
        this.collectionInterval = null;
        this.testInterval = null;
        logger.info(this.serviceName, '⏹️ Scheduler parado');
    }
}

// Singleton
export const proxyService = new ProxyService();
