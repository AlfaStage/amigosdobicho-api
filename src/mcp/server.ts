import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BICHOS } from '../config/bichos.js';
import { getAllLotericas } from '../services/LotericasService.js';
import { getResultados } from '../services/AmigosDoBichoService.js';
import { getPalpitesDia, getPremiadosDia } from '../services/ScraperService.js';
import { getDb } from '../database/schema.js';
import { todayStr } from '../utils/helpers.js';

export const mcpServer = new McpServer({
    name: "amigos-do-bicho-mcp",
    version: "1.0.0"
});

// Tools Registration
mcpServer.tool("tabela_bichos",
    "Retorna a tabela completa dos 25 bichos do Jogo do Bicho com grupos e dezenas.",
    {},
    async () => ({ content: [{ type: "text", text: JSON.stringify(BICHOS, null, 2) }] })
);

mcpServer.tool("listar_lotericas",
    "Lista todas as lotéricas cadastradas com slugs, estados e horários de sorteio.",
    {},
    async () => ({ content: [{ type: "text", text: JSON.stringify(getAllLotericas(), null, 2) }] })
);

mcpServer.tool("resultados_por_data",
    "Busca resultados de sorteio por data e/ou lotérica.",
    {
        data: z.string().describe("Data no formato YYYY-MM-DD"),
        loterica: z.string().optional().describe("Slug da lotérica (ex: pt-rio)")
    },
    async ({ data, loterica }) => {
        const res = getResultados(data, loterica);
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
    }
);

mcpServer.tool("palpites_do_dia",
    "Retorna os palpites (previsões) do dia com grupos, milhares e centenas sugeridos.",
    { data: z.string().optional().describe("Data YYYY-MM-DD (default: hoje)") },
    async ({ data }) => {
        const res = getPalpitesDia(data || todayStr());
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
    }
);

mcpServer.tool("premiados_do_dia",
    "Retorna os palpites que acertaram nos sorteios do dia.",
    { data: z.string().optional().describe("Data YYYY-MM-DD (default: hoje)") },
    async ({ data }) => {
        const res = getPremiadosDia(data || todayStr());
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
    }
);

mcpServer.tool("cotacoes",
    "Retorna as cotações atuais (valores de pagamento) por modalidade de aposta.",
    {},
    async () => {
        const db = getDb();
        const rows = db.exec('SELECT modalidade, valor FROM cotacoes ORDER BY modalidade');
        const res = rows.length ? rows[0].values.map((r: any) => ({ modalidade: r[0], valor: r[1] })) : [];
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
    }
);

mcpServer.tool("como_jogar",
    "Explica as regras do Jogo do Bicho, modalidades de aposta e como funcionam os grupos.",
    {},
    async () => {
        const res = {
            explicacao: 'O Jogo do Bicho possui 25 grupos de animais, cada um com 4 dezenas (00-99). As modalidades são: Milhar (4 dígitos), Centena (3 dígitos), Dezena (2 dígitos) e Grupo.',
            grupos: BICHOS.map(b => `${b.nome} (Grupo ${b.grupo}): ${b.dezenas.join(', ')}`),
        };
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
    }
);
