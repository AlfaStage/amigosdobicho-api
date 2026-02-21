import axios from 'axios';
import { getDb, saveDatabase } from '../database/schema.js';
import { log } from '../utils/Logger.js';

interface ProxyEntry {
    host: string;
    port: string;
    protocol: string;
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
async function testProxy(host: string, port: string, protocol: string): Promise<{ alive: boolean; latency: number }> {
    const start = Date.now();
    try {
        const proxyUrl = `${protocol}://${host}:${port}`;
        await axios.get(TEST_URL, {
            proxy: protocol.startsWith('socks')
                ? false
                : { host, port: parseInt(port, 10), protocol: protocol + ':' },
            timeout: 10000,
            ...(protocol.startsWith('socks') ? {} : {}),
        });
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
    const allRows = db.exec('SELECT id, host, port, protocol FROM proxies');
    const allProxies = allRows.length ? allRows[0].values : [];
    let tested = 0;
    let purged = 0;

    for (const row of allProxies) {
        const [id, host, port, protocol] = row as [string, string, string, string];
        const result = await testProxy(host, port, protocol);
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
export function getBestProxy(): { host: string; port: string; protocol: string } | null {
    const db = getDb();
    const rows = db.exec(
        'SELECT host, port, protocol FROM proxies WHERE alive = 1 ORDER BY score DESC, latency_ms ASC LIMIT 1'
    );
    if (!rows.length || !rows[0].values.length) return null;
    const [host, port, protocol] = rows[0].values[0] as [string, string, string];
    return { host, port, protocol };
}

/**
 * Get all proxies for admin display.
 */
export function getAllProxies(): any[] {
    const db = getDb();
    const rows = db.exec(
        'SELECT id, host, port, protocol, source, alive, latency_ms, score, last_checked, created_at FROM proxies ORDER BY score DESC'
    );
    if (!rows.length) return [];
    return rows[0].values.map((r: any) => ({
        id: r[0], host: r[1], port: r[2], protocol: r[3], source: r[4],
        alive: r[5], latency_ms: r[6], score: r[7], last_checked: r[8], created_at: r[9]
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
