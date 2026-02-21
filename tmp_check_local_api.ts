import axios from 'axios';

async function verifyLocalAPI() {
    console.log("Checando API Local de Resultados para 2026-02-21...");
    try {
        const url = 'http://localhost:3000/v1/resultados';
        const res = await axios.get(url, {
            params: { data: '2026-02-21' }
        });

        console.log("Status:", res.status);
        if (res.data) {
            console.log(`Retornados ${res.data.length} resultados.`);
            if (res.data.length > 0) {
                console.log("Exemplo:", res.data[0].loterica, "-", res.data[0].horario);
            }
        }
    } catch (e: any) {
        console.log(`Erro: ${e.message}`);
    }
}
verifyLocalAPI();
