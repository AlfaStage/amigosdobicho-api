# Arquitetura do Sistema - Jogo do Bicho API

## Visão Geral
Esta API foi desenvolvida para fornecer resultados do Jogo do Bicho em tempo real, horóscopo, numerologia e integração com agentes de IA via MCP (Model Context Protocol).

## Estrutura de Diretórios
- `/src/routes`: Definição dos endpoints Fastify.
- `/src/services`: Lógica de negócio e coordenação de tarefas.
- `/src/scrapers`: Coleta de dados de fontes externas (O Jogo do Bicho, GigaBicho, etc.).
- `/src/mcp`: Implementação do servidor MCP para n8n e outras interfaces.
- `/public`: Arquivos estáticos e painel administrativo.

## Segurança
- O sistema utiliza autenticação via header `x-api-key`.
- As rotas `/docs`, `/health` e `/public` são abertas.
- As rotas `/v1/*` e `/admin/*` requerem autenticação.

## Banco de Dados
- Utiliza SQLite (`dev.db`).
- O schema é inicializado automaticamente pelo script `src/init-db.ts` no startup.

## Serviços em Segundo Plano
- `CronService`: Gerencia os horários de scraping e atualizações diárias de horóscopo.
- `StartupSyncService`: Garante que os dados do dia atual estejam presentes ao iniciar o servidor.
