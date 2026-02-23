/**
 * Logger — Structured categorized logging with colors.
 * Categories: BOOT, CRON, SCRAPER, RECOVERY, WEBHOOK, PROXY, DB, RENDER, MCP, API
 */

type LogCategory =
    | 'BOOT' | 'CRON' | 'SCRAPER' | 'RECOVERY'
    | 'WEBHOOK' | 'PROXY' | 'DB' | 'RENDER'
    | 'MCP' | 'API' | 'TEMPLATE' | 'SHUTDOWN' | 'AUDIT' | 'AUTO-LEARN';

const COLORS: Record<LogCategory, string> = {
    BOOT: '\x1b[32m',  // Green
    CRON: '\x1b[34m',  // Blue
    SCRAPER: '\x1b[33m',  // Yellow
    RECOVERY: '\x1b[35m',  // Magenta
    WEBHOOK: '\x1b[36m',  // Cyan
    PROXY: '\x1b[37m',  // White/Gray
    DB: '\x1b[32m',  // Green
    RENDER: '\x1b[34m',  // Blue
    MCP: '\x1b[36m',  // Cyan
    API: '\x1b[37m',  // White
    TEMPLATE: '\x1b[33m',  // Yellow
    SHUTDOWN: '\x1b[31m',  // Red
    AUDIT: '\x1b[35m',     // Magenta
    'AUTO-LEARN': '\x1b[32m', // Green
};

const RESET = '\x1b[0m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';

function timestamp(): string {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

function formatMessage(cat: LogCategory, msg: string, meta?: Record<string, unknown>): string {
    const ts = `${DIM}${timestamp()}${RESET}`;
    const color = COLORS[cat] || '';
    const tag = `${color}[${cat}]${RESET}`;
    let line = `${ts} ${tag} ${msg}`;
    if (meta && Object.keys(meta).length) {
        const metaStr = Object.entries(meta)
            .map(([k, v]) => `${DIM}${k}=${RESET}${typeof v === 'object' ? JSON.stringify(v) : v}`)
            .join(' ');
        line += ` ${metaStr}`;
    }
    return line;
}

export const log = {
    info(cat: LogCategory, msg: string, meta?: Record<string, unknown>): void {
        console.log(formatMessage(cat, msg, meta));
    },

    success(cat: LogCategory, msg: string, meta?: Record<string, unknown>): void {
        console.log(formatMessage(cat, `✅ ${msg}`, meta));
    },

    warn(cat: LogCategory, msg: string, meta?: Record<string, unknown>): void {
        console.warn(formatMessage(cat, `⚠️  ${msg}`, meta));
    },

    error(cat: LogCategory, msg: string, error?: unknown, meta?: Record<string, unknown>): void {
        console.error(formatMessage(cat, `❌ ${msg}`, meta));
        if (error instanceof Error) {
            console.error(`${RED}   → ${error.message}${RESET}`);
            if (error.stack) {
                const stackLines = error.stack.split('\n').slice(1, 4).map(l => `${DIM}     ${l.trim()}${RESET}`);
                console.error(stackLines.join('\n'));
            }
        } else if (error) {
            console.error(`${RED}   → ${String(error)}${RESET}`);
        }
    },

    /** Separator line for visual grouping */
    separator(cat: LogCategory, label?: string): void {
        const color = COLORS[cat] || '';
        if (label) {
            console.log(`${color}${'─'.repeat(20)} ${label} ${'─'.repeat(20)}${RESET}`);
        } else {
            console.log(`${color}${'─'.repeat(50)}${RESET}`);
        }
    },

    /** Table-like summary for recovery or status */
    table(cat: LogCategory, rows: Record<string, unknown>[]): void {
        if (!rows.length) return;
        const color = COLORS[cat] || '';
        for (const row of rows) {
            const line = Object.entries(row)
                .map(([k, v]) => `${DIM}${k}:${RESET}${v}`)
                .join(' | ');
            console.log(`${color}   ▸ ${RESET}${line}`);
        }
    },

    /** Sanitizes strings for single-line logging */
    sanitize(text: string): string {
        return text.replace(/\s+/g, ' ').trim();
    }
};
