// @ts-ignore
import initSqlJs, { type Database } from 'sql.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { log } from '../utils/Logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DB_PATH = join(__dirname, '..', '..', 'db.sqlite');

let db: Database;

export async function initDatabase(): Promise<Database> {
  const SQL = await initSqlJs();

  if (existsSync(DB_PATH)) {
    const buffer = readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.run('PRAGMA foreign_keys = ON;');
  db.run('PRAGMA journal_mode = WAL;');

  createTables();

  saveDatabase();

  log.success('DB', 'SQLite inicializado com sucesso');
  return db;
}

export function getDb(): Database {
  if (!db) throw new Error('Database not initialized. Call initDatabase() first.');
  return db;
}

export function saveDatabase(): void {
  const data = db.export();
  const buffer = Buffer.from(data);
  writeFileSync(DB_PATH, buffer);
}

function createTables(): void {
  // ============ BLOCO A: Núcleo de Resultados ============
  db.run(`
    CREATE TABLE IF NOT EXISTS lotericas (
      id TEXT PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      nome TEXT NOT NULL,
      estado TEXT NOT NULL,
      horarios TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS resultados (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      horario TEXT NOT NULL,
      loterica_slug TEXT NOT NULL,
      nome_original TEXT NOT NULL DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(data, horario, loterica_slug, nome_original),
      FOREIGN KEY (loterica_slug) REFERENCES lotericas(slug)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS premios (
      id TEXT PRIMARY KEY,
      resultado_id TEXT NOT NULL,
      posicao INTEGER NOT NULL CHECK(posicao BETWEEN 1 AND 10),
      milhar TEXT NOT NULL,
      grupo INTEGER NOT NULL CHECK(grupo BETWEEN 1 AND 25),
      bicho TEXT NOT NULL,
      FOREIGN KEY (resultado_id) REFERENCES resultados(id) ON DELETE CASCADE
    )
  `);

  // ============ BLOCO B: Palpites & Premiados ============
  db.run(`
    CREATE TABLE IF NOT EXISTS palpites_dia (
      id TEXT PRIMARY KEY,
      data TEXT UNIQUE NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS palpites_grupos (
      id TEXT PRIMARY KEY,
      palpite_id TEXT NOT NULL,
      bicho TEXT NOT NULL,
      grupo INTEGER NOT NULL,
      dezenas TEXT NOT NULL,
      FOREIGN KEY (palpite_id) REFERENCES palpites_dia(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS palpites_milhares (
      id TEXT PRIMARY KEY,
      palpite_id TEXT NOT NULL,
      numero TEXT NOT NULL,
      FOREIGN KEY (palpite_id) REFERENCES palpites_dia(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS palpites_centenas (
      id TEXT PRIMARY KEY,
      palpite_id TEXT NOT NULL,
      numero TEXT NOT NULL,
      FOREIGN KEY (palpite_id) REFERENCES palpites_dia(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS palpites_premiados (
      id TEXT PRIMARY KEY,
      palpite_id TEXT NOT NULL,
      tipo TEXT NOT NULL CHECK(tipo IN ('milhar', 'centena', 'grupo')),
      numero TEXT NOT NULL,
      extracao TEXT NOT NULL,
      premio TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (palpite_id) REFERENCES palpites_dia(id) ON DELETE CASCADE
    )
  `);

  // ============ BLOCO C: Webhooks ============
  db.run(`
    CREATE TABLE IF NOT EXISTS webhooks (
      id TEXT PRIMARY KEY,
      url TEXT UNIQUE NOT NULL,
      active INTEGER DEFAULT 1,
      consecutive_failures INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS webhook_lotericas (
      id TEXT PRIMARY KEY,
      webhook_id TEXT NOT NULL,
      loterica_slug TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      UNIQUE(webhook_id, loterica_slug),
      FOREIGN KEY (webhook_id) REFERENCES webhooks(id) ON DELETE CASCADE,
      FOREIGN KEY (loterica_slug) REFERENCES lotericas(slug)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS webhook_logs (
      id TEXT PRIMARY KEY,
      webhook_id TEXT NOT NULL,
      event TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('success', 'error')),
      status_code INTEGER,
      response_body TEXT,
      error_message TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (webhook_id) REFERENCES webhooks(id) ON DELETE CASCADE
    )
  `);

  // ============ BLOCO D: Proxies & Scraping ============
  db.run(`
    CREATE TABLE IF NOT EXISTS proxies (
      id TEXT PRIMARY KEY,
      host TEXT NOT NULL,
      port TEXT NOT NULL,
      protocol TEXT NOT NULL CHECK(protocol IN ('http', 'https', 'socks4', 'socks5')),
      source TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('manual', 'proxyscrape', 'geonode', '911proxy')),
      alive INTEGER DEFAULT 1,
      latency_ms INTEGER,
      score INTEGER DEFAULT 50 CHECK(score BETWEEN 0 AND 100),
      last_checked TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(host, port)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS scraping_status (
      id TEXT PRIMARY KEY,
      loterica_slug TEXT NOT NULL,
      data TEXT NOT NULL,
      horario TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'success', 'error', 'retrying')),
      tentativas INTEGER DEFAULT 0,
      ultimo_erro TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(loterica_slug, data, horario),
      FOREIGN KEY (loterica_slug) REFERENCES lotericas(slug)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS scraping_runs (
      id TEXT PRIMARY KEY,
      tipo TEXT NOT NULL,
      duracao_ms INTEGER,
      total_requisicoes INTEGER DEFAULT 0,
      total_sucesso INTEGER DEFAULT 0,
      total_erro INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // ============ BLOCO E: Templates & Cotações ============
  db.run(`
    CREATE TABLE IF NOT EXISTS templates (
      id TEXT PRIMARY KEY,
      type TEXT UNIQUE NOT NULL CHECK(type IN ('resultado', 'premiado_unitario', 'premiado_dia', 'palpite', 'cotacao')),
      name TEXT NOT NULL,
      html_content TEXT NOT NULL,
      css_content TEXT,
      width INTEGER DEFAULT 700,
      height INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS cotacoes (
      id TEXT PRIMARY KEY,
      modalidade TEXT UNIQUE NOT NULL,
      valor TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // ============ BLOCO EXTRA: Horóscopo ============
  db.run(`
    CREATE TABLE IF NOT EXISTS horoscopo (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      signo TEXT NOT NULL,
      texto TEXT NOT NULL,
      numeros TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(data, signo)
    )
  `);
}
