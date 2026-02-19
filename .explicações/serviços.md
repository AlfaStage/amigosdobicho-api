# Serviços do Sistema

## CronService
- **Arquivo:** `src/services/CronService.ts`
- **Função:** Gerencia o agendamento de tarefas recorrentes.
- **Tarefas:**
  - `runSmartScheduler`: Loop de 5 minutos para buscar resultados pendentes.
  - `runHoroscopo6h`: Coleta diária de horóscopo às 06:00 BRT.
  - `runContent`: Atualização semanal de conteúdo estático.
- **Métodos Públicos:**
  - `start()`: Inicia todos os jobs.
  - `stop()`: Para todos os jobs de forma segura.
  - `checkHoroscopoOnStartup()`: Força verificação de horóscopo ao iniciar.

## WebhookService
- **Arquivo:** `src/services/WebhookService.ts`
- **Função:** Gerencia o registro e a notificação de webhooks de terceiros.

## RenderService
- **Arquivo:** `src/services/RenderService.ts`
- **Função:** Gera HTML e imagens (PNG) para compartilhamento de resultados usando Satori e Resvg.

## ProxyService
- **Arquivo:** `src/services/ProxyService.ts`
- **Função:** Gerencia pool de proxies para rotação durante scraping.
- **Funcionalidades:**
  - CRUD de proxies (individual e em massa)
  - Rotação round-robin e aleatória entre proxies habilitados
  - Parsing de múltiplos formatos: `http://user:pass@host:port`, `host:port:user:pass`, `host:port`
  - Tracking de sucesso/erro por proxy
  - Toggle de habilitação/desabilitação
  - Integrado automaticamente no `ScraperBase.fetchHtmlWithRetry()`
- **Rota Admin:** `/admin/proxies/*` (CRUD)
- **Página Admin:** `/admin/proxies-page` (Gerenciamento visual)
