# Plano de Implementação: API Jogo do Bicho & MCP Server

## 1. Visão Geral
Este projeto consiste em uma API robusta em Node.js para fornecer resultados do Jogo do Bicho, horóscopo, numerologia e informações sobre "como jogar". O sistema incluirá um servidor MCP (Model Context Protocol) para integração nativa com Agentes de IA e um sistema de coleta de dados (scraper) que armazena histórico em SQLite local.

## 2. Arquitetura
O sistema será modular, dividido em 3 camadas principais:
1.  **Coleta (Scrapers):** Jobs agendados para buscar dados das fontes (ojogodobicho.com, resultadofacil.com.br, etc.) e normalizá-los.
2.  **Armazenamento (SQLite):** Banco de dados local para persistência de histórico, lotéricas e dados estáticos (signos, bichos).
3.  **Interface (API & MCP):**
    *   **API REST (Fastify):** Endpoints HTTP protegidos por API Key, com Swagger.
    *   **Servidor MCP:** Interface para agentes de IA consultarem dados via ferramentas (Tools) e recursos (Resources).

### Tech Stack
*   **Runtime:** Node.js (TypeScript)
*   **Framework Web:** Fastify (Alta performance e suporte a plugins)
*   **Database:** SQLite (via Prisma)
*   **Scraping:** `axios` + `cheerio`
*   **MCP:** `@modelcontextprotocol/sdk`
*   **Doc:** Swagger (OpenAPI) via `@fastify/swagger`

## 3. Estrutura de Arquivos
```
jogodobicho-api/
├── src/
│   ├── config/          # Variáveis de ambiente, constantes
│   ├── controllers/     # Lógica dos endpoints da API
│   ├── scrapers/        # Lógica de extração de dados
│   ├── services/        # Lógica de negócio (Jogo, Numerologia, Horóscopo)
│   ├── mcp/             # Definição das Ferramentas e Recursos MCP
│   ├── routes/          # Definição das rotas HTTP
│   ├── jobs/            # Agendamento de scrapers (Cron)
│   ├── app.ts           # Entrypoint da aplicação
│   └── types/           # Tipos globais
├── prisma/
│   └── schema.prisma    # Esquema do banco de dados
├── docs/                # Documentação adicional
├── .env.example
├── README.md
└── package.json
```

## 4. Funcionalidades e Rotas

### 4.1. Autenticação
*   Middleware verificando header `x-api-key`.

### 4.2. Rotas de Resultados (`/v1/resultados`)
*   `GET /`: Lista resultados. Filtros: `data`, `loterica`.
*   `GET /lotericas`: Lista todas as lotéricas disponíveis.

### 4.3. Rotas de Bichos (`/v1/bichos`)
*   `GET /`: Lista tabela completa dos 25 bichos.
*   `GET /:query`: Busca por nome, grupo ou dezena.

### 4.4. Rotas de Conteúdo (`/v1/como-jogar`)
*   `GET /`: Lista tópicos disponíveis.
*   `GET /:topico`: Retorna markdown explicativo.

### 4.5. Rotas de Horóscopo (`/v1/horoscopo`)
*   `GET /`: Horóscopo do dia.
*   `GET /:signo`: Detalhes para um signo específico.

### 4.6. Rotas de Numerologia (`/v1/numerologia`)
*   `GET /`: Gera números da sorte baseados em parâmetros.

### 4.7. Interface MCP
**Tools:**
*   `consultar_resultados`
*   `listar_bichos`
*   `explicar_jogo`
*   `consultar_horoscopo`

## 5. Plano de Execução

### Fase 1: Setup
- [ ] Inicializar projeto Node.js + TypeScript + Fastify
- [ ] Configurar Prisma + SQLite
- [ ] Criar estrutura base de pastas

### Fase 2: Database e Scrapers
- [ ] Modelar schema Prisma (Resultados, Loterias, Signos)
- [ ] Criar scraper para ojogodobicho.com
- [ ] Criar job de atualização automática

### Fase 3: API REST
- [ ] Implementar rotas de Resultados e Lotericas
- [ ] Implementar rotas de Bichos e Conteúdo (Como Jogar)
- [ ] Implementar rotas de Horóscopo e Numerologia
- [ ] Configurar Swagger e API Key Auth

### Fase 4: MCP Server
- [ ] Integrar SDK MCP
- [ ] Mapear Tools para os Services existentes

### Fase 5: Finalização
- [ ] Preencher conteúdo estático ("Como Jogar", Signos)
- [ ] Documentação (README.md)
- [ ] Testes Finais
