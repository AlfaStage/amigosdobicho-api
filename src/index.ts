import { readFileSync } from 'fs';
import { join as joinPath, dirname as dirnamePath } from 'path';
import { fileURLToPath as fileURLToPathUtil } from 'url';

// Load .env manually (no extra deps)
const __entryFile = fileURLToPathUtil(import.meta.url);
const __entryDir = dirnamePath(__entryFile);
try {
    const envPath = joinPath(__entryDir, '..', '.env');
    const envContent = readFileSync(envPath, 'utf-8');
    for (const line of envContent.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx > 0) {
            const key = trimmed.slice(0, eqIdx).trim();
            const val = trimmed.slice(eqIdx + 1).trim();
            if (!process.env[key]) process.env[key] = val;
        }
    }
} catch { /* .env not found, use defaults */ }

import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import { initDatabase, saveDatabase } from './database/schema.js';
import { registerPublicRoutes } from './routes/public.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerMcpRoutes } from './routes/mcp.js';
import { initCronJobs } from './services/CronService.js';
import { closeBrowser } from './services/RenderService.js';
import { runStartupRecovery } from './services/StartupRecoveryService.js';
import { log } from './utils/Logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = parseInt(process.env.PORT || '3000', 10);

async function main() {
    log.separator('BOOT', 'AMIGOS DO BICHO API');

    // 1. Initialize Database
    await initDatabase();
    log.success('DB', 'SQLite inicializado com sucesso');

    // 2. Startup Recovery (check missing data from today)
    await runStartupRecovery();

    // 3. Create Fastify server (disable built-in logger to use ours)
    const app = Fastify({
        logger: {
            level: 'warn', // Only log warnings/errors from Fastify itself
        },
    });

    // 4. CORS
    await app.register(cors, { origin: true });

    // 5. Swagger/OpenAPI
    await app.register(fastifySwagger, {
        openapi: {
            info: {
                title: 'Amigos do Bicho API',
                description: 'API completa do ecossistema Amigos do Bicho — Resultados, Palpites, Premiados, Motor Gráfico, Webhooks, Proxies e MCP Server.',
                version: '1.0.0',
                contact: { name: 'AlfaStage', url: 'https://alfastage.com.br' },
            },
            servers: [{ url: `http://localhost:${PORT}`, description: 'Local Dev Server' }],
            tags: [
                { name: 'Resultados', description: 'Consulta de resultados de sorteios' },
                { name: 'Lotéricas', description: 'Lista de bancas e configurações' },
                { name: 'Bichos', description: 'Tabela dos 25 grupos do Jogo do Bicho' },
                { name: 'Palpites', description: 'Previsões e sugestões do dia' },
                { name: 'Premiados', description: 'Palpites que acertaram nos sorteios' },
                { name: 'Numerologia', description: 'Cálculo numerológico pitagórico' },
                { name: 'Horóscopo', description: 'Horóscopo com números da sorte' },
                { name: 'Cotação', description: 'Valores de pagamento por modalidade' },
                { name: 'Info', description: 'Informações gerais e regras do jogo' },
                { name: 'Admin', description: 'Gestão do sistema (requer x-api-key)' },
                { name: 'Webhooks', description: 'Notificações em tempo real (requer x-api-key)' },
                { name: 'Proxies', description: 'Gestão de proxies para scraping (requer x-api-key)' },
                { name: 'Templates', description: 'Designer de templates HTML (requer x-api-key)' },
                { name: 'MCP', description: 'Model Context Protocol — IA Agent Interface' },
            ],
            components: {
                securitySchemes: {
                    apiKey: {
                        type: 'apiKey',
                        in: 'header',
                        name: 'x-api-key',
                        description: 'Chave de API definida no .env (API_KEY)',
                    },
                },
            },
        },
    });
    await app.register(fastifySwaggerUi, {
        routePrefix: '/docs',
        staticCSP: false,
        transformStaticCSP: (header) => header,
        uiConfig: { docExpansion: 'list', deepLinking: true, tryItOutEnabled: true },
    });

    // 6. Register all routes
    await registerPublicRoutes(app);
    await registerAdminRoutes(app);
    await registerMcpRoutes(app);
    log.success('BOOT', 'Rotas registradas (public + admin + MCP)');

    // 7. Health check
    app.get('/health', { schema: { tags: ['Info'], summary: 'Health check' } }, async () => ({
        status: 'ok', timestamp: new Date().toISOString(),
    }));

    // 8. Serve admin frontend (if built)
    const adminPath = join(__dirname, '..', 'admin', 'dist');
    if (existsSync(adminPath)) {
        await app.register(fastifyStatic, {
            root: adminPath,
            prefix: '/admin/',
        });
        // SPA fallback
        app.setNotFoundHandler((req, reply) => {
            if (req.url.startsWith('/admin')) {
                reply.sendFile('index.html');
            } else {
                reply.code(404).send({ error: 'Not Found' });
            }
        });
        log.success('BOOT', 'Admin frontend servido em /admin/');
    }

    // 9. Initialize Cron Jobs
    initCronJobs();

    // 10. Graceful shutdown
    const shutdown = async () => {
        log.separator('SHUTDOWN', 'ENCERRAMENTO');
        log.info('SHUTDOWN', 'Salvando banco de dados e fechando browser...');
        saveDatabase();
        await closeBrowser();
        log.success('SHUTDOWN', 'Encerrado com sucesso');
        process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    // 11. Auto-save DB every 60 seconds
    setInterval(() => saveDatabase(), 60_000);

    // 12. Start
    try {
        await app.listen({ port: PORT, host: '0.0.0.0' });
        log.separator('BOOT', 'SERVER READY');
        log.info('BOOT', `🌐 Server:  http://localhost:${PORT}`);
        log.info('BOOT', `📄 Swagger: http://localhost:${PORT}/docs`);
        log.info('BOOT', `🤖 MCP SSE: http://localhost:${PORT}/mcp/sse`);
        log.info('BOOT', `🎛️  Admin:   http://localhost:${PORT}/admin/`);
        log.separator('BOOT');
    } catch (err) {
        log.error('BOOT', 'Falha ao iniciar servidor', err);
        process.exit(1);
    }
}

main();
