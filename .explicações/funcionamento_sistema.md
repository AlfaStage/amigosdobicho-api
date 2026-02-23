# 📖 O Grande Grimório: Arquitetura e Engenharia do Sistema Amigos do Bicho

Este documento serve como a **"Bíblia Técnica Definitiva"** do ecossistema Amigos do Bicho. A profundidade dos detalhes contidos aqui foi projetada especificamente para permitir que qualquer engenheiro de software (ou outra Inteligência Artificial) reconstrua a plataforma do zero, replicando com perfeição centímetro por centímetro de código, banco de dados, fluxos de cron e comportamentos de API.

---

## 🏛️ 1. Arquitetura Macroscópica

O sistema é dividido em **Quatro Camadas Principais**:
1.  **Motor de Persistência (Banco SQLite)**: Altamente otimizado, relacional e estruturado para suportar milhões de leituras e manter o histórico inviolável dos sorteios brasileiros.
2.  **Cérebro Autônomo (Background Workers)**: Serviços que despertam baseados em um relógio interno (Cron), executam raspar de dados, cálculos estatísticos e se desligam para economizar memória (Stateless design).
3.  **Portas de Exibição (Fastify API & Admin React)**: A interface de consumo dos dados de forma limpa (JSON), binária (Gerador de Imagens Satori) e visual (Dashboards de Gestão).
4.  **Interface de Agentes (MCP Server via SSE)**: Servidor integrado via Server-Sent Events (SSE) e HTTP Streamable, desenhado para conectar Inteligências Artificiais e LLMs diretamente aos dados e fluxos do sistema com latência mínima e streaming bidirecional.

---

## 💾 2. Banco de Dados: O Dicionário Relacional Absoluto

O sistema utiliza SQL com tabelas interdependentes. Se os dados não estiverem formatados exatamente desta maneira, a integridade da aplicação falha.

### Bloco A: Núcleo de Resultados
- **`lotericas`**: Catálogo imutável das fontes de sorteio.
  - `id` (String UUID) / `slug` (String, UNIQUE. O slug é a "vara de medição" do sistema. Ex: `pt-rio`, `look-goias`) / `nome` (String formatada pura).
- **`resultados`**: "Cabeçalho" de cada concurso.
  - `id` (UUID PK), `data` (String `YYYY-MM-DD` OBRIGATÓRIA), `horario` (String `HH:mm`), `loterica_slug` (FK). Possui restrição de unicidade na tríade `(data, horario, loterica_slug)`.
- **`premios`**: Detalhamento "filho" de um resultado.
  - `id` (UUID), `resultado_id` (Cadeia de FK ON DELETE CASCADE), `posicao` (Int 1 a 10), `milhar` (String "1234"), `grupo` (Int 01-25. Calculado matematicamente pelo final do milhar dividido por 4), `bicho` (String nominal. Ex: "Avestruz").

### Bloco B: Inteligência e Previsões (Palpites & Palpites Premiados)
- **`palpites_dia`**: O invólucro diário das apostas sugeridas pelo sistema.
  - `id` (UUID), `data` (UNIQUE).
- **`palpites_grupos`**: `palpite_id` (FK), `bicho` (String), `grupo` (Int), `dezenas` (String CSV. Ex: "13, 14, 15, 16").
- **`palpites_milhares` / `palpites_centenas`**: Liga o `palpite_id` a campos numéricos (String plana).
- **`premiados_dia` / `palpites_premiados`**: Sempre que um `resultado` oficial "der match" num `palpite_dia`, uma linha entra em `palpites_premiados` carimbando `tipo` (milhar/grupo), o `numero` que acertou, a `extracao` (Onde o prêmio saiu, ex: "PT Rio - 14h") e qual a `premio` (posição do acerto, ex: "1º Prêmio").

### Bloco C: Motor de Observabilidade (Webhooks)
- **`webhooks`**: Catálogo de assinantes.
  - `id` (UUID), `url` (String UNIQUE obrigatória).
- **`webhook_lotericas`**: O **Filtro Granular**. Tabela pivô contendo `webhook_id`, `loterica_slug` e o flag `enabled` (Booleano). Se o flag for 0, aquele webhook sofre "mute" silencioso quando essa lotérica tiver lançamento de resultado.
- **`webhook_logs`**: O histórico do carteiro. Armazena `status` (success/error), `status_code` (Ex: 200, 404), e o `response_body` / `error_message` bruto que o destino retornou para debug no admin.

### Bloco D: Rede Neural de Proxies e Monitoramento
- **`proxies`**: A teia de anonimato do sistema. Combina **entrada manual** (HTTP/HTTPS/SOCKS4/SOCKS5) e **coleta automática** via 3 APIs gratuitas (ProxyScrape, Geonode, 911Proxy) consultadas em `.explicações/proxys.md`.
  - Campos cruciais: `host`, `port`, `protocol` (enum: 'http', 'https', 'socks4', 'socks5'), `source` (enum: 'manual', 'proxyscrape', 'geonode', '911proxy'), `alive` (booleano dinâmico baseado no último teste), `latency_ms` (ping da rota), `score` (inteiro 0-100). Identidade única `(host, port)`.
  - **Varredura Horária**: A cada 1 hora, o sistema puxa listas das 3 APIs, adiciona novos proxies e testa todos os existentes contra um endpoint de validação. Proxies inativos ou que falharem no teste são **deletados** (purge). Somente os que passarem no teste permanecem.
- **`scraping_status`**: Tabela vital de tracking de estado. Garante que horários pendentes sejam reenfileirados. Possui o "status" com enum `('pending', 'success', 'error', 'retrying')`.
- **`scraping_runs`**: Grava os metadados agregados das rotinas, quantas requisições rodaram (duracao_ms) num disparo, para gerar gráficos administrativos.

### Bloco E: Componentes Audiovisuais (Design System)
- **`templates`**: O layout do PNG final armazenado no DB. Representa a injeção dos arquivos-base (`cotação_exemplo.html`, `palpite_premiado_exemplo.html` para os unitários, `palpite_premiado_dia_exemplo.html` para a lista diária agregada, `palpites_exemplo.html` e `resultados_exemplo.html`) no formato puro para customização na web.
  - `type` (UNIQUE: 'resultado', 'premiado_unitario', 'premiado_dia', 'palpite', 'cotacao').
  - `name`, `html_content` (texto massivo), `css_content`, `width`, `height`.
- **`cotacoes`**: Cadastro simples (`modalidade`, `valor`) exibindo os rendimentos estáticos da banca.

---

## 🛠️ 3. A Engenharia dos Serviços (Core Workers)

Os serviços (Services) gerenciam lógicas de negócio exclusivas sem sujar métodos de roteamento web.

### 3.1 Gerenciamento de Tempo e Política de Disparo Único
O sistema é governado por uma regra de **Execução Pontual**, proibindo terminantemente varreduras recorrentes ou contínuas fora dos gatilhos específicos.
*   **A Regra de Ouro:** Nenhuma rotina de captura ou chamada de interface externa pode ser recorrente por padrão. Elas operam como eventos isolados.
*   **Horário de Despertar (Manhã):**
    *   **Horóscopo:** Disparado uma única vez ao dia no início da manhã. Não se repete.
    *   **Palpites:** Disparado uma única vez ao dia no início da manhã, processando as predições para a data vigente.
*   **Resultados de Sorteios (Tempo Real):**
    *   A chamada de dados ocorre rigorosamente **1 minuto após** o horário previsto de cada sorteio individual. Como cada lotérica possui múltiplos horários ao longo do dia, o sistema dispara uma chamada única para cada um desses instantes.
*   **Protocolo de Contingência (Fallback de 10 Minutos):**
    *   Como última opção, caso a fonte de dados não entregue o resultado no momento cravado, o sistema entra em um estado temporário de **verificação a cada 10 minutos**.
    *   **Cessação Imediata:** Este ciclo de 10 minutos é interrompido no exato instante em que o resultado esperado é obtido e validado. O sistema encerra a varredura e retorna ao modo de espera silencioso até o sorteio seguinte.

### 3.2 AmigosDoBichoService: A Espinha Dorsal de Ingestão de Resultados
Como a ingestão via API foi solicitada, este serviço gerencia a ponte com `https://api.amigosdobicho.com/raffle-results`.
1.  **Mapeador Heurístico (`mapLotteryToSlug`)**: Como bancos externos usam nomenclaturas caóticas (ex: "MINAS DIA", "PT SP 13H"), existe um parser com IFs agressivos que "converte" a bagunça para os slugs rigorosos definidos no arquivo de configuração global de lotéricas. Ex: se estado for "rj" e palavra "pt", sempre cai no nosso slug imutável `pt-rio`.
2.  **Verificação de Unicidade Preemptiva**: Antes de transacionar e iniciar UUIDs para os prêmios, verifica no banco se `loterica_slug = X`, `data = Y` e `horario = Z` já existem. Se sim, descarta passivamente (return void).
3.  **Transação Atômica**: `insertResultado.run()` seguido pelo loop `insertPremio.run()`, fechados no método `.transaction()`. Se um prêmio falhar a tipagem, toda a lotérica dá rollback.
4.  **Enlaçamento Pós-commit**: O serviço emite *sinais de vida* chamando `WebhookService.notifyAll()` para o mundo afora e monitorando os `Palpites Premiados` para uso estatístico da casa.

### 3.3 RenderService: O Fabuloso Motor Gráfico Bidimensional
A conversão de puro "Texto + Dados" em "Arquivo Visual".
*   **A Base Documental**: O RenderService exige a ingestão inicial obrigatória dos 5 arquivos HTML de fundação localizados na raiz de documentação: `cotação_exemplo.html`, `palpite_premiado_exemplo.html`, `palpite_premiado_dia_exemplo.html`, `palpites_exemplo.html` e `resultados_exemplo.html`. Estes arquivos contêm as tags e o CSS in-line exatos necessários para o processador Node gerar a interface.
*   **A Regra Gêmea**: Sob NENHUMA circunstância a imagem final gerada (em suas dimensões, fontes, cores e espaçamentos) pode ser diferente da visualização Web pura dos arquivos exemplos. Absolutamente NADA de layout deve mudar; apenas injeção de resultados do DB em laço em substituição aos mocks de exemplo.
*   **Workflow Padrão do Motor**:
    1.  Traz a configuração salva via JSON combinada com o HTML do DB/FS (derivada dos exemplos estáticos citados acima).
    2.  **`renderHtml()` e Dinamismo**: Injeta variáveis dinâmicas no HTML bruto (via Mustache ou parsers AST). Em vez de recortes grotescos de Regex, o backend converte as tabelas de exemplo (as `<tr>` estáticas) num laço de iteração (ex: `{{#linhas}}`). O backend prepara os dados injetando lógicas visuais previamente calculadas, como a classe/estilo de "Efeito Zebra" (aplicando `background-color: #fafafa` apenas nos índices ímpares/pares dependendo do layout original).
    3.  A etapa milagrosa do **`inlineRemoteImages()`**: Encontra URLs externas estáticas, como o `background-image: url(...)` no cabeçalho ou tags `<img>`, faz o download (fetch) em background para um arrayBuffer e substitui a declaração na string HTML pelo formato nativo Data URI Base64. Sem essa conversão, a biblioteca de rasterização morreria falhando por restrições de cross-origin (CORS).
    4.  **Rasterização via Headless Browser**: Como bibliotecas SVG e VNode (`satori-html`) têm um limiar crítico com CSS complexo e falham em features modernas, usamos uma instância viva mas oculta de web browser (como Puppeteer ou Playwright). Assumimos um Page/Context, setamos o **Viewport rigoroso com 700px de largura** fixo (altura dinâmica baseada no scroll height do HTML de resultado). Passamos o HTML/Base64 preenchido no DOM puro através do `page.setContent(...)`, e pedimos que a engine gere um Snapshot PNG completo da tela, retornando apenas os bytes absolutos da foto `page.screenshot()`.

### 3.4 WebhookService: Entregas Desacopladas Dinâmicas
Módulo desenhado contra perdas em caso de gargalos.
*   O envio passa através do `notifyAll(event, payload)`.
*   Possui filtro interno: Executa o loop via array de `webhooks`: checa `isLotericaEnabled()`. Se retornar falso (graças à tabela `webhook_lotericas`), o serviço dá `logger.debug(ignorado)` calado e skipa.
*   Envelopa com cabeçalho `X-Webhook-Event` padrão. Envolve em bloco Promise Catch registrando tudo via função `logWebhookDelivery`, onde até mesmo um erro no Axios que gera código HTTP (como um `403 Forbidden` devolvido por Cloudflare) entra seguro pelo SQLite do tipo nullable `status_code`. Todas as Promises processam paralelamente `Promise.allSettled`.
*   **Auto-Disable**: Após **N falhas consecutivas** (configurável, default 5), o webhook é automaticamente desativado (`active = 0` na tabela `webhooks`). O admin pode reativar manualmente via painel. A contagem de falhas consecutivas é armazenada no campo `consecutive_failures` e resetada para 0 a cada entrega bem-sucedida.

### 3.5 MCP Server Service: A Ponte de Inteligência Artificial
Integrado diretamente no ecossistema Fastify, este serviço transforma o Amigos do Bicho em uma API nativa para LLMs trabalharem autonomamente.
*   **Transporte SSE (Server-Sent Events):** Diferente da API REST pura, a conexão inicial exige handshake SSE permitindo push assíncrono do servidor para o Agent (Mão-dupla via `/mcp/message`).
*   **Streaming Content:** Preparado para devolver fluxos contantes de dados (Streaming HTTP), essencial para queries grandes do banco SQLite sem estourar o limite de tempo do LLM ou dar timeout em ferramentas externas (ex: n8n, Claude).
*   **Declaração de Tooling:** O serviço injeta as rotas da API REST como "Ferramentas" (Tools) compreensíveis para IAs (ex: `tabela_bichos`, `listar_lotericas`, `como_jogar`), convertendo os outputs de JSON cru para Textos/Markdown digeríveis em prompt context.

---

## 🕷️ 4. Anatomia dos Motores de Dados (Como, Onde e Quando)

A ingestão de dados ocorre através de chamadas de API rigorosamente cronometradas ou através de raspagem clássica do DOM (Web Scraping). 

### 4.1 A Dinâmica de Horários e Extração de Resultados Oficiais
O coração do sistema pulsa em consonância com as bancas do país. Diferente de um crawler cego, o sistema é **Determinístico e Pontual**.
*   **Onde é raspado:** A ponte oficial é `https://api.amigosdobicho.com/raffle-results/filter`.
    *   **Nota sobre Parâmetros:** O campo `state` deve ser preenchido exclusivamente com um dos seguintes valores: `DF`, `BA`, `GO`, `MG`, `PB`, `RJ`, `SP` ou `NA` (para Loteria Nacional). Não devem ser usados outros teores para este parâmetro.
*   **Como os horários são definidos:** Existe um mapa canônico persistido na configuração central do sistema. Exemplo: O slug `pt-rio` possui o array local de `horarios: ['11:20', '14:20']`.
*   **Como o sistema sabe a hora de buscar (Smart Scheduler):** O serviço agendador não varre a API pedindo "o que você tem de novo?". A cada *1 minuto* da vida do servidor, ele varre a lista de todas as lotéricas ativas. Ele extrai os horários previstos, quebra a string `HH:mm` e transforma num timestamp do dia atual. Em seguida, ele adiciona cirurgicamente **1 minuto de delay** (`DELAY_MS = 60 * 1000`). Se a subtração do tempo atual contra o horário previsto (com delay) cair em uma janela menor que 5 minutos, ele emite a ordem de busca. Isso impede consumo de recursos em horas vazias, focando energia apenas quando os sorteios acabaram de ocorrer.
*   **Mecânica de Retry:** Se ao disparar 1 minuto após o jogo o resultado não estiver disponível:
    1. O sistema agenda uma nova tentativa para dali a 10 minutos.
    2. Esse ciclo de 10 em 10 minutos persiste como "última opção".
    3. No momento em que a API retorna o JSON válido e o sistema salva o resultado, o status da tarefa muda para 'success' e o loop de 10 minutos cessa para aquela extração.

### 4.2 O Módulo de Cotações Financeiras
As expectativas de ganho para bancas e jogadores são mapeadas dinamicamente.
*   **A Origem:** Extraído de `https://www.resultadofacil.com.br/cotacao-do-jogo-do-bicho`.
*   **A Lógica de Raspagem:** O script entra na página usando a biblioteca assíncrona `cheerio`. O parser procura todas as tags `<h3...>` no HTML. O h3 revela o nome da Modalidade (Ex: "Milhar"). Em seguida, o algoritmo navega na árvore lateral do DOM (siblings/parents) caçando o primeiro nó de texto (seja `<p>` ou `<span>`) que contenha a substring mágica `"R$"`. Assim que acha, emparelha o H3 com o R$ e salva na tabela `cotacoes`.

### 4.3 O Módulo de Palpites do Dia
Diariamente as 07:00 da manhã, o oráculo desperta para sua **única execução diária**.
*   **A Origem:** Extraído de `https://www.resultadofacil.com.br/palpites-do-dia`.
*   **Como o Bicho é capturado:** O motor busca qualquer pedaço de texto no site que case com a expressão nativa Match: `/([A-ZÀ-ÿa-zÀ-ÿ]+)\s*-\s*Grupo\s*(\d+)/i`. Isso captura algo como `"Borboleta - Grupo 4"`. O robô então olha os nós irmãos procurando a palavra-chave "Dezenas:" para extrair o array final (13, 14, 15, 16).
*   **Como Milhar e Centena são capturados:** Ele procura os blocos visuais que gritam `"MILHAR DO DIA"`. Em seguida, aplica uma Regex crua `\b\d{4}\b` extraindo todos os números de 4 colunas consecutivas que o gerador soltou ali perto. Para a centena, foca no gatilho `"CENTENA DO DIA"` sacando números `\b\d{3}\b`.

### 4.4 O Módulo Astrológico (Horóscopo Diário)
Roda uma **única vez por dia** no início da manhã.
*   **A Origem:** Trazida de fontes oraculares web especializadas.
*   **A Mecânica de Texto:** Utiliza processamento de texto avançado (Regex) para isolar as predições de cada signo dentro do conteúdo bruto, ignorando ruídos visuais ou publicidade. Extrai uma lista de predições numéricas (até 14 unidades) e o texto interpretativo, consolidando as informações na base de dados para o dia corrente.

### 4.5 Cálculo Nativo Matemático: A Máquina de Numerologia
Além dos raspadores baseados na Web, o sistema detém inteligência autônoma no endpoint `/numerologia`.
*   **Como Funciona:** Emprega a lendária **Tabela Pitagórica Alfanumérica** estrita em memória interna.
  `A=1, B=2, C=3, D=4, E=5, F=6, G=7, H=8, I=9, J=1...` e assim recursivamente.
*   **Motor do Endpoint:** Ao receber o parâmetro `$nome="Maria da Silva"`, a API sanitiza o acento e ignora o espaço. Converte `M=4, A=1, R=9, I=9, A=1`. Realiza a soma de bytes (`4+1+9+9+1...`) e gera um total macro.
*   **A Redução Kármica:** O número "37" somado macro passa pelo loop redutor While de um único dígito (3 + 7 = 10 -> 1 + 0 = 1). Retorna então o LuckyNumber "1" com seu respectivo texto folclórico e o detentor final pode exibir esse output limpo.
---

## 🛜 5. Grande Catálogo de APIs e Endpoints (RESTful Map)
Todo o mapa da rede (Fastify) onde atua o cérebro com o mundo. *(Auth: Header `x-api-key)*

### 📊 Rotas do Consumidor (Frontend Público / Integradores)
*   `GET /v1/resultados`: Parâmetro obrigatório: `data` (e opcional `loterica`). Retorna todos os resultados daquele dia, em formato Array. Não há limite de quantidade por dia.
*   `GET /v1/resultados/:id/html`: Renderiza HTML vivo, usado no iFrame ou link de whatsapp.
*   `GET /v1/resultados/:id/image`: Devolve ImageMime (Content-Type: image/png), aciona Motor Gráfico. Retorna Buffer.
*   `GET /v1/lotericas`: A API responde o config estático map (`id`, `slug`, `estado`, `horarios`).
*   `GET /v1/bichos`: Entrega os 25 grupos ordenados e suas 100 dezenas pré-geradas no sistema de resposta.
*   `GET /v1/palpites/dia/:data`: Devolve os complexos arrays `grupos`, `milhares` e `centenas` da data.
*   `GET /v1/premiados`: Informa os matches ocorridos (hits de acertos no banco `palpites_premiados`).
*   `/palpites/html` e `/palpites/image`: O portal gráfico de palpites do dia.
*   `/premiados/:id/html` e `/premiados/:id/image`: Snapshot da tela unitária "Palpite Certo" de um hit específico (Baseado no `palpite_premiado_exemplo.html`).
*   `/premiados/dia/html` e `/premiados/dia/image`: Snapshot da tela "Palpites Premiados do Dia" com a grelha de todos os acertos agrupados (Baseado no `palpite_premiado_dia_exemplo.html`).
*   `GET /v1/horoscopo/:data`: Rota base de astrologia via signos num array.
*   `GET /v1/numerologia`: Requer QueryParams `nome`. Rota com cálculo algorítmico interno convertendo soma alfabética pitagórica no nome para extrair 5 números mágicos.
*   `GET /v1/cotacao`: Requer API array, informando `modalidade` e `valor` dos pagamentos de moedas.
*   `GET /v1/como-jogar`: Textos markdown compilados explicativos do fluxo do bicho e manual de jogabilidade via JSON.

### 🛑 Rotas de Painel Administrativo (Privadas Backoffice)
*   **Gestão Status**
    *   `GET /api/status/hoje`: Trilha KPI (`total_dia`, `sucesso`, `erro`, taxa). Chama `ScrapingStatusService`.
    *   `GET /api/status/painel`: Devolve a grelha de `total_horarios` por `loteria_slug`.
*   **Gestão Webhooks**
    *   `GET /v1/webhooks`: Array base com status do bot e array aninhado `.lotericas` dizendo habilitados false/true.
    *   `POST /v1/webhooks`: Add string base payload de URL, chama UUID generator.
    *   `POST /v1/webhooks/:id/test`: Aciona Evento Local Fantasma ("Teste De Conectividade"), bate via Axios no provedor atrelado gerando HTTP CODE resposta na malha pro admin ver cor verde ou vermelho sem exigir esperar um resultado.
    *   `GET /v1/webhooks/:id/historico`: Extração em `LIMIT 50` da `webhook_logs`.
    *   `PUT /v1/webhooks/:id/lotericas`: Permuta do array booleano na cross-table de ligação lotericas_webhooks.
*   **Gestão Templates Design No-Code**
    *   `GET /admin/api/template?type=cotacao|result|premiado_unitario|premiado_dia`: Leitura bruta do layout.
    *   `POST /admin/api/template?type=...`: Recebe corpo config. Aponta IO Save do JSON nativo + .HTML de fallback, destruindo a versão prévia inteiramente de modo replace.
    *   `POST /admin/api/preview?type=...`: Recebedor de string maliciosa HTML suja da interface textual. Bate no RenderService. Mockup dados (Fake Mocks como Resultado Federal Teste 10.000R$). Escala com resvg, repassa `base64` encapsulado com URI nativo `data:image/png;base64,.....`. O visualizador web carrega o IMG src reativa atemporalmente sem F5.

### 🤖 Rotas de Agentes IA (Model Context Protocol - MCP)
*   `GET /mcp/sse`: Rota de Handshake e abertura de túnel de eventos persistentes (text/event-stream) para o cliente MCP.
*   `POST /mcp/message`: Endpoint acoplado que recebe o JSON-RPC dos IAs contendo o payload do Tool a ser executado e cospe os blocos de dados transacionados no túnel SSE ativo.

---

## 🖥 6. Anatomia das Páginas do Admin (Frontend)

O painel admin (Injetado na raiz de rotas administrativas do servidor) contém o app client side que manipula todas as entranhas da API.

*   `page: Status Dashboard` (`/admin/status`): O grande monitor diário (Cards Vermelhos e Verdes). Dispara um Long-polling contínuo pra rota status trazendo listagem de sucessos/atrasos. Inclui **Ações Manuais** (Botões de Force Scrape) para disparar rotinas sob demanda (Loterias, Palpites, Horóscopo e Cotações). O core desta página é ser a observabilidade bruta.
*   `page: Proxy Flow` (`/admin/proxies`): Exige grid datatable customizado carregando `IP:Port`, Score progressivo em color bar (Verde > 80, Laranja > 40, Vermelho Dead), Ping Speed (Latency ms). Contém os Action Buttons (Play) para disparar force fetch contra a rede com spinner on block.
*   `page: Template Designer` (`/admin/template`): O "Photoshop". Contém Divisão Lateral Dupla (Split view). Um lado com tabs seletoras ("Resultado", "Premiado Unidade", "Premiados Dia", "Cotação", "Palpite"). A esquerda com form elements type-color (Color Picker Hex) para Bg e Highlight. Campo Type-Textarea do raw HTML. A direita abriga em `background-size: contain` e `background-position: center` a resposta binária base64 processada no momento do Keystroke (Debounce 500ms recomendado para não fundir a API render pipeline).
*   `page: Webhook Center` (`/admin/webhooks`): Modal Manager. Uma Listagem linear. Contém botão edit abrevincolando em UI os Checkboxes Select Loterias da Base Central list. Botão Azul "Teste de Fogo". Link Expansor clicável revelador da lista `webhook_logs` apresentando em Bloco `<pre>` cor preta fundo com a response payload pra fácil devtools de integração.
*   `page: Docs` (`/admin/docs`): O redirecionador amigável pra rota Swagger injetada via especificação OpenAPI.

---

## 🔗 7. Workflows Ponta a Ponta: Core Mechanics

### Workflow Alfa: A Chegada do Resultado Real (The Main Flow)
1.  **Gatilho Relógio**: O agendador de tarefas bate um dos horários fixos (ex: `14:21` - Hora Oficial). Sabe que a lotérica das 14:20 deve ter rodado.
2.  **Pull Externo**: O sistema delega a ordem para bater na API oficial passando o parâmetro de estado correspondente (ex: `state=RJ`).
    *   **Estados Válidos:** Somente `DF`, `BA`, `GO`, `MG`, `PB`, `RJ`, `SP` e `NA` (Nacional).
3.  **Filtragem Bruta**: Response valida Status 200 array populado. Se nulo ignora.
4.  **Processamento DB**: Encontra 5 premios milhar `7890`. `AmigosDoBichoService` invoca matemática animal (pega 90 -> vaca!).
5.  **Gravação & Integridade**: Inicia Transação Relacional. Injeta header único + Filhos no Array Batch.
6.  **Despertar Alertas Externos**: `WebhookService.notifyAll()` assume assíncrono. Carrega webhooks filtrando por regra da cross-table e dispara Array em MAP paralelos.
7.  **Despertar Alertas Internos (Palpites Premiados)**: `AmigosDoBichoService` chama de forma colateral o modulo responsável pelos premiados. O serviço monitor carrega Array diário das apostas e faz For Each. "Esse Milhar saiu na 1 posição RIO? Sim?". Grava prêmio. Registra na base e chama Webhook.
8.  **Silêncio**: Ciclo fecha, todos descartam buffer memória, servidor volta ao Sleep base na expectativa.

### Workflow Beta: O Processo "Template" Hot-Reload Dinâmico
1.  **Usuário Humano**: Abre a interface `/admin/template` escolhendo Aba 'Premiado Unidade'.
2.  **Modificação Visual**: Bota cor Hex `#FF0000` (Red) na caixinha lateral ou remove a linha do `div` na codearea.
3.  **Sync Transmissão**: App React compila um POST assíncrono. Body Payload `{html: '...', colors: {bg: '#ff0000'}}` mandado para o endpoint `/admin/api/preview?type=premiado_unitario`.
4.  **Cérebro Gráfico (Backend)**: Fastify recebe rota. Rota envia para `RenderService.renderGenericImage()`. Serviço aplica mock artificial da vitória, interpola HTML via replace ou lib Mustache, carrega motor React Satori + Base64 Fetch URL das imagens vinculadas, processa bytes SVG a raster, envelopa na URI Type String e devole com Code 200.
5.  **Feedback Instantâneo**: O Front atualiza localmente sem salvar disco rígido no HD principal para não sobreescrever arte original até o "Save Click".

### Workflow Charlie: O Sentinela Escudo Anti-Bot (Scrape Engine Failover)
 *(Utilizado unicamente nos raspadores de apoio colaterais, ou se um dia a API oficial cessar).*
1.  O serviço de extração percebe ausência de rede (ou bloqueio por WAF/Cloudflare).
2.  Ele reporta a falha e coloca o registro em modo de re-tentativa.
3.  O serviço de anonimato é acionado. Ele consulta no banco de dados a lista de proxies disponíveis, filtrando por aqueles que possuem melhor pontuação de confiança e menor latência.
4.  Com a nova identidade, o sistema remonta a requisição simulando navegadores modernos e tenta novamente o acesso através do datacenter remoto.
5.  Se fluir, o banco de dados credita pontos de sucesso para aquele endereço, garantindo que as melhores rotas sejam priorizadas em execuções futuras.

---

Este nível excruciante de detalhes sela este documento. Nenhuma camada, de banco de dados a renderização na tela, passa sem ser compreendida pela malha macro de fluxo sistêmico explicada acima. Ideal para rebuild integral.
