# Amigos do Bicho API 🐉

Bem-vindo ao repositório oficial da **API Amigos do Bicho**. Este projeto é o coração de todo o ecossistema moderno voltado para resultados, palpites, e inteligência de dados do Jogo do Bicho no Brasil.

## 🌟 Arquitetura V2 (Motor Autônomo)
O sistema foi recentemente atualizado para uma **arquitetura 100% dinâmica e adaptativa**:
- **Scraper Inteligente (Poller)**: Varre resultados passivamente de 5 em 5 minutos.
- **Auto-Aprendizado (Machine Learning Primitivo)**: Descobre novas lotéricas, horários e dias da semana automaticamente a partir dos retornos da API externa, gravando-os em um banco de dados **SQLite**.
- **Self-Healing e Expurgador Noturno**: Identifica horários extintos que falham sucessivamente por 7 dias e os remove do sistema.
- **Previsão Diária**: Monta dinamicamente a agenda de resultados esperados de cada dia, servindo de base para o Front-End monitorar as faltas.

## 🛠 Features Principais
- **API Pública e Fastify**: Entrega resultados ultrarrápidos, cotações e regras.
- **Gerenciador Massivo de Proxies**: Sistema robusto para adicionar, rastrear e classificar centenas de proxies para o Scraper funcionar com estabilidade total e rotatividade IP.
- **Palpites Inteligentes e Premiações**: Checa palpites recém-criados retroativamente contra qualquer resultado recebido no dia.
- **Sistema de Webhooks Avançado**: Comunica os clientes cadastrados em *Real-Time* sobre novos Resultados e Palpites Premiados.
- **MCP Server Oficial**: Totalmente acoplado com Inteligência Artificial. Oferece as ferramentas `Model Context Protocol` (`@modelcontextprotocol/sdk`).

## 🧠 Integração MCP (Model Context Protocol) 
A API expõe suas entranhas para IAs (como Cline ou n8n) entenderem as loterias, sugerirem palpites e analisarem horários do jogo.
Oferece transporte **DUPLO**:
1. **Padrão Remote (HTTP/SSE)**: Acessível em `http://localhost:3000/mcp/sse`. O n8n ou provedores externos podem ser plugados nessa rota para comunicação JSON-RPC over HTTP.
2. **Padrão Local (STDIO)**: Rodando via prompt limpo para agentes que residem no mesmo servidor. 
   ```bash
   npm run mcp:stdio
   ```

## 🚀 Como Rodar Localmente

**Pré-Requisitos**: Node.js 20+

1. Instale as dependências:
   ```bash
   npm install
   ```

2. Rode em modo de Desenvolvimento (Watch/Live Reload):
   ```bash
   npm run dev
   ```

3. Rodar em Ambiente de Produção (Buildando):
   ```bash
   npm run build
   npm start
   ```

O Banco de Dados **SQLite** será gerado automaticamente no arquivo persistente `db.sqlite` na raiz do repositório.

## 🐳 Deploy e Infraestrutura (EasyPanel / Docker)
O repositório está **Dockerizado** e com o `Dockerfile` otimizado. Ele baixa automaticamente instâncias enxutas do Chromium para o painel puppeteer e configura o ambiente.
- Ao hospedar no EasyPanel ou container similar, lembre-se de configurar um **Volume Local** persistente para o arquivo `db.sqlite`, do contrário as configurações de Loterias e histórico de Sorteios resetarão a cada deploy!

---
Desenvolvido para máxima performance e baixa manutenção. 🚀
