import { initDatabase, getDb, saveDatabase } from './src/database/schema.js';
import { fetchResultados } from './src/services/ScraperService.js';
import { ingestResult } from './src/services/AmigosDoBichoService.js';
import { mapLotteryToSlug } from './src/utils/helpers.js';

async function forceFetch() {
    await initDatabase();
    console.log("Forçando busca da GO para hoje...");
    const results = await fetchResultados('GO', '2026-02-21');
    const db = getDb();

    // Deleta os antigos de hoje pra não dar choque Unique Constraint por ter a mesma loterica_slug e nome vazio
    db.run("DELETE FROM resultados WHERE data = '2026-02-21' AND loterica_slug = 'look-goias'");
    saveDatabase();

    console.log(`Recebemos ${results.length} resultados brutos. Ingerindo...`);

    for (const r of results) {
        let name = r.name || r.lottery || '';
        const slug = mapLotteryToSlug(name, 'GO');
        console.log(`- Mapeando -> Name: ${name} | Slug: ${slug} | Time: ${r.time}`);

        if (slug !== 'look-goias') continue;

        let apiTime = r.time ? r.time.split(':').slice(0, 2).map((v: string) => v.padStart(2, '0')).join(':') : null;
        if (!apiTime) continue;

        const premios = (r.results || []).map((p: any, i: number) => ({
            posicao: p.premio || i + 1,
            milhar: String(p.milhar || '').padStart(4, '0'),
        }));

        const input = {
            loterica: slug,
            estado: 'GO',
            data: '2026-02-21',
            horario: apiTime,
            nome_original: name,
            premios
        };

        const res = ingestResult(input);
        console.log(`Ingerido [${apiTime}] ${name} - Status: ${res.saved ? 'SALVO' : 'IGNORADO'}`);
    }

    console.log("\n=== CONFERINDO BD APÓS INGESTÃO ===");
    const finalRes = db.exec("SELECT nome_original, horario, (SELECT count(*) from premios p where p.resultado_id = r.id) FROM resultados r WHERE loterica_slug = 'look-goias' AND data = '2026-02-21'");
    if (finalRes.length > 0) {
        for (const row of finalRes[0].values) {
            console.log(`- Horario: ${row[1]} | Nome original: ${row[0]} | Premios: ${row[2]}`);
        }
    }
}

forceFetch();
