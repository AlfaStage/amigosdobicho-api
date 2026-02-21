import { initDatabase, getDb, saveDatabase } from './src/database/schema.js';
import { log } from './src/utils/Logger.js';

async function resetToday() {
    await initDatabase();
    const db = getDb();
    const data = '2026-02-21';

    log.info('RESET', `Iniciando reset para a data ${data}`);

    try {
        db.run('BEGIN TRANSACTION');

        // Limpa premiados de hoje
        db.run('DELETE FROM palpites_premiados WHERE data = ?', [data]);

        // Limpa resultados e prêmios em cascata
        db.run('DELETE FROM resultados WHERE data = ?', [data]);

        // Reseta o scraping_status para forçar nova busca
        db.run("UPDATE scraping_status SET status = 'pending', tentativas = 0 WHERE data = ?", [data]);

        db.run('COMMIT');
        saveDatabase();

        log.success('RESET', 'Dados de hoje limpos com sucesso. O cronjet agora poderá buscar novamente os dois sorteios da Look GO.');
    } catch (e: any) {
        db.run('ROLLBACK');
        log.error('RESET', 'Erro no reset: ' + e.message);
    }
}

resetToday();
