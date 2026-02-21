import { type FastifyInstance } from 'fastify';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { mcpServer } from '../mcp/server.js';
import { log } from '../utils/Logger.js';
import crypto from 'crypto';

const transports = new Map<string, SSEServerTransport>();

export async function registerMcpRoutes(app: FastifyInstance): Promise<void> {

    // SSE endpoint for persistent connection
    app.get('/mcp/sse', {
        schema: { tags: ['MCP Server'], summary: 'Conexão SSE para o MCP Server (Padrão Oficial)' }
    }, async (req, reply) => {
        const sessionId = crypto.randomUUID();

        reply.raw.setHeader('Access-Control-Allow-Origin', '*');
        reply.raw.setHeader('Cache-Control', 'no-cache');

        const transport = new SSEServerTransport(`/mcp/message?sessionId=${sessionId}`, reply.raw);
        transports.set(sessionId, transport);

        // Fastify Hijack para evitar que a requisicao seja fechada automaticamente
        reply.hijack();

        await mcpServer.connect(transport);
        log.info('MCP', `Nova sessão SSE estabelecida: ${sessionId}`);

        req.raw.on('close', () => {
            log.info('MCP', `Sessão SSE encerrada: ${sessionId}`);
            transports.delete(sessionId);
        });
    });

    // POST messages for JSON-RPC over HTTP
    app.post('/mcp/message', {
        schema: { tags: ['MCP Server'], summary: 'Endpoint de mensagens JSON-RPC do MCP (Padrão Oficial)' },
        // O SDK lida internamente com o parsing do raw body, entao nao podemos deixar o fastify consumir na marra dependendo da config
    }, async (req, reply) => {
        const query = req.query as { sessionId?: string };
        const sessionId = query.sessionId;

        if (!sessionId) {
            reply.code(400).send('Missing sessionId');
            return;
        }

        const transport = transports.get(sessionId);
        if (!transport) {
            reply.code(404).send('Session not found or expired');
            return;
        }

        reply.hijack(); // O SDK emite sua própria resposta HTTP com res.end()

        // Se o body já foi digerido pelo Fastify (o que geralmente é o caso se tiver schema ou parser),
        // o transport.handlePostMessage falhará pois lerá pipe Vazio.
        // Fastify workaround: se body existe no req fastify, enviamos os chunks
        try {
            await transport.handlePostMessage(req.raw, reply.raw);
        } catch (e: any) {
            log.error('MCP', 'Error handling POST message', e);
        }
    });
}
