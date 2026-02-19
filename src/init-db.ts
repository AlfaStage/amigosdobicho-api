import db from './db.js';
import { LOTERIAS } from './config/loterias.js';
import { logger } from './utils/logger.js';

const schema = `
  CREATE TABLE IF NOT EXISTS lotericas (
    id TEXT PRIMARY KEY,
    slug TEXT UNIQUE NOT NULL,
    nome TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS resultados (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    horario TEXT NOT NULL,
    loterica_slug TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(data, horario, loterica_slug)
  );

  CREATE TABLE IF NOT EXISTS premios (
    id TEXT PRIMARY KEY,
    resultado_id TEXT NOT NULL,
    posicao INTEGER NOT NULL,
    milhar TEXT NOT NULL,
    grupo INTEGER NOT NULL,
    bicho TEXT NOT NULL,
    FOREIGN KEY(resultado_id) REFERENCES resultados(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS horoscopo_diario (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    signo TEXT NOT NULL,
    texto TEXT,
    numeros TEXT,
    UNIQUE(data, signo)
  );

  CREATE TABLE IF NOT EXISTS webhooks (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Tabela para histórico de disparos de webhooks
  CREATE TABLE IF NOT EXISTS webhook_logs (
    id TEXT PRIMARY KEY,
    webhook_id TEXT NOT NULL,
    event TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT NOT NULL, -- 'success' ou 'error'
    status_code INTEGER,
    response_body TEXT,
    error_message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(webhook_id) REFERENCES webhooks(id) ON DELETE CASCADE
  );

  -- Tabela para configurar quais lotéricas disparam em cada webhook
  CREATE TABLE IF NOT EXISTS webhook_lotericas (
    id TEXT PRIMARY KEY,
    webhook_id TEXT NOT NULL,
    loterica_slug TEXT NOT NULL,
    enabled BOOLEAN DEFAULT 1,
    FOREIGN KEY(webhook_id) REFERENCES webhooks(id) ON DELETE CASCADE,
    UNIQUE(webhook_id, loterica_slug)
  );

  -- Tabela de proxies para scraping
  CREATE TABLE IF NOT EXISTS proxies (
    id TEXT PRIMARY KEY,
    protocol TEXT NOT NULL DEFAULT 'http',
    host TEXT NOT NULL,
    port INTEGER NOT NULL,
    username TEXT,
    password TEXT,
    label TEXT,
    source TEXT NOT NULL DEFAULT 'Manual',
    country TEXT DEFAULT 'BR',
    enabled BOOLEAN DEFAULT 1,
    alive BOOLEAN DEFAULT 0,
    latency_ms INTEGER,
    score INTEGER DEFAULT 50,
    last_tested_at DATETIME,
    last_used_at DATETIME,
    last_error TEXT,
    success_count INTEGER DEFAULT 0,
    error_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(host, port)
  );

  -- Índices para melhorar performance
  CREATE INDEX IF NOT EXISTS idx_resultados_data ON resultados(data);
  CREATE INDEX IF NOT EXISTS idx_resultados_loterica_slug ON resultados(loterica_slug);
  CREATE INDEX IF NOT EXISTS idx_resultados_horario ON resultados(horario);
  CREATE INDEX IF NOT EXISTS idx_resultados_composite ON resultados(data, loterica_slug, horario);
  CREATE INDEX IF NOT EXISTS idx_premios_resultado_id ON premios(resultado_id);
  CREATE INDEX IF NOT EXISTS idx_horoscopo_data ON horoscopo_diario(data);
  CREATE INDEX IF NOT EXISTS idx_horoscopo_signo ON horoscopo_diario(signo);
  CREATE INDEX IF NOT EXISTS idx_webhook_logs_webhook_id ON webhook_logs(webhook_id);
  CREATE INDEX IF NOT EXISTS idx_webhook_logs_created_at ON webhook_logs(created_at);
  CREATE INDEX IF NOT EXISTS idx_webhook_lotericas_webhook_id ON webhook_lotericas(webhook_id);

  -- Tabelas para Palpites do Dia
  CREATE TABLE IF NOT EXISTS palpites_dia (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS palpites_grupos (
    id TEXT PRIMARY KEY,
    palpite_id TEXT NOT NULL,
    bicho TEXT NOT NULL,
    grupo INTEGER NOT NULL,
    dezenas TEXT NOT NULL,
    FOREIGN KEY(palpite_id) REFERENCES palpites_dia(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS palpites_milhares (
    id TEXT PRIMARY KEY,
    palpite_id TEXT NOT NULL,
    numero TEXT NOT NULL,
    FOREIGN KEY(palpite_id) REFERENCES palpites_dia(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS palpites_centenas (
    id TEXT PRIMARY KEY,
    palpite_id TEXT NOT NULL,
    numero TEXT NOT NULL,
    FOREIGN KEY(palpite_id) REFERENCES palpites_dia(id) ON DELETE CASCADE
  );

  -- Tabelas para Bingos do Dia (Resultados Premiados)
  CREATE TABLE IF NOT EXISTS bingos_dia (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS bingos_premios (
    id TEXT PRIMARY KEY,
    bingo_id TEXT NOT NULL,
    tipo TEXT NOT NULL, -- 'milhar', 'centena', 'grupo'
    numero TEXT NOT NULL,
    extracao TEXT NOT NULL,
    premio TEXT NOT NULL,
    FOREIGN KEY(bingo_id) REFERENCES bingos_dia(id) ON DELETE CASCADE
  );

  -- Tabela para Cotações
  CREATE TABLE IF NOT EXISTS cotacoes (
    id TEXT PRIMARY KEY,
    modalidade TEXT NOT NULL UNIQUE,
    valor TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_palpites_data ON palpites_dia(data);
  CREATE INDEX IF NOT EXISTS idx_bingos_data ON bingos_dia(data);
  CREATE INDEX IF NOT EXISTS idx_cotacoes_modalidade ON cotacoes(modalidade);
  -- Tabelas para Templates Editáveis (Resultados e Bingos)
  CREATE TABLE IF NOT EXISTS templates (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL UNIQUE, -- 'resultado', 'bingo', 'palpite'
    name TEXT NOT NULL,
    html_content TEXT NOT NULL, -- HTML com placeholders {{...}}
    css_content TEXT, -- CSS opcional
    width INTEGER DEFAULT 1080,
    height INTEGER DEFAULT 1080,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Inserir templates padrão se não existirem
  INSERT OR IGNORE INTO templates (id, type, name, html_content, width, height) VALUES 
  ('tpl_default_resultado', 'resultado', 'Template Padrão Resultado', '<div style="background:#fff; padding:20px;"><h1>{{loterica}} - {{horario}}</h1><ul>{{#premios}}<li>{{posicao}}º {{milhar}} - {{bicho}}</li>{{/premios}}</ul></div>', 1080, 1080),
  ('tpl_default_bingo', 'bingo', 'Template Padrão Bingo', '<div style="background:#00ff00; padding:20px;"><h1>BINGO! {{loterica}}</h1><p>Acertamos: {{acertos}}</p></div>', 1080, 1080);
`;

logger.info('InitDB', 'Inicializando banco de dados...');
db.exec(schema);

// Inserir lotéricas do arquivo de configuração
for (const loteria of LOTERIAS) {
  db.prepare('INSERT OR IGNORE INTO lotericas (id, slug, nome) VALUES (?, ?, ?)')
    .run(loteria.id, loteria.slug, loteria.nome);
}
logger.info('InitDB', `Lotericas verificadas: ${LOTERIAS.length}`);

logger.success('InitDB', 'Banco de dados inicializado com sucesso!');
// NOTA: Não fechamos a conexão aqui pois ela é compartilhada com a aplicação
// A conexão será gerenciada pelo ciclo de vida da aplicação
