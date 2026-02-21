import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { mcpServer } from './mcp/server.js';
import { getDb } from './database/schema.js';

// Inicializa dependências globais ou do BD se necessário
// Em modo STDIO, ele roda num processo isolado, então é importante garantir
// que o SQLite (getDb) esteja saudável e acessível.
getDb();

async function run() {
    const transport = new StdioServerTransport();
    await mcpServer.connect(transport);
    console.error("Amigos do Bicho MCP Server rodando via STDIO!");
}

run().catch(console.error);
