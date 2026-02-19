# Sistema de Cotações (Odds)

Este módulo é responsável por extrair, armazenar e servir as cotações (odds) atualizadas para as diversas modalidades do Jogo do Bicho.

## 📁 Estrutura de Arquivos

- **Scraper**: `src/scrapers/CotacaoScraper.ts` - Lógica de extração baseada em Puppeteer.
- **Rota API**: `src/routes/cotacao.ts` - Endpoints para consulta e sincronização manual.
- **Configuração**: `.env` (variável `COTACAO_URL`).
- **Banco de Dados**: Tabela `cotacoes` (gerenciada via `src/init-db.ts`).

## 🚀 Como Funciona

### 1. Extração (Scraping)
O scraper navega até a URL configurada (atualmente `https://amigosdobicho.com/cotacoes`), interage com a página para revelar os valores e utiliza seletores CSS para extrair pares de `modalidade` e `valor`.

Como a página possui conteúdo dinâmico, o scraper utiliza o `BrowserScraper` (Puppeteer) com passos de navegação pré-configurados.

### 2. Armazenamento
Os dados são salvos na tabela `cotacoes`:
- `modalidade`: Nome da aposta (ex: "Milhar", "Grupo").
- `valor`: Valor da cotação (ex: "1x R$ 6.000,00").
- `updated_at`: Data e hora da última atualização.

É utilizado `ON CONFLICT(modalidade) DO UPDATE` para garantir que sempre tenhamos apenas a cotação mais recente para cada tipo.

### 3. Automação (Cron)
As cotações são atualizadas automaticamente:
- **Diariamente às 00:00**: Através do `CronService`.
- **Startup**: Ao iniciar o servidor, se as cotações do dia atual ainda não existirem.

## 🔌 Endpoints de API

### Listar Cotações
- **URL**: `/v1/cotacao`
- **Método**: `GET`
- **Autenticação**: Query param `key`.
- **Resposta**:
  ```json
  {
    "data": [
      {
        "modalidade": "Milhar",
        "valor": "1x R$ 6.000,00",
        "updated_at": "2026-02-13T17:49:03Z"
      },
      ...
    ]
  }
  ```

### Forçar Sincronização
- **URL**: `/v1/cotacao/sync`
- **Método**: `POST`
- **Descrição**: Aciona o processo de scraping imediatamente.
