import { fetchAllResultados, fetchResultados } from './src/services/ScraperService.js';

async function testFetch() {
    console.log("=== TESTANDO fetchAllResultados ===");
    const all = await fetchAllResultados('2026-02-21');
    const look = all.filter((r: any) => JSON.stringify(r).toLowerCase().includes('look'));
    console.log(`Encontrados ${look.length} resultados da look-go no fetchAllResultados`);
    if (look.length > 0) {
        console.log("Exemplo 1:", JSON.stringify(look[0]));
    }

    console.log("\n=== TESTANDO fetchResultados (Fallback API) PARA GO ===");
    const fallback = await fetchResultados('GO', '2026-02-21');
    console.log(`Encontrados ${fallback.length} resultados no fetchResultados (GO)`);
    if (fallback.length > 0) {
        console.log("Exemplo 1 fallback:", JSON.stringify(fallback[0]));
    }
}
testFetch();
