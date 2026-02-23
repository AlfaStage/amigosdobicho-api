import { type FastifyInstance } from 'fastify';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getDb, saveDatabase } from '../database/schema.js';
import { getWebhooks, createWebhook, deleteWebhook, testWebhook, toggleWebhookLoterica, reactivateWebhook, getWebhookLogs } from '../services/WebhookService.js';
import { getAllProxies, addManualProxy, deleteProxy, runProxySweep, processBulkProxies } from '../services/ProxyService.js';
import { fetchPalpites, savePalpites, fetchHoroscopo, fetchCotacoes, saveCotacoes, fetchAllResultados } from '../services/ScraperService.js';
import { runStartupRecovery } from '../services/StartupRecoveryService.js';
import { todayStr } from '../utils/helpers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TEMPLATES_DIR = join(__dirname, '..', '..', '.explicações');

const API_KEY = process.env.API_KEY || 'amigos-do-bicho-secret-key';

const TEMPLATE_FILE_MAP: Record<string, string> = {
    resultado: 'resultados_exemplo.html',
    palpite: 'palpites_exemplo.html',
    premiado_unitario: 'palpite_premiado_exemplo.html',
    premiado_dia: 'palpite_premiado_dia_exemplo.html',
    cotacao: 'cotação_exemplo.html',
};

function authHook(req: any, reply: any, done: any) {
    const key = req.headers['x-api-key'];
    if (key !== API_KEY) {
        reply.code(401).send({ error: 'Unauthorized: Invalid API key' });
        return;
    }
    done();
}

export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {

    // ==================== STATUS ====================
    app.get('/api/status/hoje', {
        preHandler: authHook,
        schema: { tags: ['Admin'], summary: 'Status geral de hoje' }
    }, async () => {
        const db = getDb();
        const today = todayStr();

        const totalRows = db.exec("SELECT COUNT(*) FROM scraping_status WHERE data = ?", [today]);
        const successRows = db.exec("SELECT COUNT(*) FROM scraping_status WHERE data = ? AND status = 'success'", [today]);
        const errorRows = db.exec("SELECT COUNT(*) FROM scraping_status WHERE data = ? AND status IN ('error', 'retrying')", [today]);

        const total = totalRows[0]?.values[0]?.[0] as number || 0;
        const sucesso = successRows[0]?.values[0]?.[0] as number || 0;
        const erro = errorRows[0]?.values[0]?.[0] as number || 0;
        const taxa = total > 0 ? Math.round((sucesso / total) * 100) : 0;

        return { data: today, total_dia: total, sucesso, erro, taxa_sucesso: taxa };
    });

    app.get('/api/status/painel', {
        preHandler: authHook,
        schema: { tags: ['Admin'], summary: 'Painel detalhado de scraping' }
    }, async () => {
        const db = getDb();
        const today = todayStr();
        const rows = db.exec(`
      SELECT loterica_slug, horario, status, tentativas, ultimo_erro
      FROM scraping_status WHERE data = ?
      ORDER BY loterica_slug, horario
    `, [today]);

        if (!rows.length) return [];
        return rows[0].values.map((r: any) => ({
            loterica_slug: r[0], horario: r[1], status: r[2], tentativas: r[3], ultimo_erro: r[4]
        }));
    });

    app.post('/api/status/force-scrape/:type', {
        preHandler: authHook,
        schema: { tags: ['Admin'], summary: 'Forçar execução de scraper específico' }
    }, async (req, reply) => {
        const { type } = req.params as any;
        try {
            if (type === 'palpites') {
                const palpites = await fetchPalpites();
                if (palpites.grupos.length > 0 || palpites.milhares.length > 0) {
                    savePalpites(todayStr(), palpites);
                    return { success: true, message: 'Palpites extraídos e salvos com sucesso', palpites: { grupos: palpites.grupos.length, milhares: palpites.milhares.length, centenas: palpites.centenas.length } };
                }
                return { success: false, message: 'Nenhum palpite retornado do scraper. Verifique se o site está bloqueado.' };
            } else if (type === 'horoscopo') {
                const horoscopo = await fetchHoroscopo();
                if (horoscopo.length > 0) {
                    return { success: true, message: 'Horóscopo extraído', count: horoscopo.length };
                }
                return { success: false, message: 'Nenhum horóscopo retornado do scraper.' };
            } else if (type === 'cotacoes') {
                const cotacoes = await fetchCotacoes();
                if (cotacoes.length > 0) {
                    saveCotacoes(cotacoes);
                    return { success: true, message: 'Cotações extraídas e salvas', count: cotacoes.length };
                }
                return { success: false, message: 'Nenhuma cotação retornada' };
            } else if (type === 'loterias') {
                const resultados = await fetchAllResultados();
                return { success: true, message: 'Loterias extraídas na totalidade', count: resultados.length };
            } else if (type === 'all') {
                await runStartupRecovery();
                return { success: true, message: 'Processo de recuperação/scrape completo acionado' };
            }
            return reply.code(400).send({ error: 'Tipo desconhecido' });
        } catch (err: any) {
            return reply.code(200).send({ success: false, error: err.message });
        }
    });

    // ==================== WEBHOOKS ====================
    app.get('/api/webhooks', {
        preHandler: authHook,
        schema: { tags: ['Webhooks'], summary: 'Listar webhooks' }
    }, async () => getWebhooks());

    app.post('/api/webhooks', {
        preHandler: authHook,
        schema: { tags: ['Webhooks'], summary: 'Criar novo webhook', body: { type: 'object', properties: { url: { type: 'string' } } } }
    }, async (req) => {
        const { url } = req.body as any;
        if (!url) return { error: 'URL is required' };
        const id = createWebhook(url);
        return { id, url };
    });

    app.delete('/api/webhooks/:id', {
        preHandler: authHook,
        schema: { tags: ['Webhooks'], summary: 'Deletar webhook', params: { type: 'object', properties: { id: { type: 'string' } } } }
    }, async (req) => {
        const { id } = req.params as any;
        deleteWebhook(id);
        return { deleted: true };
    });

    app.post('/api/webhooks/:id/test', {
        preHandler: authHook,
        schema: { tags: ['Webhooks'], summary: 'Testar envio de webhook' }
    }, async (req) => {
        const { id } = req.params as any;
        return testWebhook(id);
    });

    app.get('/api/webhooks/:id/historico', {
        preHandler: authHook,
        schema: { tags: ['Webhooks'], summary: 'Ver histórico de envios do webhook' }
    }, async (req) => {
        const { id } = req.params as any;
        return getWebhookLogs(id);
    });

    app.put('/api/webhooks/:id/lotericas', {
        preHandler: authHook,
        schema: { tags: ['Webhooks'], summary: 'Habilitar/Desabilitar lotéricas no webhook' }
    }, async (req) => {
        const { id } = req.params as any;
        const { lotericas } = req.body as any;
        if (!Array.isArray(lotericas)) return { error: 'lotericas array required' };
        for (const l of lotericas) {
            toggleWebhookLoterica(id, l.slug, l.enabled);
        }
        return { updated: true };
    });

    app.post('/api/webhooks/:id/reactivate', {
        preHandler: authHook,
        schema: { tags: ['Webhooks'], summary: 'Reativar webhook desativado por erros' }
    }, async (req) => {
        const { id } = req.params as any;
        reactivateWebhook(id);
        return { reactivated: true };
    });

    // ==================== PROXIES ====================
    app.get('/api/proxies', {
        preHandler: authHook,
        schema: { tags: ['Proxies'], summary: 'Listar proxies cadastrados' }
    }, async () => getAllProxies());

    app.post('/api/proxies', {
        preHandler: authHook,
        schema: { tags: ['Proxies'], summary: 'Adicionar proxy manual' }
    }, async (req) => {
        const { host, port, protocol } = req.body as any;
        if (!host || !port || !protocol) return { error: 'host, port, protocol required' };
        const ok = addManualProxy(host, port, protocol);
        return { added: ok };
    });

    app.post('/api/proxies/bulk', {
        preHandler: authHook,
        schema: { tags: ['Proxies'], summary: 'Adicionar proxies em massa via texto livre' }
    }, async (req) => {
        const { text } = req.body as any;
        if (!text || typeof text !== 'string') return { error: 'text is required' };

        const result = await processBulkProxies(text);
        return result;
    });

    app.delete('/api/proxies/:id', {
        preHandler: authHook,
        schema: { tags: ['Proxies'], summary: 'Remover proxy' }
    }, async (req) => {
        const { id } = req.params as any;
        deleteProxy(id);
        return { deleted: true };
    });

    app.post('/api/proxies/sweep', {
        preHandler: authHook,
        schema: { tags: ['Proxies'], summary: 'Forçar varredura e teste de novos proxies' }
    }, async () => {
        return runProxySweep();
    });

    // ==================== TEMPLATES ====================

    // Serve base HTML template from .explicações/ examples
    app.get('/admin/api/template-base/:type', {
        schema: { tags: ['Admin'], summary: 'Obter conteúdo original dos arquivos .explicações' }
    }, async (req, reply) => {
        const { type } = req.params as any;
        const filename = TEMPLATE_FILE_MAP[type];
        if (!filename) return reply.code(404).send({ error: 'Template type not found' });

        const filePath = join(TEMPLATES_DIR, filename);
        if (!existsSync(filePath)) return reply.code(404).send({ error: 'Template file not found' });

        const html = readFileSync(filePath, 'utf-8');
        return { type, filename, html_content: html };
    });

    // Get saved template config from DB (or fallback to base file)
    app.get('/admin/api/template', {
        preHandler: authHook,
        schema: { tags: ['Admin'], summary: 'Recuperar configuração salva de um template' }
    }, async (req) => {
        const { type } = req.query as any;
        const db = getDb();
        const rows = db.exec('SELECT id, type, name, html_content, css_content, width, height FROM templates WHERE type = ?', [type]);

        if (rows.length && rows[0].values.length) {
            const r = rows[0].values[0];
            return { id: r[0], type: r[1], name: r[2], html_content: r[3], css_content: r[4], width: r[5], height: r[6] };
        }

        // Fallback: load from base file
        const filename = TEMPLATE_FILE_MAP[type];
        if (filename) {
            const filePath = join(TEMPLATES_DIR, filename);
            if (existsSync(filePath)) {
                return { type, name: type, html_content: readFileSync(filePath, 'utf-8'), width: 700 };
            }
        }
        return { type, name: type, html_content: '', width: 700 };
    });

    app.post('/admin/api/template', {
        preHandler: authHook,
        schema: { tags: ['Admin'], summary: 'Salvar alterações de design em um template' }
    }, async (req) => {
        const { type, name, html_content, css_content, width, height } = req.body as any;
        const db = getDb();
        db.run(
            `INSERT INTO templates (id, type, name, html_content, css_content, width, height, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(type) DO UPDATE SET name = ?, html_content = ?, css_content = ?, width = ?, height = ?, updated_at = datetime('now')`,
            [crypto.randomUUID(), type, name, html_content, css_content || '', width || 700, height || null,
                name, html_content, css_content || '', width || 700, height || null]
        );
        saveDatabase();
        return { saved: true };
    });

    // Preview: render HTML as iframe-ready content
    app.post('/admin/api/preview-html', {
        schema: { tags: ['Admin'], summary: 'Prévia de HTML para iframe' }
    }, async (req, reply) => {
        const { html } = req.body as any;
        if (!html) return reply.code(400).send({ error: 'html body required' });
        const fullHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>*{margin:0;padding:0;box-sizing:border-box;}body{width:700px;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;}</style></head><body>${html}</body></html>`;
        reply.type('text/html').send(fullHtml);
    });

    // Preview: render HTML as PNG image
    app.post('/admin/api/preview-image', {
        preHandler: authHook,
        schema: { tags: ['Admin'], summary: 'Prévia de HTML renderizado como PNG' }
    }, async (req, reply) => {
        const { html } = req.body as any;
        if (!html) return reply.code(400).send({ error: 'html body required' });

        const puppeteer = (await import('puppeteer')).default;
        const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
        const page = await browser.newPage();
        await page.setViewport({ width: 700, height: 100 });

        const fullHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>*{margin:0;padding:0;box-sizing:border-box;}body{width:700px;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;}</style></head><body>${html}</body></html>`;
        await page.setContent(fullHtml, { waitUntil: 'networkidle0' });

        const height = await page.evaluate(() => Math.max(document.body.scrollHeight, document.documentElement.scrollHeight));
        await page.setViewport({ width: 700, height });

        const screenshot = await page.screenshot({ type: 'png', fullPage: true });
        await page.close();
        await browser.close();

        const base64 = Buffer.from(screenshot).toString('base64');
        return { image: `data:image/png;base64,${base64}` };
    });
}



