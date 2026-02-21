import { initDatabase, getDb, saveDatabase } from './src/database/schema.js';
import { log } from './src/utils/Logger.js';

async function migrateResultados() {
    await initDatabase();
    const db = getDb();

    log.info('MIGRATE', 'Iniciando migração da tabela resultados...');

    db.run('BEGIN TRANSACTION');
    try {
        db.run(`
            CREATE TABLE IF NOT EXISTS resultados_new (
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
            INSERT INTO resultados_new (id, data, horario, loterica_slug, created_at)
            SELECT id, data, horario, loterica_slug, created_at FROM resultados
        `);

        db.run('DROP TABLE resultados');
        db.run('ALTER TABLE resultados_new RENAME TO resultados');

        db.run('COMMIT');
        saveDatabase();
        log.success('MIGRATE', 'Tabela resultados migrada com sucesso. Coluna nome_original adicionada.');
    } catch (err: any) {
        db.run('ROLLBACK');
        log.error('MIGRATE', 'Erro na migração:', err.message);
    }
}

migrateResultados();
