# Jogo do Bicho API & MCP Server 🚀

API robusta e alto desempenho para consulta de resultados do Jogo do Bicho, horóscopo, animais e numerologia. Inclui servidor MCP unificado para Agentes de IA e um Designer de Templates integrado.

## 🌟 Diferenciais

- **Scrapper Inteligente**: Poller que verifica resultados a cada 2 minutos apenas para sorteios pendentes.
- **Geração de Imagem**: Motor Satori integrado para gerar imagens PNG prontas para redes sociais (450px).
- **Designer de Template**: Dashboard administrativo para Customização de HTML/CSS em tempo real.
- **MCP Native**: Servidor SSE pronto para conectar com Claude, ChatGPT ou n8n.
- **Auto-Sincronização**: Ao iniciar, o sistema busca resultados faltantes de hoje e ontem automaticamente.

---

## 🚀 Instalação e Execução

### 1. Local (Desenvolvimento)
```bash
npm install
npm run dev
```
- **API**: [http://localhost:3002](http://localhost:3002)
- **Documentação Swagger**: [http://localhost:3002/docs](http://localhost:3002/docs)
- **Designer de Template**: [http://localhost:3002/admin/template](http://localhost:3002/admin/template)

### 2. Docker (Produção)
```bash
docker build -t jogodobicho-api .
docker run -p 3002:3002 -e API_KEY=sua_chave_aqui jogodobicho-api
```

### 3. Deploy no Easypanel
1. Crie um novo **App** no Easypanel.
2. No Source, aponte para o seu repositório GitHub.
3. No painel **Environment**, adicione:
   - `PORT`: 3002
   - `API_KEY`: sua_chave_secreta
4. O Easypanel detectará automaticamente o `Dockerfile` e fará o deploy.

---

## 📚 Endpoints (Exemplos CURL)

Todas as rotas (exceto publicas) requerem o header `x-api-key`.

### 1. Resultados
Busca resultados por data e lotérica.
```bash
curl -G "http://localhost:3002/v1/resultados" \
     -d "loterica=pt-rio" \
     -d "data=2026-02-03" \
     -H "x-api-key: SUA_CHAVE"
```

### 2. Lotéricas
Lista todas as bancas suportadas (PT Rio, Federal, Bahia, Look, etc).
```bash
curl "http://localhost:3002/v1/lotericas" -H "x-api-key: SUA_CHAVE"
```

### 3. Bichos (Grupos e Dezenas)
```bash
# Buscar bicho pelo grupo ou dezena (ex: 12 retorna Elefante e Burro)
curl "http://localhost:3002/v1/bichos/12" -H "x-api-key: SUA_CHAVE"
```

### 4. Horóscopo
```bash
curl "http://localhost:3002/v1/horoscopo" -H "x-api-key: SUA_CHAVE"
```

### 5. Numerologia
Gera números da sorte baseados no nome.
```bash
curl "http://localhost:3002/v1/numerologia?nome=Antigravity" -H "x-api-key: SUA_CHAVE"
```

---

## 🤖 MCP Server (Model Context Protocol)

O servidor MCP está disponível via **SSE** no endpoint `/sse`.
Para usar no Claude Desktop:
```json
{
  "mcpServers": {
    "jogodobicho": {
      "command": "npx",
      "args": ["@modelcontextprotocol/server-express", "http://seu-dominio.com/sse"]
    }
  }
}
```

## 🛠️ Tecnologias
- **Node.js 20+** & **TypeScript**
- **Fastify** (API de alta performance)
- **SQLite** (Better-SQLite3)
- **Satori** (Renderização de imagens via HTML/SVG)
- **Zod** (Validação e tipagem)
