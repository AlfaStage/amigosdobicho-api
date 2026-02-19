
import { AmigosDoBichoService } from '../src/services/AmigosDoBichoService.js';
import { logger } from '../src/utils/logger.js';
import db from '../src/db.js';

const run = async () => {
    console.log('Starting manual backfill...');
    const service = new AmigosDoBichoService();

    try {
        await service.backfillSevenDays();
        console.log('✅ Backfill complete!');
    } catch (error) {
        console.error('❌ Backfill failed:', error);
    }
};

run();
