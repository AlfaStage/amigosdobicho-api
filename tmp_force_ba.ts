import { initDatabase, getDb, saveDatabase } from './src/database/schema.js';
import { fetchResultados } from './src/services/ScraperService.js';
import { ingestResult } from './src/services/AmigosDoBichoService.js';
import { mapLotteryToSlug } from './src/utils/helpers.js';

async function forceFetchBA() {
    await initDatabase();
    console.log("Forçando busca da BA para hoje...");
    const results = await fetchResultados('BA', '2026-02-21');
    const db = getDb();

    console.log(`Recebemos ${results.length} resultados brutos. Ingerindo Simulando CronService...`);

    // Simulate cron's behavior closely
    const cronHorario = '10:20:00';
    for (const r of results) {
        let name = r.name || r.lottery || '';
        const slug = mapLotteryToSlug(name, 'BA');
        console.log(`- Mapeando -> Name: ${name} | Slug: ${slug} | API Time: ${r.time} -> Slot esperado: ${cronHorario}`);

        if (slug !== 'ba-ba') continue;

        let apiTime = r.time ? r.time.split(':').slice(0, 2).map((v: string) => v.padStart(2, '0')).join(':') : null;
        if (!apiTime) continue;

        // Cron time tolerance logic
        const slotTime = cronHorario.split(':').slice(0, 2).map((v: string) => v.padStart(2, '0')).join(':');

        const [apiH, apiM] = apiTime.split(':').map(Number);
        const [slotH, slotM] = slotTime.split(':').map(Number);
        const diffMins = Math.abs((apiH * 60 + apiM) - (slotH * 60 + slotM));

        if (diffMins > 35) {
            console.log(`   -> Rejeitado por tempo (Diff ${diffMins} mins > 35 mins)`);
            continue;
        }

        const premios = (r.results || []).map((p: any, i: number) => ({
            posicao: p.premio || i + 1,
            milhar: String(p.milhar || '').padStart(4, '0'),
        }));

        const input = {
            loterica: slug,
            estado: 'BA',
            data: '2026-02-21',
            horario: cronHorario, // Cron always saves the canonical slot time
            nome_original: name,
            premios
        };

        const res = ingestResult(input);
        console.log(`Ingerido [Slot: ${cronHorario} | Real: ${apiTime}] ${name} - Status: ${res.saved ? 'SALVO' : 'IGNORADO'}`);
    }
}

forceFetchBA();
