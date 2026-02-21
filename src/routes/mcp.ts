import { type FastifyInstance } from 'fastify';
import { BICHOS } from '../config/bichos.js';
import { LOTERICAS } from '../config/lotericas.js';
import { getResultados } from '../services/AmigosDoBichoService.js';
import { getPalpitesDia, getPremiadosDia } from '../services/ScraperService.js';
import { getDb } from '../database/schema.js';
import { todayStr } from '../utils/helpers.js';

interface McpTool {
    name: string;
    description: string;
    inputSchema: any;
}

const TOOLS: McpTool[] = [
    {
        name: 'tabela_bichos',
        description: 'Retorna a tabela completa dos 25 bichos do Jogo do Bicho com grupos e dezenas.',
        inputSchema: { type: 'object', properties: {} },
    },
    {
        name: 'listar_lotericas',
        description: 'Lista todas as lotéricas cadastradas com slugs, estados e horários de sorteio.',
        inputSchema: { type: 'object', properties: {} },
    },

    {
        name: 'resultados_por_data',
        description: 'Busca resultados de sorteio por data e/ou lotérica.',
        inputSchema: {
            type: 'object',
            required: ['data'],
            properties: {
                data: { type: 'string', description: 'Data no formato YYYY-MM-DD' },
                loterica: { type: 'string', description: 'Slug da lotérica (ex: pt-rio)' },
            },
        },
    },
    {
        name: 'palpites_do_dia',
        description: 'Retorna os palpites (previsões) do dia com grupos, milhares e centenas sugeridos.',
        inputSchema: {
            type: 'object',
            properties: { data: { type: 'string', description: 'Data YYYY-MM-DD (default: hoje)' } },
        },
    },
    {
        name: 'premiados_do_dia',
        description: 'Retorna os palpites que acertaram nos sorteios do dia.',
        inputSchema: {
            type: 'object',
            properties: { data: { type: 'string', description: 'Data YYYY-MM-DD (default: hoje)' } },
        },
    },
    {
        name: 'como_jogar',
        description: 'Explica as regras do Jogo do Bicho, modalidades de aposta e como funcionam os grupos.',
        inputSchema: { type: 'object', properties: {} },
    },
    {
        name: 'cotacoes',
        description: 'Retorna as cotações atuais (valores de pagamento) por modalidade de aposta.',
        inputSchema: { type: 'object', properties: {} },
    },
];

async function handleToolCall(name: string, args: any): Promise<any> {
    switch (name) {
        case 'tabela_bichos': return BICHOS;
        case 'listar_lotericas': return LOTERICAS;
        case 'resultados_por_data':
            if (!args?.data) throw new Error("Parâmetro 'data' é obrigatório");
            return getResultados(args.data, args?.loterica);
        case 'palpites_do_dia': return getPalpitesDia(args?.data || todayStr());
        case 'premiados_do_dia': return getPremiadosDia(args?.data || todayStr());
        case 'cotacoes': {
            const db = getDb();
            const rows = db.exec('SELECT modalidade, valor FROM cotacoes ORDER BY modalidade');
            return rows.length ? rows[0].values.map((r: any) => ({ modalidade: r[0], valor: r[1] })) : [];
        }
        case 'como_jogar':
            return {
                explicacao: 'O Jogo do Bicho possui 25 grupos de animais, cada um com 4 dezenas (00-99). As modalidades são: Milhar (4 dígitos), Centena (3 dígitos), Dezena (2 dígitos) e Grupo.',
                grupos: BICHOS.map(b => `${b.nome} (Grupo ${b.grupo}): ${b.dezenas.join(', ')}`),
            };
        default: throw new Error(`Tool "${name}" not found`);
    }
}

export async function registerMcpRoutes(app: FastifyInstance): Promise<void> {
    // SSE endpoint for persistent connection
    app.get('/mcp/sse', {
        schema: { tags: ['MCP Server'], summary: 'Conexão SSE para o MCP Server' }
    }, async (req, reply) => {
        reply.raw.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*',
        });

        // Send initial capabilities
        const capabilities = {
            jsonrpc: '2.0',
            method: 'notifications/initialized',
            params: {
                serverInfo: { name: 'amigos-do-bicho-mcp', version: '1.0.0' },
                capabilities: { tools: {} },
            },
        };
        reply.raw.write(`data: ${JSON.stringify(capabilities)}\n\n`);

        // Keepalive
        const interval = setInterval(() => {
            reply.raw.write(`: keepalive\n\n`);
        }, 30000);

        req.raw.on('close', () => {
            clearInterval(interval);
        });
    });

    // JSON-RPC message endpoint
    app.post('/mcp/message', {
        schema: { tags: ['MCP Server'], summary: 'Endpoint de mensagens JSON-RPC do MCP' }
    }, async (req, reply) => {
        const body = req.body as any;
        const { id, method, params } = body;

        try {
            switch (method) {
                case 'initialize':
                    return {
                        jsonrpc: '2.0', id,
                        result: {
                            protocolVersion: '2024-11-05',
                            serverInfo: { name: 'amigos-do-bicho-mcp', version: '1.0.0' },
                            capabilities: { tools: { listChanged: false } },
                        },
                    };

                case 'tools/list':
                    return {
                        jsonrpc: '2.0', id,
                        result: { tools: TOOLS },
                    };

                case 'tools/call': {
                    const toolName = params?.name;
                    const toolArgs = params?.arguments || {};
                    const result = await handleToolCall(toolName, toolArgs);
                    return {
                        jsonrpc: '2.0', id,
                        result: {
                            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
                        },
                    };
                }

                default:
                    return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } };
            }
        } catch (err: any) {
            return { jsonrpc: '2.0', id, error: { code: -32603, message: err.message } };
        }
    });
}
