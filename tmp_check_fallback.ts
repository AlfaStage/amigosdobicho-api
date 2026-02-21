import axios from 'axios';

async function testFallback() {
    try {
        const url = 'https://api.amigosdobicho.com/external-results/results/state/PB';
        const res = await axios.get(url, {
            params: { date: '2026-02-21' },
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });

        if (res.data && res.data.length > 0) {
            console.log("Full Object keys:", Object.keys(res.data[0]));
            console.log("Full Object:", JSON.stringify(res.data[0], null, 2));

            if (res.data[0].raffle) {
                console.log("Raffle Object keys:", Object.keys(res.data[0].raffle));
            }
        }
    } catch (e: any) {
        console.log(`Erro: ${e.message}`);
    }
}
testFallback();
