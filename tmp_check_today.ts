import axios from 'axios';
const API_BASE = 'https://api.amigosdobicho.com/raffle-results/filter';
const TOKEN = 'SHv4PEhWMZPup9ozm9oEPVHeET2lI5Ik0ivYmC6wHksMQoXFU0GYVMIWIE';

async function checkToday() {
    console.log("Checando AMIGOSDOBICHO API para hoje (2026-02-21)...");
    const states = ['NA', 'GO', 'DF', 'RJ', 'PB'];
    for (const state of states) {
        try {
            const res = await axios.get(API_BASE, {
                params: { state, date: '2026-02-21' },
                headers: { 'x-api-token': TOKEN, 'User-Agent': 'Mozilla/5.0' }
            });
            if (res.data && res.data.length > 0) {
                console.log(`[${state}] Retornou ${res.data.length} resultados.`);
                for (let r of res.data) {
                    console.log(` - ${r.lottery || r.name} | ${r.time}`);
                }
            } else {
                console.log(`[${state}] 0 resultados até agora.`);
            }
        } catch (e: any) {
            console.log(`[${state}] Erro: ${e.message}`);
        }
    }
}
checkToday();
