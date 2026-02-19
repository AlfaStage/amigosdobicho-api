# Plano de Refatoração e Expansão

Atendendo aos requisitos: 1) Remover mocks (Scraping ou Cálculo real) e 2) MCP via rede (SSE) para n8n.

## 1. Arquitetura de Dados Reais

### Horóscopo (Scraping Diário)
- **Fonte:** `https://www.ojogodobicho.com/{signo}.htm` (ex: aries.htm)
- **Dados:** Texto "Características" (ou previsão se houver) e "Números da sorte para hoje".
- **Estratégia:**
    - Criar `HoroscopoScraper`: Itera os 12 signos.
    - Armazenamento: Tabela `horoscopo_diario` (data, signo, texto, numeros).
    - API: `GET /v1/horoscopo` consulta o banco.

### Numerologia (Cálculo Real)
- **Fonte Base:** Tabela Pitagórica descrita em `numerologia.htm`.
- **Lógica:** Implementar classe `NumerologyService`.
    - Input: Nome completo e/ou Data.
    - Processamento: Mapa de letras para números, soma reducionista (1-9).
    - API: `GET /v1/numerologia?nome=João&data=1990-01-01`
    - Retorno: Número da Motivação, Impressão, Expressão e Destino.

### Como Jogar (Scraping Estático)
- **Fonte:** `https://www.ojogodobicho.com/historia.htm`.
- **Estratégia:** `ContentScraper` busca o texto HTML, converte para Markdown ou mantém HTML limpo.
- **Armazenamento:** Cache em memória ou Arquivo (já que muda raramente).

## 3. Webhooks (Notificações em Tempo Real)
Para notificar o n8n ou outros sistemas quando novos resultados saírem.
- **Tabela:** `webhooks` (id, url, created_at).
- **Trigger:** No `OjogodobichoScraper`, ao detectar e inserir um novo registro com sucesso.
- **Payload:**
  ```json
  {
    "event": "novo_resultado",
    "timestamp": "2024-01-30T10:00:00Z",
    "data": {
      "loterica": "PT-RIO",
      "horario": "11:00",
      "data": "2024-01-30",
      "premios": [...]
    }
  }
  ```
- **API de Gestão:** `POST /v1/webhooks` (registrar), `DELETE /v1/webhooks/:id`.

## 4. MCP Server via SSE (Server-Sent Events)
Para integração com n8n, o servidor MCP deve ser acessível via HTTP/SSE.
- **Implementação:** `src/mcp/server-sse.ts`
- **Stack:** `express` + `@modelcontextprotocol/sdk/server/sse.js`.
- **Endpoint:** `GET /sse` (handshake) e `POST /messages`.
- **Integração:** Reutilizar as Tools definidas no stdio, mas expostas via adaptador SSE.

## 5. Plano de Execução

### Fase 5.1: Database & Scrapers
- [ ] Atualizar schema `init-db.js` (tabelas `horoscopos` e `webhooks`).
- [ ] Implementar `HoroscopoScraper` (Real / Aries...Peixes).
- [ ] Implementar `ContentScraper` (História).
- [ ] Implementar `NumerologyService` (Tabela Pitagórica).

### Fase 5.2: Webhook Core
- [ ] Implementar `WebhookService` (disparo de POSTs).
- [ ] Integrar `WebhookService` no `OjogodobichoScraper`.

### Fase 5.3: API Update
- [ ] Rotas Horóscopo (DB).
- [ ] Rotas Numerologia (Service).
- [ ] Rotas Webhooks (CRUD).
- [ ] Rotas Como Jogar (Content).

### Fase 5.4: MCP SSE & Verificação
- [ ] Criar `src/mcp/server-sse.ts` (Express).
- [ ] Teste E2E (Scraper -> Webhook -> Log).
