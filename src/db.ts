import Database from 'better-sqlite3';
import path from 'path';
import { logger } from './utils/logger.js';

const dbPath = process.env.DATABASE_PATH || path.resolve('dev.db');

let db: Database.Database;

try {
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    logger.info('Database', `Conectado com sucesso: ${dbPath}`);
} catch (error: any) {
    logger.error('Database', `Erro ao conectar ao banco de dados: ${error.message}`);
    process.exit(1);
}

export default db;
