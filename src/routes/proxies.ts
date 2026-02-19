import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { proxyService } from '../services/ProxyService.js';

export async function proxiesRoutes(server: FastifyInstance) {

    // GET /list - Listar todos os proxies com stats
    server.get('/list', {
        schema: {
            summary: 'Listar Proxies',
            description: 'Retorna todos os proxies e estatísticas globais.',
            tags: ['⚙️ Proxies'],
        }
    }, async () => {
        const proxies = proxyService.listAll();
        const stats = proxyService.getStats();
        return { proxies, stats };
    });

    // POST /collect - Forçar coleta de todas as fontes
    server.post('/collect', {
        schema: {
            summary: 'Coletar Proxies',
            description: 'Força a coleta de proxies de todas as fontes externas.',
            tags: ['⚙️ Proxies'],
        }
    }, async () => {
        const result = await proxyService.collectFromAllSources();
        return { success: true, ...result };
    });

    // POST /test-all - Forçar teste de todos os proxies
    server.post('/test-all', {
        schema: {
            summary: 'Testar Proxies',
            description: 'Testa a conectividade TCP de todos os proxies habilitados.',
            tags: ['⚙️ Proxies'],
        }
    }, async () => {
        const result = await proxyService.testAllProxies();
        return { success: true, ...result };
    });

    // POST /bulk - Adicionar proxies em massa
    server.post('/bulk', {
        schema: {
            summary: 'Importar Proxies em Massa',
            description: `Adiciona múltiplos proxies de uma vez. Formatos aceitos por linha:
- \`http://user:pass@host:port\`
- \`host:port:user:pass\`
- \`host:port\``,
            tags: ['⚙️ Proxies'],
            body: z.object({
                text: z.string().min(1).describe('Texto com proxies, um por linha'),
            }),
        }
    }, async (req) => {
        const { text } = req.body as { text: string };
        const result = proxyService.bulkAdd(text);
        return { success: true, ...result };
    });

    // POST /:id/toggle - Habilitar/Desabilitar
    server.post('/:id/toggle', {
        schema: {
            summary: 'Toggle Proxy',
            description: 'Habilita ou desabilita um proxy.',
            tags: ['⚙️ Proxies'],
            params: z.object({ id: z.string() }),
        }
    }, async (req) => {
        const { id } = req.params as { id: string };
        const proxy = proxyService.toggle(id);
        return { success: !!proxy, proxy };
    });

    // DELETE /:id - Remover proxy
    server.delete('/:id', {
        schema: {
            summary: 'Remover Proxy',
            description: 'Remove um proxy do pool.',
            tags: ['⚙️ Proxies'],
            params: z.object({ id: z.string() }),
        }
    }, async (req) => {
        const { id } = req.params as { id: string };
        const success = proxyService.remove(id);
        return { success };
    });

    // POST /reset-stats - Resetar estatísticas
    server.post('/reset-stats', {
        schema: {
            summary: 'Resetar Estatísticas',
            description: 'Zera os contadores de sucesso e erro de todos os proxies.',
            tags: ['⚙️ Proxies'],
        }
    }, async () => {
        proxyService.resetStats();
        return { success: true };
    });

    // POST /clear-dead - Remover todos os proxies mortos
    server.post('/clear-dead', {
        schema: {
            summary: 'Limpar Mortos',
            description: 'Remove todos os proxies marcados como mortos (exceto BrightData).',
            tags: ['⚙️ Proxies'],
        }
    }, async () => {
        const removed = proxyService.removeAllDead();
        return { success: true, removed };
    });

    // POST /clear-blacklist - Limpar blacklist
    server.post('/clear-blacklist', {
        schema: {
            summary: 'Limpar Blacklist',
            description: 'Limpa a lista de IPs temporariamente bloqueados.',
            tags: ['⚙️ Proxies'],
        }
    }, async () => {
        proxyService.clearBlacklist();
        return { success: true };
    });
}
