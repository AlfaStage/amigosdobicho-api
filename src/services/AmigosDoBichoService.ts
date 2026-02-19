import axios from 'axios';
import { logger } from '../utils/logger.js';
import db from '../db.js';
import { randomUUID } from 'crypto';
import { WebhookService } from './WebhookService.js';
import { BingoService } from './BingoService.js';

interface ApiResult {
    id: number;
    dt_created: string;
    name: string;
    time: string;
    results: {
        premio: number;
        milhar: string;
        grupo: string | null;
        animal: string | null;
    }[];
    raffle: {
        id: number;
        active: number;
        state: string;
        lottery: string;
        time: string;
        nickname: string;
    };
}

export class AmigosDoBichoService {
    private readonly baseUrl = 'https://api.amigosdobicho.com/raffle-results';
    private readonly token = process.env.AMIGOS_API_TOKEN || '';
    private webhookService = new WebhookService();
    private bingoService = new BingoService();
    private serviceName = 'AmigosDoBichoService';

    constructor() { }

    /**
     * Busca resultados filtrados por estado e data
     * @param date Data no formato YYYY-MM-DD
     * @param state Sigla do estado (SP, RJ, Federal, etc.)
     */
    async fetchResults(date: string, state: string): Promise<void> {
        try {
            const url = `${this.baseUrl}/filter`;
            const response = await axios.get<ApiResult[]>(url, {
                headers: {
                    'x-api-token': this.token
                },
                params: {
                    state: state,
                    date: date
                }
            });

            const results = response.data;
            if (!results || results.length === 0) {
                logger.info(this.serviceName, `Nenhum resultado encontrado para ${state} em ${date}`);
                return;
            }

            logger.info(this.serviceName, `Encontrados ${results.length} resultados para ${state} em ${date}`);

            for (const result of results) {
                await this.processResult(result);
            }

        } catch (error: any) {
            logger.error(this.serviceName, `Erro ao buscar resultados para ${state} em ${date}: ${error.message}`);
        }
    }

    /**
     * Processa e salva um resultado individual da API
     */
    private async processResult(apiResult: ApiResult): Promise<void> {
        const { raffle, results, dt_created } = apiResult;

        // Mapeamento de nome de loteria para slug interno
        // TODO: Melhorar este mapeamento ou garantir que os slugs batam com os da API
        const lotericaSlug = this.mapLotteryToSlug(raffle.lottery, raffle.state, raffle.nickname);
        const horario = raffle.time.substring(0, 5); // HH:mm
        const data = dt_created.split('T')[0];

        // Verificar se já existe
        const exists = db.prepare('SELECT id FROM resultados WHERE loterica_slug = ? AND data = ? AND horario = ?')
            .get(lotericaSlug, data, horario) as { id: string } | undefined;

        if (exists) {
            // Se já existe, não faz nada (ou atualiza se necessário)
            return;
        }

        const id = randomUUID();
        const premios = results.map(r => ({
            id: randomUUID(),
            resultado_id: id,
            posicao: r.premio,
            milhar: r.milhar,
            grupo: r.grupo ? parseInt(r.grupo) : this.calculaGrupo(r.milhar),
            bicho: r.animal || this.calculaBicho(r.milhar)
        }));

        try {
            const insertResultado = db.prepare('INSERT INTO resultados (id, data, horario, loterica_slug, created_at) VALUES (?, ?, ?, ?, ?)');
            const insertPremio = db.prepare('INSERT INTO premios (id, resultado_id, posicao, milhar, grupo, bicho) VALUES (?, ?, ?, ?, ?, ?)');

            const transaction = db.transaction(() => {
                insertResultado.run(id, data, horario, lotericaSlug, new Date().toISOString());
                for (const p of premios) {
                    insertPremio.run(p.id, p.resultado_id, p.posicao, p.milhar, p.grupo, p.bicho);
                }
            });

            transaction();
            logger.success(this.serviceName, `Novo resultado salvo: ${raffle.nickname} (${data} ${horario})`);

            // Disparar Webhooks
            this.webhookService.notifyAll('novo_resultado', {
                id,
                data,
                horario,
                loterica: raffle.nickname,
                premios: premios.map(p => ({ posicao: p.posicao, milhar: p.milhar, grupo: p.grupo, bicho: p.bicho }))
            }).catch(() => { });

            // Verificar Bingo
            this.bingoService.checkBingo(id, data, lotericaSlug, premios).catch(err => {
                logger.error(this.serviceName, `Erro ao verificar bingo para ${id}: ${err.message}`);
            });

        } catch (error: any) {
            logger.error(this.serviceName, `Erro ao salvar resultado ${raffle.nickname}: ${error.message}`);
        }
    }

    /**
     * Realiza o backfill dos últimos 7 dias para todos os estados configurados
     */
    async backfillSevenDays(): Promise<void> {
        logger.info(this.serviceName, 'Iniciando backfill de 7 dias...');
        const states = ['SP', 'RJ', 'PB', 'RS', 'CE', 'BA', 'GO', 'MG', 'DF', 'PE', 'SE', 'FEDERAL']; // Lista de estados suportados
        const today = new Date();

        for (let i = 0; i < 7; i++) {
            const date = new Date(today);
            date.setDate(today.getDate() - i);
            const dateString = date.toISOString().split('T')[0];

            logger.info(this.serviceName, `Backfill dia ${dateString}...`);

            // Promise.all para paralelar os estados do dia
            await Promise.all(states.map(state => this.fetchResults(dateString, state)));
        }
        logger.success(this.serviceName, 'Backfill concluído.');
    }

    // Auxiliares

    private calculaGrupo(milhar: string): number {
        const dezenas = parseInt(milhar.slice(-2));
        if (dezenas === 0) return 25;
        return Math.ceil(dezenas / 4);
    }

    private calculaBicho(milhar: string): string {
        const grupos = [
            'Avestruz', 'Águia', 'Burro', 'Borboleta', 'Cachorro', 'Cabra', 'Carneiro', 'Camelo', 'Cobra', 'Coelho',
            'Cavalo', 'Elefante', 'Galo', 'Gato', 'Jacaré', 'Leão', 'Macaco', 'Porco', 'Pavão', 'Peru',
            'Touro', 'Tigre', 'Urso', 'Veado', 'Vaca'
        ];
        const grupo = this.calculaGrupo(milhar);
        return grupos[grupo - 1] || 'Desconhecido';
    }

    private mapLotteryToSlug(lottery: string, state: string, nickname: string): string {
        // Lógica simples de mapeamento baseada no nickname ou lottery
        // Tenta encontrar um slug correspondente na config ou gera um genérico
        // O ideal é ter um mapa preciso, mas vamos tentar inferir

        const normalized = (nickname + ' ' + lottery).toLowerCase();

        if (state === 'RJ' && normalized.includes('pt')) return 'pt-rio';
        if (state === 'SP' && normalized.includes('pt')) return 'pt-sp';
        if (state === 'SP' && normalized.includes('bandeirantes')) return 'bandeirantes';
        if (state === 'GO' && normalized.includes('look')) return 'look-goias';
        if (state === 'GO' && normalized.includes('boa sorte')) return 'boa-sorte';
        if (normalized.includes('federal')) return 'federal';
        if (normalized.includes('nacional')) return 'loteria-nacional';

        // Retorna um slug "safe" se não mapear direto, para não perder o dado
        return `${state.toLowerCase()}-${lottery.toLowerCase().replace(/\s+/g, '-')}`;
    }
}
