import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { LOTERICAS, ESTADOS_API, type Loterica } from '../config/lotericas.js';
import { mapLotteryToSlug, sanitize } from '../utils/helpers.js';
import { log } from '../utils/Logger.js';

const API_BASE = 'https://api.amigosdobicho.com/raffle-results/filter';
const DELAY_MS = 100;

function delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getArrayStructureString(diasArr: number[]): string {
    const sorted = [...diasArr].sort((a, b) => a - b);
    const jsonStr = JSON.stringify(sorted);
    if (jsonStr === '[0,1,2,3,4,5,6]') return 'TODOS_OS_DIAS';
    if (jsonStr === '[1,2,3,4,5,6]') return 'SEG_A_SAB';
    if (jsonStr === '[1,2,4,5]') return 'PTN_DIAS';
    if (jsonStr === '[3,6]') return 'QUA_SAB';
    return jsonStr; // Return raw array literal
}

export class MarketingAuditService {
    static async runAudit(month?: number, year?: number): Promise<void> {
        log.separator('AUDIT', 'MARKETING AUDIT STARTED');
        log.info('AUDIT', 'Iniciando varredura e validação das lotéricas a partir do histórico.');

        const now = new Date();
        const y = year || now.getUTCFullYear();
        const m = month !== undefined ? month : now.getUTCMonth(); // 0-based
        const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

        let token = process.env.API_TOKEN;
        if (!token) {
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
                    if (k === 'API_TOKEN') {
                        token = part.substring(pivot + 1).trim();
                        break;
                    }
                }
            } catch (e) {
                // Ignore
            }
        }

        if (!token) {
            log.error('AUDIT', 'API_TOKEN não encontrado para auditoria mensal.');
            return;
        }

        // Aggregate structure: slug -> { horario -> Set<number_dia> }
        const aggregatedData: Record<string, Record<string, Set<number>>> = {};

        // Extra info to help create new loteries if needed
        const lotericaMeta: Record<string, { nome: string, estado: string }> = {};

        for (let day = 1; day <= daysInMonth; day++) {
            const dateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const dayIndex = new Date(dateStr + 'T12:00:00Z').getUTCDay();

            for (const estado of ESTADOS_API) {
                try {
                    const res = await axios.get(API_BASE, {
                        headers: { 'x-api-token': token },
                        params: { state: estado, date: dateStr }
                    });

                    if (Array.isArray(res.data)) {
                        for (const item of res.data) {
                            const rawName = item.name || item.lottery || '';
                            const horario = item.time || '00:00';

                            // Discover existing slug or create new
                            let slug = mapLotteryToSlug(rawName, estado);
                            let finalName = rawName.split(/ \- | , /)[0].trim();

                            if (!slug) {
                                slug = sanitize(finalName).toLowerCase() + '-' + estado.toLowerCase();
                            }

                            lotericaMeta[slug] = {
                                nome: finalName,
                                estado: estado === 'NA' ? 'NA' : estado
                            };

                            if (!aggregatedData[slug]) {
                                aggregatedData[slug] = {};
                            }
                            if (!aggregatedData[slug][horario]) {
                                aggregatedData[slug][horario] = new Set();
                            }

                            aggregatedData[slug][horario].add(dayIndex);
                        }
                    }
                    await delay(DELAY_MS);
                } catch (err) {
                    // Ignore errors for individual requests
                }
            }
        }

        log.info('AUDIT', 'Dados do mês coletados. Iniciando diff com as configurações atuais.');

        let hasChanges = false;
        const newLotericas: Loterica[] = [];

        // Build the new array based on aggregatedData + existing config as base
        // First add/update existing ones
        for (const lot of LOTERICAS) {
            const activeData = aggregatedData[lot.slug];
            if (!activeData) {
                // Remove this lottery or leave it empty? We should probably keep it if there are 0 results?
                // Wait, if it had 0 results for a WHOLE MONTH, it might be dead. But to be safe, we keep it as is,
                // or maybe log it. Actually, the user asked: "ou q alguma loterica saiu... para se adaptar". 
                // We'll remove it if it had 0 results int the whole month!
                log.warn('AUDIT', `Lotérica ${lot.slug} não teve NENHUM resultado neste mês. Removendo da configuração ativa.`);
                hasChanges = true;
                continue;
            }

            const newHorarios: { horario: string, dias: number[] }[] = [];
            for (const horario of Object.keys(activeData).sort()) {
                const dias = Array.from(activeData[horario]).sort((a, b) => a - b);
                newHorarios.push({ horario, dias });

                // Compare with previous to detect change
                const oldH = lot.horarios.find(h => h.horario === horario);
                if (!oldH) {
                    log.info('AUDIT', `Detectado novo horário [${horario}] para lotérica ${lot.slug}.`);
                    hasChanges = true;
                } else if (JSON.stringify(oldH.dias) !== JSON.stringify(dias)) {
                    log.info('AUDIT', `Detectada alteração de dias no horário [${horario}] para lotérica ${lot.slug}. Novo: ${JSON.stringify(dias)}`);
                    hasChanges = true;
                }
            }

            // Check if any old hours were removed completely
            for (const oldH of lot.horarios) {
                if (!newHorarios.find(h => h.horario === oldH.horario)) {
                    log.warn('AUDIT', `Horário [${oldH.horario}] foi desativado/removido nativamente da lotérica ${lot.slug}.`);
                    hasChanges = true;
                }
            }

            newLotericas.push({
                ...lot,
                horarios: newHorarios
            });

            // Mark as processed
            delete aggregatedData[lot.slug];
        }

        // Any keys left in aggregatedData represent entirely NEW lotteries
        for (const slug of Object.keys(aggregatedData)) {
            const meta = lotericaMeta[slug];
            const activeData = aggregatedData[slug];
            const newHorarios: { horario: string, dias: number[] }[] = [];

            for (const horario of Object.keys(activeData).sort()) {
                const dias = Array.from(activeData[horario]).sort((a, b) => a - b);
                newHorarios.push({ horario, dias });
            }

            log.success('AUDIT', `Nova lotérica adicionada à plataforma dinamicamente: ${slug} (${meta.nome})`);
            hasChanges = true;

            newLotericas.push({
                slug,
                nome: meta.nome,
                estado: meta.estado,
                horarios: newHorarios
            });
        }

        if (!hasChanges) {
            log.info('AUDIT', 'Nenhuma divergência detectada perante o mês consolidado. Sistema intacto.');
            return;
        }

        // Apply Hot Swap
        this.hotSwapLotericas(newLotericas);
    }

    private static hotSwapLotericas(lotericas: Loterica[]): void {
        const filePath = path.resolve(process.cwd(), 'src/config/lotericas.ts');

        let output = `export interface Loterica {
    slug: string;
    nome: string;
    estado: string;
    horarios: {
        horario: string;
        dias: number[];
    }[];
}

const TODOS_OS_DIAS = [0, 1, 2, 3, 4, 5, 6];
const SEG_A_SAB = [1, 2, 3, 4, 5, 6];
const PTN_DIAS = [1, 2, 4, 5]; // Segunda, Terça, Quinta, Sexta
const QUA_SAB = [3, 6]; // Quarta e Sábado

export const LOTERICAS: Loterica[] = [
`;

        for (const lot of lotericas) {
            output += `    {
        slug: '${lot.slug}', nome: '${lot.nome}', estado: '${lot.estado}', horarios: [\n`;
            for (const h of lot.horarios) {
                const diasStr = getArrayStructureString(h.dias);
                output += `            { horario: '${h.horario}', dias: ${diasStr} },\n`;
            }
            output += `        ]
    },\n`;
        }

        output += `];

export const ESTADOS_API: string[] = ['DF', 'BA', 'GO', 'MG', 'PB', 'RJ', 'SP', 'NA'];
`;

        fs.writeFileSync(filePath, output, 'utf-8');
        log.success('AUDIT', `Arquivo lotericas.ts foi reescrito via Hot-Swap Automático. Total: ${lotericas.length} bancas ativas.`);
    }
}
