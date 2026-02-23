import axios from 'axios';
import { getDb, saveDatabase } from '../database/schema.js';
import { log } from '../utils/Logger.js';

interface ProxyEntry {
    host: string;
    port: string;
    protocol: string;
    username?: string;
    password?: string;
    source: string;
}

const PROXY_SOURCES = {
    proxyscrape: 'https://api.proxyscrape.com/v4/free-proxy-list/get?request=display_proxies&country=br&proxy_format=protocolipport&format=json&timeout=20000&limit=50',
    geonode: 'https://proxylist.geonode.com/api/proxy-list?country=BR&filterUpTime=90&filterLastChecked=30&speed=fast&limit=50&page=1&sort_by=lastChecked&sort_type=desc',
    '911proxy': 'https://www.911proxy.com/web_v1/free-proxy/list?page_size=60&page=1&country_code=BR',
};

const PROTOCOL_MAP_911: Record<number, string> = { 1: 'https', 2: 'http', 4: 'socks4', 5: 'socks5' };
const TEST_URL = 'https://httpbin.org/ip';

/**
 * Fetches proxies from all 3 external APIs.
 */
async function fetchFromApis(): Promise<ProxyEntry[]> {
    const proxies: ProxyEntry[] = [];

    // ProxyScrape
    try {
        const res = await axios.get(PROXY_SOURCES.proxyscrape, { timeout: 15000 });
        const data = res.data?.proxies || [];
        for (const item of data) {
            const match = (item.proxy as string).match(/^(https?|socks[45]):\/\/([^:]+):(\d+)$/);
            if (match) {
                proxies.push({ host: match[2], port: match[3], protocol: match[1], source: 'proxyscrape' });
            }
        }
    } catch { log.warn('PROXY', 'ProxyScrape fetch falhou'); }

    // Geonode
    try {
        const res = await axios.get(PROXY_SOURCES.geonode, { timeout: 15000 });
        const data = res.data?.data || [];
        for (const item of data) {
            const protocol = (item.protocols as string[])?.[0] || 'http';
            proxies.push({ host: item.ip, port: String(item.port), protocol, source: 'geonode' });
        }
    } catch { log.warn('PROXY', 'Geonode fetch falhou'); }

    // 911Proxy
    try {
        const res = await axios.get(PROXY_SOURCES['911proxy'], { timeout: 15000 });
        const list = res.data?.data?.list || [];
        for (const item of list) {
            const protocol = PROTOCOL_MAP_911[item.protocol] || 'http';
            proxies.push({ host: item.ip, port: String(item.port), protocol, source: '911proxy' });
        }
    } catch { log.warn('PROXY', '911Proxy fetch falhou'); }

    return proxies;
}

/**
 * Tests a single proxy by making an HTTP request through it.
 */
async function testProxy(host: string, port: string, protocol: string, username?: string, password?: string): Promise<{ alive: boolean; latency: number }> {
    const start = Date.now();
    try {
        const proxyUrl = `${protocol}://${host}:${port}`;
        const axiosConfig: any = {
            timeout: 10000,
        };

        if (!protocol.startsWith('socks')) {
            axiosConfig.proxy = { host, port: parseInt(port, 10), protocol: protocol + ':' };
            if (username && password) {
                axiosConfig.proxy.auth = { username, password };
            }
        } else {
            // Basic socks proxy not fully supported by naked axios, but we leave structure if needed
        }

        await axios.get(TEST_URL, axiosConfig);
        return { alive: true, latency: Date.now() - start };
    } catch {
        return { alive: false, latency: Date.now() - start };
    }
}

/**
 * Full sweep: fetch from APIs, upsert new, test all, purge dead.
 */
export async function runProxySweep(): Promise<{ added: number; tested: number; purged: number }> {
    const db = getDb();
    log.info('PROXY', 'Iniciando sweep de proxies...');

    // 1. Fetch from APIs
    const fetched = await fetchFromApis();

    // 2. Upsert into DB
    let added = 0;
    for (const p of fetched) {
        try {
            db.run(
                `INSERT OR IGNORE INTO proxies (id, host, port, protocol, source, alive, score)
         VALUES (?, ?, ?, ?, ?, 1, 50)`,
                [crypto.randomUUID(), p.host, p.port, p.protocol, p.source]
            );
            added++;
        } catch { /* duplicate, ignore */ }
    }

    // 3. Test all existing
    const allRows = db.exec('SELECT id, host, port, protocol, username, password FROM proxies');
    const allProxies = allRows.length ? allRows[0].values : [];
    let tested = 0;
    let purged = 0;

    for (const row of allProxies) {
        const [id, host, port, protocol, username, password] = row as [string, string, string, string, string, string];
        const result = await testProxy(host, port, protocol, username, password);
        tested++;

        if (result.alive) {
            db.run(
                `UPDATE proxies SET alive = 1, latency_ms = ?, score = MIN(score + 5, 100),
         last_checked = datetime('now') WHERE id = ?`,
                [result.latency, id]
            );
        } else {
            // Delete dead proxies (purge policy)
            db.run('DELETE FROM proxies WHERE id = ?', [id]);
            purged++;
        }
    }

    saveDatabase();
    log.success('PROXY', 'Sweep concluído', { fetched: added, tested, purged });
    return { added, tested, purged };
}

/**
 * Get a working proxy for scraping (best score first).
 */
export function getBestProxy(): { host: string; port: string; protocol: string; username?: string; password?: string; } | null {
    const db = getDb();
    const rows = db.exec(
        'SELECT host, port, protocol, username, password FROM proxies WHERE alive = 1 ORDER BY score DESC, latency_ms ASC LIMIT 1'
    );
    if (!rows.length || !rows[0].values.length) return null;
    const [host, port, protocol, username, password] = rows[0].values[0] as [string, string, string, string, string];
    return { host, port, protocol, username, password };
}

/**
 * Get all proxies for admin display.
 */
export function getAllProxies(): any[] {
    const db = getDb();
    const rows = db.exec(
        'SELECT id, host, port, protocol, username, password, source, alive, latency_ms, score, last_checked, created_at FROM proxies ORDER BY score DESC'
    );
    if (!rows.length) return [];
    return rows[0].values.map((r: any) => ({
        id: r[0], host: r[1], port: r[2], protocol: r[3], username: r[4], password: r[5], source: r[6],
        alive: r[7], latency_ms: r[8], score: r[9], last_checked: r[10], created_at: r[11]
    }));
}

/**
 * Manually add a proxy.
 */
export function addManualProxy(host: string, port: string, protocol: string): boolean {
    const db = getDb();
    try {
        db.run(
            `INSERT INTO proxies (id, host, port, protocol, source, alive, score)
       VALUES (?, ?, ?, ?, 'manual', 1, 75)`,
            [crypto.randomUUID(), host, port, protocol]
        );
        saveDatabase();
        return true;
    } catch {
        return false;
    }
}

/**
 * Delete a proxy.
 */
export function deleteProxy(id: string): boolean {
    const db = getDb();
    db.run('DELETE FROM proxies WHERE id = ?', [id]);
    saveDatabase();
    return true;
}

/**
 * Processes a bulk text of proxies, tests them, and adds valid ones.
 */
export async function processBulkProxies(text: string): Promise<{ totalFound: number; added: number }> {
    const db = getDb();

    // Suporta: 192.168.0.1:8080 ou http://192.168.0.1:8080 ou 192.168.0.1:8080:user:pass (comum em listas premium)
    const proxyRegex = /(?:(https?|socks[45]):\/\/)?(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}):(\d+)(?::([^\s:]+):([^\s:]+))?/g;
    const foundProxies: ProxyEntry[] = [];
    let match;

    while ((match = proxyRegex.exec(text)) !== null) {
        const protocol = match[1] || 'http';
        const host = match[2];
        const port = match[3];
        const username = match[4];
        const password = match[5];

        if (!foundProxies.some(p => p.host === host && p.port === port)) {
            foundProxies.push({ host, port, protocol, username, password, source: 'manual' });
        }
    }

    if (foundProxies.length === 0) return { totalFound: 0, added: 0 };

    log.info('PROXY', `Testando ${foundProxies.length} proxies extraídos em lote...`);
    let added = 0;

    const BATCH_SIZE = 20;
    for (let i = 0; i < foundProxies.length; i += BATCH_SIZE) {
        const batch = foundProxies.slice(i, i + BATCH_SIZE);
        const testPromises = batch.map(async (p) => {
            const result = await testProxy(p.host, p.port, p.protocol, p.username, p.password);
            if (result.alive) {
                try {
                    db.run(
                        `INSERT INTO proxies (id, host, port, protocol, username, password, source, alive, score, latency_ms, last_checked)
                         VALUES (?, ?, ?, ?, ?, ?, 'manual', 1, 100, ?, datetime('now'))
                         ON CONFLICT(host, port) DO UPDATE SET 
                            alive = 1, latency_ms = ?, score = 100, last_checked = datetime('now'), username = ?, password = ?, source = 'manual'`,
                        [crypto.randomUUID(), p.host, p.port, p.protocol, p.username || null, p.password || null, result.latency, result.latency, p.username || null, p.password || null]
                    );
                    added++;
                } catch { /* ignorar erro de parse sql */ }
            }
        });
        await Promise.all(testPromises);
    }

    saveDatabase();
    log.success('PROXY', 'Bulk import concluído', { totalFound: foundProxies.length, added });
    return { totalFound: foundProxies.length, added };
}

