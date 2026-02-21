import { initDatabase, getDb } from './src/database/schema.js';

async function checkSavedResults() {
    await initDatabase();
    const db = getDb();

    console.log("=== VERIFICANDO DADOS DA LOOK GO HOJE ===");
    const res = db.exec("SELECT nome_original, horario, (SELECT count(*) from premios p where p.resultado_id = r.id) as qtd_premios FROM resultados r WHERE loterica_slug = 'look-goias' AND data = '2026-02-21'");

    if (res.length > 0) {
        for (const row of res[0].values) {
            console.log(`- Horario: ${row[1]} | Nome original: ${row[0]} | Qtd Prêmios: ${row[2]}`);
        }
    } else {
        console.log("Nenhum resultado pra look-goias hoje no BD.");
    }
}
checkSavedResults();
