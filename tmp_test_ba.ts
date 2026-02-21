import { initDatabase } from './src/database/schema.js';
import { fetchResultados } from './src/services/ScraperService.js';
import { mapLotteryToSlug } from './src/utils/helpers.js';
import { LOTERICAS } from './src/config/lotericas.js';

async function testBA() {
    await initDatabase();

    // Mostra como a BA está configurada no sistema
    const lotBA = LOTERICAS.filter(l => l.estado === 'BA');
    console.log("=== CONFIGURAÇÕES DA BA NO SISTEMA ===");
    lotBA.forEach(l => console.log(`Slug: ${l.slug} | Nome: ${l.nome} | Horarios:`, l.horarios.map(h => h.horario).join(', ')));

    console.log("\n=== TESTANDO FETCH DA BA PARA HOJE ===");
    const results = await fetchResultados('BA', '2026-02-21');
    console.log(`Recebidos ${results.length} resultados brutos.`);

    for (const r of results) {
        let name = r.name || r.lottery || '';
        const slug = mapLotteryToSlug(name, 'BA');
        console.log(`- API Name: "${name}" | API Time: "${r.time}" | Mapeou para slug: "${slug}"`);
    }
}
testBA();
