import axios from 'axios';
import fs from 'fs';
import path from 'path';

function getEnv(key: string): string | undefined {
    try {
        const envPath = path.resolve(process.cwd(), '.env');
        const envContent = fs.readFileSync(envPath, 'utf-8');
        const lines = envContent.split('\n');
        for (const line of lines) {
            const part = line.trim();
            if (!part || part.startsWith('#')) continue;
            const pivot = part.indexOf('=');
            if (pivot === -1) continue;
            const k = part.substring(0, pivot).trim();
            const v = part.substring(pivot + 1).trim();
            if (k === key) return v;
        }
    } catch (e) {
        return undefined;
    }
    return undefined;
}

const API_BASE = 'https://api.amigosdobicho.com/raffle-results/filter';
const API_TOKEN = getEnv('API_TOKEN');

const states = ['DF', 'BA', 'GO', 'MG', 'PB', 'RJ', 'SP', 'NA'];
const daysOfWeekPt = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

// Delay helper to avoid rate limits
const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

async function runQuery() {
    if (!API_TOKEN) {
        console.error('API_TOKEN não encontrado no arquivo .env');
        process.exit(1);
    }

    const weeklySummary: any = {
        'Segunda': 0, 'Terça': 0, 'Quarta': 0, 'Quinta': 0, 'Sexta': 0, 'Sábado': 0, 'Domingo': 0
    };

    const recurrentSchedules: any = {};

    console.error('Iniciando consulta para Fevereiro/2026 (até hoje)...');

    // Dias 1 a 20 de Fevereiro
    for (let day = 1; day <= 20; day++) {
        // Format YYYY-MM-DD
        const dateStr = `2026-02-${day.toString().padStart(2, '0')}`;
        const dayIndex = new Date(dateStr + 'T12:00:00Z').getUTCDay();
        const finalDayName = daysOfWeekPt[dayIndex];

        console.error(`Processando: ${dateStr} (${finalDayName})...`);

        for (const state of states) {
            try {
                const stateLabel = state === 'NA' ? 'Nacional' : state;
                const res = await axios.get(API_BASE, {
                    headers: { 'x-api-token': API_TOKEN },
                    params: { state, date: dateStr }
                });

                const data = res.data;
                if (Array.isArray(data)) {
                    for (const item of data) {
                        weeklySummary[finalDayName]++;

                        const fullName = item.name || '';
                        let banca = 'Outras';
                        if (fullName) {
                            const parts = fullName.split(/ \- | , /);
                            banca = parts[0].trim();
                        }

                        const horario = item.time || '00:00:00';

                        if (!recurrentSchedules[banca]) {
                            recurrentSchedules[banca] = {};
                        }
                        if (!recurrentSchedules[banca][stateLabel]) {
                            recurrentSchedules[banca][stateLabel] = {};
                        }
                        if (!recurrentSchedules[banca][stateLabel][horario]) {
                            recurrentSchedules[banca][stateLabel][horario] = new Set();
                        }

                        recurrentSchedules[banca][stateLabel][horario].add(finalDayName);
                    }
                }

                // Delay to be safe on rate limit
                await delay(100);
            } catch (err: any) {
                // Ignore silent errors for console stdout
            }
        }
    }

    // Convert Sets to Arrays and format
    const formattedRecurrence: any = {};
    for (const banca in recurrentSchedules) {
        formattedRecurrence[banca] = {};
        for (const state in recurrentSchedules[banca]) {
            formattedRecurrence[banca][state] = {};
            const sortedTimes = Object.keys(recurrentSchedules[banca][state]).sort();
            for (const time of sortedTimes) {
                const days = Array.from(recurrentSchedules[banca][state][time]);
                formattedRecurrence[banca][state][time] = days;
            }
        }
    }

    console.log("--- AGRUPAMENTO POR DIA DA SEMANA (FEVEREIRO/2026) ---");
    console.log(JSON.stringify(weeklySummary, null, 2));
    console.log("\n--- RECORRÊNCIA DE HORÁRIOS (BANCA/ESTADO) ---");
    console.log(JSON.stringify(formattedRecurrence, null, 2));
}

runQuery();
