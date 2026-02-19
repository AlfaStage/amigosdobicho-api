import { FastifyInstance } from 'fastify';
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import db from "../db.js";
import { bichosData, getBichoByDezena, getBichoByGrupo } from "../utils/bichos.js";
import { NumerologyService } from "../services/NumerologyService.js";
import { WebhookService } from "../services/WebhookService.js";
import fs from "fs/promises";
import path from "path";

// Cache para conteúdo do arquivo historia.md
let historiaCache: string | null = null;
let historiaCacheTime: number = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutos

async function getHistoriaContent(): Promise<string> {
    const now = Date.now();
    if (historiaCache && (now - historiaCacheTime) < CACHE_TTL) {
        return historiaCache;
    }

    try {
        const filePath = path.resolve('src/data/historia.md');
        const content = await fs.readFile(filePath, 'utf-8');
        historiaCache = content;
        historiaCacheTime = now;
        return content;
    } catch (error: any) {
        console.error('[MCP] Erro ao ler historia.md:', error.message);
        return `# Guia do Jogo do Bicho

## Sobre
O arquivo de história não está disponível no momento, mas você pode consultar as outras ferramentas MCP para informações sobre o jogo.`;
    }
}

export async function registerMcpRoutes(app: FastifyInstance) {
    console.log('[MCP] Inicializando servidor MCP...');

    // CRÍTICO: Desabilitar o body parsing automático para as rotas MCP
    // O SDK MCP precisa ler o corpo da requisição diretamente do stream.
    // Se o Fastify parsear antes, o stream fica vazio e o SDK recebe null.
    app.addContentTypeParser('application/json',
        { parseAs: 'string', bodyLimit: 1024 * 1024 },
        (req, body, done) => {
            // Para rotas MCP, armazenamos o body como string para uso posterior
            // mas NÃO parseamos ainda para permitir que o SDK leia o raw stream
            const url = req.url || '';
            if (url.includes('/messages') || url === '/mcp') {
                // Para rotas MCP, guardar body raw como propriedade especial
                (req as any).mcpRawBody = body;
                done(null, body ? JSON.parse(body as string) : undefined);
            } else {
                // Para outras rotas, parsear normalmente
                try {
                    done(null, body ? JSON.parse(body as string) : undefined);
                } catch (err: any) {
                    done(err, undefined);
                }
            }
        }
    );

    const server = new Server(
        {
            name: "jogodobicho-mcp",
            version: "1.0.0",
        },
        {
            capabilities: {
                tools: {},
            },
        }
    );

    const numerologyService = new NumerologyService();
    const webhookService = new WebhookService();
    const sessions = new Map<string, { transport: SSEServerTransport; keepAliveInterval?: NodeJS.Timeout; createdAt: number }>();

    // Cleanup de sessões antigas a cada 5 minutos (evita memory leak)
    const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutos
    setInterval(() => {
        const now = Date.now();
        let cleanedCount = 0;
        for (const [id, session] of sessions.entries()) {
            if (now - session.createdAt > SESSION_TIMEOUT) {
                if (session.keepAliveInterval) clearInterval(session.keepAliveInterval);
                sessions.delete(id);
                cleanedCount++;
            }
        }
        if (cleanedCount > 0) {
            console.log(`[MCP] 🧹 Cleanup: ${cleanedCount} sessões expiradas removidas`);
        }
    }, 5 * 60 * 1000);
    const crypto = await import('node:crypto');

    server.setRequestHandler(ListToolsRequestSchema, async () => {
        return {
            tools: [
                {
                    name: "listar_resultados",
                    description: "Lista últimos resultados do Jogo do Bicho",
                    inputSchema: {
                        type: "object",
                        properties: {
                            data: { type: "string", description: "Data no formato YYYY-MM-DD" },
                            loterica: { type: "string", description: "Slug da lotérica (ex: pt-rio, federal, look-goias)" }
                        }
                    }
                },
                {
                    name: "listar_lotericas",
                    description: "Lista todas as bancas/lotéricas disponíveis e seus slugs",
                    inputSchema: { type: "object", properties: {} }
                },
                {
                    name: "tabela_bichos",
                    description: "Retorna a tabela completa de todos os 25 bichos e suas dezenas",
                    inputSchema: { type: "object", properties: {} }
                },
                {
                    name: "buscar_bicho",
                    description: "Busca informações de um bicho pelo grupo (1-25) ou dezena (00-99)",
                    inputSchema: {
                        type: "object",
                        properties: {
                            query: { type: "string", description: "Grupo (ex: 1) ou Dezena (ex: 01, 12)" }
                        },
                        required: ["query"]
                    }
                },
                {
                    name: "como_jogar",
                    description: "Retorna instruções, regras e história do Jogo do Bicho",
                    inputSchema: {
                        type: "object",
                        properties: {
                            secao: {
                                type: "string",
                                enum: ["regras", "tabela", "modalidades", "historia", "dicas"],
                                description: "Seção específica para ler (opcional)"
                            }
                        }
                    }
                },
                {
                    name: "calcular_numerologia",
                    description: "Calcula os números da sorte baseados no nome usando numerologia cabalistica",
                    inputSchema: {
                        type: "object",
                        properties: {
                            nome: { type: "string", description: "Nome completo para calcular os números da sorte" }
                        },
                        required: ["nome"]
                    }
                },
                {
                    name: "horoscopo_dia",
                    description: "Retorna o horóscopo do dia com números da sorte para cada signo",
                    inputSchema: {
                        type: "object",
                        properties: {
                            signo: { type: "string", description: "Nome do signo (ex: Áries, Touro, etc). Deixe vazio para todos." }
                        }
                    }
                },
                {
                    name: "listar_webhooks",
                    description: "Lista todos os webhooks de notificação registrados",
                    inputSchema: { type: "object", properties: {} }
                },
                {
                    name: "criar_webhook",
                    description: "Registra um novo webhook para receber resultados automaticamente",
                    inputSchema: {
                        type: "object",
                        properties: {
                            url: { type: "string", description: "URL do webhook que receberá POST com os resultados" }
                        },
                        required: ["url"]
                    }
                },
                {
                    name: "deletar_webhook",
                    description: "Remove um webhook pelo ID",
                    inputSchema: {
                        type: "object",
                        properties: {
                            id: { type: "string", description: "UUID do webhook a ser removido" }
                        },
                        required: ["id"]
                    }
                }
            ]
        };
    });

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const { name, arguments: args } = request.params;
        const startTime = Date.now();

        console.log(`[MCP] Executando tool: ${name}`, args ? JSON.stringify(args) : '');

        try {
            if (name === "listar_resultados") {
                const data = args?.data as string | undefined;
                const loterica = args?.loterica as string | undefined;

                let qs = `
                SELECT r.data, r.horario, r.loterica_slug, 
                       json_group_array(json_object('posicao', p.posicao, 'bicho', p.bicho, 'milhar', p.milhar, 'grupo', p.grupo)) as premios
                FROM resultados r
                JOIN premios p ON r.id = p.resultado_id
                WHERE 1=1
                `;
                const params: any[] = [];

                if (data) {
                    qs += ' AND r.data = ?';
                    params.push(data);
                }
                if (loterica) {
                    qs += ' AND r.loterica_slug = ?';
                    params.push(loterica);
                }

                qs += ' GROUP BY r.id ORDER BY r.data DESC, r.horario DESC LIMIT 10';

                const res = db.prepare(qs).all(...params);
                const duration = Date.now() - startTime;
                console.log(`[MCP] listar_resultados: ${res.length} resultados em ${duration}ms`);
                return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
            }

            if (name === "listar_lotericas") {
                const res = db.prepare('SELECT slug, nome FROM lotericas ORDER BY nome').all();
                return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
            }

            if (name === "tabela_bichos") {
                return { content: [{ type: "text", text: JSON.stringify(bichosData, null, 2) }] };
            }

            if (name === "buscar_bicho") {
                const q = args?.query as string;
                if (!q) throw new Error("Parâmetro 'query' é obrigatório");

                const g = parseInt(q);
                let b: { grupo: number; nome: string; dezenas: string[] } | undefined;

                if (!isNaN(g) && g >= 1 && g <= 25) {
                    b = getBichoByGrupo(g);
                } else {
                    // Tenta como dezena (00-99)
                    b = getBichoByDezena(q.padStart(2, '0'));
                }

                if (!b) {
                    return {
                        content: [{ type: "text", text: JSON.stringify({ error: "Bicho não encontrado. Use grupo (1-25) ou dezena (00-99)" }, null, 2) }],
                        isError: true
                    };
                }

                return { content: [{ type: "text", text: JSON.stringify(b, null, 2) }] };
            }

            if (name === "como_jogar") {
                const secao = args?.secao as string | undefined;
                const content = await getHistoriaContent();

                if (!secao) {
                    return { content: [{ type: "text", text: content }] };
                }

                const headers: Record<string, string> = {
                    regras: 'Regras Básicas',
                    tabela: 'Tabela de Grupos e Dezenas',
                    modalidades: 'Modalidades de Aposta',
                    historia: 'Curiosidades Históricas',
                    dicas: 'Dicas de Apostas'
                };

                const header = headers[secao];
                if (!header) {
                    return {
                        content: [{ type: "text", text: `Seção '${secao}' não encontrada. Seções disponíveis: ${Object.keys(headers).join(', ')}` }],
                        isError: true
                    };
                }

                const regex = new RegExp(`#{2,3} ${header}([\\s\\S]*?)(?=\\n#{2,3} |$)`, 'i');
                const match = content.match(regex);
                const sectionContent = match ? match[1].trim() : `Seção '${secao}' não encontrada no guia.`;

                return { content: [{ type: "text", text: sectionContent }] };
            }

            if (name === "calcular_numerologia") {
                const nome = args?.nome as string;
                if (!nome || nome.trim().length === 0) {
                    return {
                        content: [{ type: "text", text: "Erro: Nome não pode estar vazio" }],
                        isError: true
                    };
                }
                const res = numerologyService.calculate(nome);
                return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
            }

            if (name === "horoscopo_dia") {
                const today = new Date().toISOString().split('T')[0];
                const signo = args?.signo as string | undefined;
                let query = 'SELECT signo, texto, numeros, data FROM horoscopo_diario WHERE data = ?';
                const params: any[] = [today];

                if (signo) {
                    query += ' AND signo LIKE ?';
                    params.push(`%${signo}%`);
                }
                query += ' ORDER BY signo';

                const res = db.prepare(query).all(...params);
                if (res.length === 0) {
                    return {
                        content: [{
                            type: "text", text: JSON.stringify({
                                message: "Horóscopo não disponível para hoje ainda",
                                data: today,
                                signo: signo || 'todos'
                            }, null, 2)
                        }]
                    };
                }
                return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
            }

            if (name === "listar_webhooks") {
                const res = webhookService.list();
                return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
            }

            if (name === "criar_webhook") {
                const url = args?.url as string;
                if (!url || !url.startsWith('http')) {
                    return {
                        content: [{ type: "text", text: "Erro: URL inválida. Deve começar com http:// ou https://" }],
                        isError: true
                    };
                }
                webhookService.register(url);
                return { content: [{ type: "text", text: `✅ Webhook registrado com sucesso: ${url}` }] };
            }

            if (name === "deletar_webhook") {
                const id = args?.id as string;
                if (!id) {
                    return {
                        content: [{ type: "text", text: "Erro: ID do webhook é obrigatório" }],
                        isError: true
                    };
                }
                webhookService.delete(id);
                return { content: [{ type: "text", text: "✅ Webhook removido com sucesso" }] };
            }

            console.warn(`[MCP] Tool não implementada: ${name}`);
            return {
                content: [{ type: "text", text: `Tool '${name}' não implementada` }],
                isError: true,
            };
        } catch (error: any) {
            const duration = Date.now() - startTime;
            console.error(`[MCP] Erro na tool ${name} (${duration}ms):`, error.message);
            return {
                content: [{ type: "text", text: `❌ Erro: ${error.message}` }],
                isError: true,
            };
        }
    });

    // Endpoint SSE com suporte a CORS e keep-alive
    app.get("/sse", async (req, reply) => {
        const clientIp = req.ip || req.socket.remoteAddress || 'unknown';

        console.log(`[MCP] 🟢 Nova conexão SSE solicitada | IP: ${clientIp}`);

        // Headers CORS essenciais para n8n e outros clients
        const origin = req.headers.origin || '*';
        reply.raw.setHeader('Access-Control-Allow-Origin', origin);
        reply.raw.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        reply.raw.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key');
        reply.raw.setHeader('Access-Control-Allow-Credentials', 'true');

        // Headers SSE essenciais
        reply.raw.setHeader('Content-Type', 'text/event-stream');
        reply.raw.setHeader('Cache-Control', 'no-cache, no-transform');
        reply.raw.setHeader('Connection', 'keep-alive');
        reply.raw.setHeader('X-Accel-Buffering', 'no');
        reply.raw.setHeader('X-Content-Type-Options', 'nosniff');

        // CRÍTICO: Hijack da resposta ANTES de qualquer flush ou envio do SDK
        // Isso impede que o Fastify tente fechar a conexão automaticamente
        await reply.hijack();

        // Criar transport - o SDK vai gerenciar o flush inicial se necessário
        // mas como já definimos os headers básicos, ele deve apenas começar a transmitir
        const transport = new SSEServerTransport("/messages", reply.raw);
        const sessionId = transport.sessionId;
        console.log(`[MCP] 📋 Session ID gerado pelo SDK: ${sessionId}`);

        // Keep-alive a cada 30 segundos (enviado diretamente no raw stream)
        const keepAliveInterval = setInterval(() => {
            try {
                if (reply.raw.writable && !reply.raw.writableEnded) {
                    reply.raw.write(':ping\n\n');
                }
            } catch (err) {
                console.log(`[MCP] Keep-alive falhou para ${sessionId}, limpando...`);
                clearInterval(keepAliveInterval);
                sessions.delete(sessionId);
            }
        }, 30000);

        sessions.set(sessionId, { transport, keepAliveInterval, createdAt: Date.now() });

        try {
            await server.connect(transport);
            console.log(`[MCP] ✅ Servidor conectado à sessão: ${sessionId}`);
        } catch (err: any) {
            console.error(`[MCP] ❌ Erro ao conectar servidor na sessão ${sessionId}:`, err.message);
            clearInterval(keepAliveInterval);
            sessions.delete(sessionId);
            if (!reply.raw.writableEnded) {
                reply.raw.end();
            }
            return;
        }

        reply.raw.on('close', () => {
            console.log(`[MCP] 🔴 Conexão encerrada: ${sessionId}`);
            const session = sessions.get(sessionId);
            if (session?.keepAliveInterval) {
                clearInterval(session.keepAliveInterval);
            }
            sessions.delete(sessionId);
        });

        reply.raw.on('error', (err) => {
            console.error(`[MCP] ⚠️ Erro na conexão ${sessionId}:`, err.message);
            const session = sessions.get(sessionId);
            if (session?.keepAliveInterval) {
                clearInterval(session.keepAliveInterval);
            }
            sessions.delete(sessionId);
        });
    });

    // Handler para preflight requests (CORS)
    app.options("/sse", async (req, reply) => {
        const origin = req.headers.origin || '*';
        reply.header('Access-Control-Allow-Origin', origin);
        reply.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key');
        reply.header('Access-Control-Allow-Credentials', 'true');
        reply.header('Access-Control-Max-Age', '86400');
        reply.code(204).send();
    });

    // Endpoint de mensagens com melhor tratamento de erros
    app.post("/messages", async (req, reply) => {
        const sessionId = (req.query as any).sessionId;
        const session = sessions.get(sessionId);

        console.log(`[MCP] 📨 Mensagem recebida para sessão: ${sessionId?.slice(0, 8)}...`);

        if (!session) {
            console.warn(`[MCP] ⚠️ Sessão não encontrada: ${sessionId}`);
            return reply.code(404).send({
                error: "Session not found",
                message: "A sessão expirou ou é inválida. Reconecte via /sse"
            });
        }

        // Verificar se sessão ainda está ativa
        if ((session.transport as any).closed) {
            console.warn(`[MCP] ⚠️ Sessão fechada: ${sessionId}`);
            sessions.delete(sessionId);
            return reply.code(410).send({
                error: "Session closed",
                message: "A sessão foi fechada. Reconecte via /sse"
            });
        }

        // CORS headers
        const origin = req.headers.origin || '*';
        reply.header('Access-Control-Allow-Origin', origin);
        reply.header('Access-Control-Allow-Credentials', 'true');

        try {
            // O Fastify já consumiu o body do req.raw, então precisamos criar um
            // stream sintético para o SDK MCP poder ler o conteúdo
            const { Readable } = await import('node:stream');
            const bodyString = (req as any).mcpRawBody || JSON.stringify(req.body);
            const syntheticReq = Object.assign(
                Readable.from(bodyString),
                {
                    headers: req.raw.headers,
                    method: req.raw.method,
                    url: req.raw.url
                }
            );

            await session.transport.handlePostMessage(syntheticReq as any, reply.raw);
            console.log(`[MCP] ✅ Mensagem processada com sucesso`);
        } catch (err: any) {
            console.error(`[MCP] ❌ Erro ao processar mensagem:`, err.message, err.stack);
            if (!reply.raw.headersSent) {
                reply.code(500).send({
                    error: "Internal server error",
                    message: err.message
                });
            }
        }
    });

    // Handler OPTIONS para messages (CORS preflight)
    app.options("/messages", async (req, reply) => {
        const origin = req.headers.origin || '*';
        reply.header('Access-Control-Allow-Origin', origin);
        reply.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key');
        reply.header('Access-Control-Allow-Credentials', 'true');
        reply.header('Access-Control-Max-Age', '86400');
        reply.code(204).send();
    });

    // ENDPOINTS DE DESCOBERTA HTTP (para compatibilidade com n8n e outros clients)

    // Health check MCP
    app.get("/mcp/health", async (req, reply) => {
        reply.header('Access-Control-Allow-Origin', '*');
        reply.code(200).send({
            status: "healthy",
            server: "jogodobicho-mcp",
            version: "1.0.0",
            capabilities: ["tools"],
            endpoints: {
                sse: "/sse",
                messages: "/messages"
            }
        });
    });

    // Listar tools via HTTP (n8n verifica isso antes de conectar)
    app.get("/mcp/tools", async (req, reply) => {
        reply.header('Access-Control-Allow-Origin', '*');
        reply.header('Content-Type', 'application/json');

        const tools = [
            {
                name: "listar_resultados",
                description: "Lista últimos resultados do Jogo do Bicho",
                parameters: {
                    type: "object",
                    properties: {
                        data: { type: "string", description: "Data no formato YYYY-MM-DD" },
                        loterica: { type: "string", description: "Slug da lotérica (ex: pt-rio, federal, look-goias)" }
                    }
                }
            },
            {
                name: "listar_lotericas",
                description: "Lista todas as bancas/lotéricas disponíveis e seus slugs"
            },
            {
                name: "tabela_bichos",
                description: "Retorna a tabela completa de todos os 25 bichos e suas dezenas"
            },
            {
                name: "buscar_bicho",
                description: "Busca informações de um bicho pelo grupo (1-25) ou dezena (00-99)",
                parameters: {
                    type: "object",
                    properties: {
                        query: { type: "string", description: "Grupo (ex: 1) ou Dezena (ex: 01, 12)" }
                    },
                    required: ["query"]
                }
            },
            {
                name: "como_jogar",
                description: "Retorna instruções, regras e história do Jogo do Bicho",
                parameters: {
                    type: "object",
                    properties: {
                        secao: {
                            type: "string",
                            enum: ["regras", "tabela", "modalidades", "historia", "dicas"],
                            description: "Seção específica para ler (opcional)"
                        }
                    }
                }
            },
            {
                name: "calcular_numerologia",
                description: "Calcula os números da sorte baseados no nome usando numerologia cabalistica",
                parameters: {
                    type: "object",
                    properties: {
                        nome: { type: "string", description: "Nome completo para calcular os números da sorte" }
                    },
                    required: ["nome"]
                }
            },
            {
                name: "horoscopo_dia",
                description: "Retorna o horóscopo do dia com números da sorte para cada signo",
                parameters: {
                    type: "object",
                    properties: {
                        signo: { type: "string", description: "Nome do signo (ex: Áries, Touro, etc). Deixe vazio para todos." }
                    }
                }
            },
            {
                name: "listar_webhooks",
                description: "Lista todos os webhooks de notificação registrados"
            },
            {
                name: "criar_webhook",
                description: "Registra um novo webhook para receber resultados automaticamente",
                parameters: {
                    type: "object",
                    properties: {
                        url: { type: "string", description: "URL do webhook que receberá POST com os resultados" }
                    },
                    required: ["url"]
                }
            },
            {
                name: "deletar_webhook",
                description: "Remove um webhook pelo ID",
                parameters: {
                    type: "object",
                    properties: {
                        id: { type: "string", description: "UUID do webhook a ser removido" }
                    },
                    required: ["id"]
                }
            }
        ];

        reply.code(200).send({ tools });
    });

    // Endpoint OPTIONS para CORS preflight dos endpoints HTTP
    app.options("/mcp/health", async (req, reply) => {
        reply.header('Access-Control-Allow-Origin', '*');
        reply.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
        reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key');
        reply.code(204).send();
    });

    app.options("/mcp/tools", async (req, reply) => {
        reply.header('Access-Control-Allow-Origin', '*');
        reply.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
        reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key');
        reply.code(204).send();
    });

    // Endpoint stateless para execução direta (alternativa ao SSE)
    app.post("/mcp/execute", async (req, reply) => {
        reply.header('Access-Control-Allow-Origin', '*');
        reply.header('Content-Type', 'application/json');

        const body = req.body as any;
        const { name, arguments: args } = body;

        if (!name) {
            return reply.code(400).send({ error: "Tool name is required" });
        }

        console.log(`[MCP HTTP] Executando tool: ${name}`, args);

        try {
            // Executar a tool diretamente (simplificado)
            let result: any;

            if (name === "listar_lotericas") {
                result = db.prepare('SELECT slug, nome FROM lotericas ORDER BY nome').all();
            } else if (name === "tabela_bichos") {
                result = bichosData;
            } else if (name === "buscar_bicho") {
                const q = args?.query as string;
                if (!q) throw new Error("Query is required");
                const g = parseInt(q);
                result = (!isNaN(g) && g >= 1 && g <= 25) ? getBichoByGrupo(g) : getBichoByDezena(q.padStart(2, '0'));
                if (!result) throw new Error("Bicho não encontrado");
            } else {
                return reply.code(400).send({ error: `Tool ${name} not available in HTTP mode. Use SSE connection.` });
            }

            reply.code(200).send({
                success: true,
                result,
                tool: name
            });
        } catch (error: any) {
            console.error(`[MCP HTTP] Erro:`, error.message);
            reply.code(500).send({
                success: false,
                error: error.message
            });
        }
    });

    app.options("/mcp/execute", async (req, reply) => {
        reply.header('Access-Control-Allow-Origin', '*');
        reply.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
        reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key');
        reply.code(204).send();
    });

    // ==========================================
    // ENDPOINT /mcp - HTTP STREAMABLE TRANSPORT
    // ==========================================
    // Este endpoint suporta o transporte HTTP Streamable moderno do MCP
    // Aceita: GET (upgrade para SSE) ou POST (HTTP Streamable direto)

    let httpTransport: StreamableHTTPServerTransport | null = null;

    // Negociação de transporte no /mcp
    app.get("/mcp", async (req, reply) => {
        const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
        console.log(`[MCP Streamable] 🟢 Requisição GET /mcp de ${clientIp}`);

        // Headers CORS
        const origin = req.headers.origin || '*';
        reply.raw.setHeader('Access-Control-Allow-Origin', origin);
        reply.raw.setHeader('Access-Control-Allow-Credentials', 'true');

        // Headers SSE
        reply.raw.setHeader('Content-Type', 'text/event-stream');
        reply.raw.setHeader('Cache-Control', 'no-cache');
        reply.raw.setHeader('Connection', 'keep-alive');
        reply.raw.statusCode = 200;

        // Criar transporte SSE (fallback para clientes que não suportam HTTP Streamable)
        const sessionId = crypto.randomUUID();
        const transport = new SSEServerTransport("/mcp/messages", reply.raw);
        const actualSessionId = transport.sessionId;

        console.log(`[MCP Streamable] Session SSE: ${actualSessionId}`);

        const keepAliveInterval = setInterval(() => {
            try {
                if (reply.raw.writable && !reply.raw.writableEnded) {
                    reply.raw.write(':ping\n\n');
                }
            } catch (err) {
                clearInterval(keepAliveInterval);
                sessions.delete(actualSessionId);
            }
        }, 30000);

        sessions.set(actualSessionId, { transport, keepAliveInterval, createdAt: Date.now() });

        try {
            await server.connect(transport);
            console.log(`[MCP Streamable] ✅ Conectado: ${actualSessionId}`);
        } catch (err: any) {
            console.error(`[MCP Streamable] ❌ Erro:`, err.message);
            clearInterval(keepAliveInterval);
            sessions.delete(actualSessionId);
            return reply.code(500).send('Connection failed');
        }

        reply.raw.on('close', () => {
            console.log(`[MCP Streamable] 🔴 Fechado: ${actualSessionId}`);
            const session = sessions.get(actualSessionId);
            if (session?.keepAliveInterval) clearInterval(session.keepAliveInterval);
            sessions.delete(actualSessionId);
        });
    });

    // HTTP Streamable POST - Modo stateless moderno
    app.post("/mcp", async (req, reply) => {
        console.log(`[MCP Streamable] 📨 POST /mcp recebido`);
        console.log(`[MCP Streamable] Headers:`, req.headers);

        // Headers CORS
        const origin = req.headers.origin || '*';
        reply.header('Access-Control-Allow-Origin', origin);
        reply.header('Access-Control-Allow-Credentials', 'true');

        try {
            // Verificar se é uma mensagem JSON-RPC válida (request ou notification)
            const body = req.body as any;

            // Validação manual: aceita tanto requests (com id) quanto notificações (sem id)
            const isValidJSONRPC = body &&
                typeof body === 'object' &&
                body.jsonrpc === '2.0' &&
                typeof body.method === 'string';

            if (!isValidJSONRPC) {
                console.log(`[MCP Streamable] ⚠️ Body inválido:`, body);
                return reply.code(400).send({
                    jsonrpc: "2.0",
                    error: { code: -32600, message: "Invalid JSON-RPC message" },
                    id: body?.id || null
                });
            }

            console.log(`[MCP Streamable] JSON-RPC Request:`, JSON.stringify(body, null, 2));

            // Se ainda não temos transporte HTTP, criar
            if (!httpTransport) {
                console.log(`[MCP Streamable] 🆕 Criando novo transporte HTTP Streamable`);
                httpTransport = new StreamableHTTPServerTransport({
                    sessionIdGenerator: undefined // Stateless mode
                });
                await server.connect(httpTransport);
            }

            // Processar a requisição
            await httpTransport.handleRequest(req.raw, reply.raw, req.body);
            console.log(`[MCP Streamable] ✅ Requisição processada`);

        } catch (error: any) {
            console.error(`[MCP Streamable] ❌ Erro:`, error.message);
            if (!reply.raw.headersSent) {
                reply.code(500).send({
                    jsonrpc: "2.0",
                    error: { code: -32603, message: error.message },
                    id: null
                });
            }
        }
    });

    // DELETE para limpar sessão (quando usar sessions)
    app.delete("/mcp", async (req, reply) => {
        console.log(`[MCP Streamable] 🗑️ DELETE /mcp - Limpando recursos`);
        if (httpTransport) {
            await server.close();
            httpTransport = null;
        }
        reply.code(200).send({ status: "cleaned" });
    });

    // CORS preflight para /mcp
    app.options("/mcp", async (req, reply) => {
        reply.header('Access-Control-Allow-Origin', '*');
        reply.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
        reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key, Accept');
        reply.header('Access-Control-Allow-Credentials', 'true');
        reply.header('Access-Control-Max-Age', '86400');
        reply.code(204).send();
    });

    // Mensagens para sessões SSE do /mcp
    app.post("/mcp/messages", async (req, reply) => {
        const sessionId = (req.query as any).sessionId;
        const session = sessions.get(sessionId);

        console.log(`[MCP Streamable] 📨 POST /mcp/messages - Session: ${sessionId?.slice(0, 8)}...`);

        if (!session) {
            console.warn(`[MCP Streamable] ⚠️ Sessão não encontrada: ${sessionId}`);
            return reply.code(404).send({
                error: "Session not found",
                message: "Session expired or invalid"
            });
        }

        // Verificar se sessão ainda está ativa
        if ((session.transport as any).closed) {
            console.warn(`[MCP Streamable] ⚠️ Sessão fechada: ${sessionId}`);
            sessions.delete(sessionId);
            return reply.code(410).send({
                error: "Session closed",
                message: "Session was closed"
            });
        }

        const origin = req.headers.origin || '*';
        reply.header('Access-Control-Allow-Origin', origin);
        reply.header('Access-Control-Allow-Credentials', 'true');

        try {
            // Mesmo fix: criar stream sintético para o SDK
            const { Readable } = await import('node:stream');
            const bodyString = (req as any).mcpRawBody || JSON.stringify(req.body);
            const syntheticReq = Object.assign(
                Readable.from(bodyString),
                {
                    headers: req.raw.headers,
                    method: req.raw.method,
                    url: req.raw.url
                }
            );

            await session.transport.handlePostMessage(syntheticReq as any, reply.raw);
            console.log(`[MCP Streamable] ✅ Mensagem processada`);
        } catch (err: any) {
            console.error(`[MCP Streamable] ❌ Erro:`, err.message, err.stack);
            if (!reply.raw.headersSent) {
                reply.code(500).send({ error: "Internal error", message: err.message });
            }
        }
    });

    app.options("/mcp/messages", async (req, reply) => {
        reply.header('Access-Control-Allow-Origin', '*');
        reply.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
        reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key');
        reply.code(204).send();
    });

    console.log('[MCP] ✅ Servidor MCP inicializado com sucesso');
    console.log('[MCP] Endpoints SSE Legacy: GET /sse, POST /messages');
    console.log('[MCP] Endpoints HTTP Streamable: GET/POST/DELETE /mcp, POST /mcp/messages');
    console.log('[MCP] Endpoints HTTP Auxiliares: GET /mcp/health, GET /mcp/tools, POST /mcp/execute');
}
