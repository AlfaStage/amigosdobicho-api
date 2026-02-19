import { AmigosDoBichoService } from './AmigosDoBichoService.js';
import db from '../db.js';
import { LOTERIAS } from '../config/loterias.js';
import { logger } from '../utils/logger.js';

export class StartupSyncService {
    private apiService = new AmigosDoBichoService();
    private serviceName = 'StartupSyncService';

    async sync(): Promise<void> {
        logger.info(this.serviceName, 'Verificando integridade dos resultados de hoje...');

        const today = new Date().toISOString().split('T')[0];

        const result = db.prepare('SELECT count(*) as count FROM resultados WHERE data = ?')
            .get(today) as { count: number };

        if (result.count === 0) {
            logger.warn(this.serviceName, 'Nenhum resultado encontrado para hoje. Buscando via API...');
            const states = ['SP', 'RJ', 'PB', 'RS', 'CE', 'BA', 'GO', 'MG', 'DF', 'PE', 'SE', 'RN', 'FEDERAL', 'NACIONAL'];
            await Promise.all(states.map(s => this.apiService.fetchResults(today, s)));
        } else {
            logger.info(this.serviceName, `Banco de dados para hoje já possui ${result.count} registros.`);
        }
    }
}
