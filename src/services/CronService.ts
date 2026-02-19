import { CronJob } from 'cron';
import { AmigosDoBichoService } from './AmigosDoBichoService.js';
import { HoroscopoScraper } from '../scrapers/HoroscopoScraper.js';
import { ContentScraper } from '../scrapers/ContentScraper.js';
import { PalpitesScraper } from '../scrapers/PalpitesScraper.js';
import { CotacaoScraper } from '../scrapers/CotacaoScraper.js';
import { LOTERIAS } from '../config/loterias.js';
import { logger } from '../utils/logger.js';
import db from '../db.js';

export class CronService {
    private apiService = new AmigosDoBichoService();
    private horoscopo = new HoroscopoScraper();
    private content = new ContentScraper();
    private palpites = new PalpitesScraper();
    private cotacao = new CotacaoScraper();
    private jobs: CronJob[] = [];
    private isStarted = false;
    private serviceName = 'CronService';
    private horoscopoCompletoHoje = false;
    private horoscopoJobHora?: CronJob;

    constructor() {
        logger.info(this.serviceName, 'Instância criada. Aguardando start()...');
    }

    async start() {
        if (this.isStarted) {
            logger.warn(this.serviceName, 'Já está rodando, ignorando chamada duplicada');
            return;
        }
        this.isStarted = true;


        // Auto Backfill na inicialização - REMOVIDO A PEDIDO DO USUÁRIO
        // O backfill deve ser feito manualmente ou via script específico.
        // this.apiService.backfillSevenDays().catch(err => {
        //     logger.error(this.serviceName, 'Erro no backfill inicial:', err);
        // });


        // 1. Smart Scheduler (A cada 1 minuto para verificar novos sorteios)
        this.jobs.push(
            new CronJob('*/1 * * * *', () => this.runResultsCheck(), null, true, 'America/Sao_Paulo')
        );

        // 2. Horóscopo (06:00 DIARIO)
        this.jobs.push(
            new CronJob('0 6 * * *', () => this.runHoroscopo6h(), null, true, 'America/Sao_Paulo')
        );


        // 3. Palpites do Dia (07:00 DIARIO)
        this.jobs.push(
            new CronJob('0 7 * * *', () => this.palpites.execute([], 'palpites'), null, true, 'America/Sao_Paulo')
        );

        // 4. Bingos - OBSOLETO VIA SCRAPER?
        // O usuário pediu que "toda vez q sair um resultado o sistema ira conferir se algum palpite bateu"
        // Então o processamento de bingo agora é EVENT-DRIVEN no AmigosDoBichoService.
        // Mantemos o job original apenas se for necessário "Scraping de Bingos Externos",
        // mas o request diz "mudas como funciona o bingo (resultados dos palpites)".
        // Se a ideia é calcular bingo INTERNAMENTE, o scraper de bingos pode ser desativado ou mantido como fallback.
        // Vou manter comentado para não conflitar com a nova lógica.
        // this.jobs.push(
        //    new CronJob('30 23 * * *', () => this.palpites.execute([], 'bingos'), null, true, 'America/Sao_Paulo')
        // );

        // 5. Conteúdo (Semanal)
        this.jobs.push(
            new CronJob('0 9 * * 1', () => this.runContent(), null, true, 'America/Sao_Paulo')
        );

        // 6. Cotações (00:00 DIARIO)
        this.jobs.push(
            new CronJob('0 0 * * *', () => this.runCotacoes(), null, true, 'America/Sao_Paulo')
        );

        logger.success(this.serviceName, 'Smart Scheduler iniciado');
    }

    // Métodos auxiliares de Palpites/Horóscopo/Cotações mantidos iguais...
    async checkPalpitesOnStartup(): Promise<void> {
        const today = new Date().toISOString().split('T')[0];
        const exists = db.prepare('SELECT id FROM palpites_dia WHERE data = ?').get(today);
        if (exists) {
            logger.info(this.serviceName, `Palpites de hoje (${today}) já existem.`);
            return;
        }
        if (this.horoscopoCompletoHoje) {
            await this.runPalpites();
        }
    }

    async checkHoroscopoOnStartup(): Promise<void> {
        // Lógica mantida...
        const today = new Date().toISOString().split('T')[0];
        const check = db.prepare('SELECT count(*) as count FROM horoscopo_diario WHERE data = ?').get(today) as { count: number };
        if (check && check.count >= 12) {
            this.horoscopoCompletoHoje = true;
            await this.runPalpites();
            return;
        }
        const nowBr = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
        if (nowBr.getHours() >= 6) {
            await this.runHoroscopoWithRetry();
        }
    }

    async checkCotacoesOnStartup(): Promise<void> {
        const today = new Date().toISOString().split('T')[0];
        const check = db.prepare("SELECT count(*) as count FROM cotacoes WHERE date(updated_at) = ?").get(today) as { count: number };
        if (check && check.count > 0) return;
        await this.runCotacoes();
    }

    private async runResultsCheck() {
        // Verifica quais loterias acabaram de ocorrer (1 min de delay)
        const now = new Date();
        const nowBr = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
        const DELAY_MS = 60 * 1000; // 1 min

        const statesToCheck = new Set<string>();
        const dataHoje = nowBr.toISOString().split('T')[0];

        for (const loteria of LOTERIAS) {
            if (!loteria.horarios) continue;
            for (const horario of loteria.horarios) {
                const [h, m] = horario.split(':').map(Number);
                const drawTime = new Date(nowBr.getFullYear(), nowBr.getMonth(), nowBr.getDate(), h, m, 0);

                // Janela de execução: entre drawTime + 1min e drawTime + 2min
                // Para garantir que executamos logo após o tempo de delay
                const targetTime = new Date(drawTime.getTime() + DELAY_MS);
                const diff = nowBr.getTime() - targetTime.getTime();

                // Se passou do horário alvo, mas não muito (ex: até 5 min depois, tente buscar)
                if (diff >= 0 && diff < 5 * 60 * 1000) {
                    // Extrair estado do slug (ex: pt-rio -> RJ, bandeirantes -> SP)
                    // Config/Loterias.ts não tem campo 'state', vamos inferir ou adicionar no futuro.
                    // Por enquanto, hardcode mapping baseado no ID ou Slug
                    const state = this.inferState(loteria);
                    if (state) statesToCheck.add(state);
                }
            }
        }

        if (statesToCheck.size > 0) {
            logger.info(this.serviceName, `Verificando resultados para estados: ${Array.from(statesToCheck).join(', ')}`);
            for (const state of statesToCheck) {
                await this.apiService.fetchResults(dataHoje, state);
            }
        }
    }

    private inferState(loteria: any): string | null {
        const id = loteria.id as string;
        if (id.startsWith('rj')) return 'RJ';
        if (id.startsWith('sp')) return 'SP';
        if (id.startsWith('go')) return 'GO';
        if (id.startsWith('mg')) return 'MG';
        if (id.startsWith('ba')) return 'BA';
        if (id.startsWith('pb')) return 'PB';
        if (id.startsWith('pe')) return 'PE';
        if (id.startsWith('ce')) return 'CE';
        if (id.startsWith('df')) return 'DF';
        if (id.startsWith('rn')) return 'RN';
        if (id.startsWith('rs')) return 'RS';
        if (id.startsWith('se')) return 'SE';
        if (id === 'br-federal') return 'FEDERAL';
        if (id === 'br-nacional') return 'NACIONAL';
        if (id === 'br-tradicional') return 'TRADICIONAL';
        return null;
    }

    private async runHoroscopo6h() {
        this.horoscopoCompletoHoje = false;
        await this.runHoroscopoWithRetry();
    }

    private async runHoroscopoWithRetry(): Promise<void> {
        if (this.horoscopoCompletoHoje) return;
        try {
            await this.horoscopo.execute();
            const today = new Date().toISOString().split('T')[0];
            const check = db.prepare('SELECT count(*) as count FROM horoscopo_diario WHERE data = ?').get(today) as { count: number };
            if (check && check.count >= 12) {
                this.horoscopoCompletoHoje = true;
                if (this.horoscopoJobHora) {
                    this.horoscopoJobHora.stop();
                    this.horoscopoJobHora = undefined;
                }
                await this.runPalpites();
            } else {
                this.scheduleHoroscopoRetry();
            }
        } catch (e) {
            this.scheduleHoroscopoRetry();
        }
    }

    private scheduleHoroscopoRetry(): void {
        if (this.horoscopoJobHora) return;
        this.horoscopoJobHora = new CronJob('0 * * * *', async () => {
            if (this.horoscopoCompletoHoje) {
                this.horoscopoJobHora?.stop();
                this.horoscopoJobHora = undefined;
                return;
            }
            await this.runHoroscopoWithRetry();
        }, null, true, 'America/Sao_Paulo');
    }

    private async runContent() {
        await this.content.execute().catch(console.error);
    }

    private async runPalpites() {
        // ... (Mesma lógica)
        const nowBr = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
        if (nowBr.getHours() < 6) return;
        await this.palpites.execute([], 'palpites').catch(console.error);
    }

    private async runCotacoes() {
        await this.cotacao.execute().catch(console.error);
    }

    stop() {
        if (!this.isStarted) return;
        this.jobs.forEach(job => job.stop());
        if (this.horoscopoJobHora) this.horoscopoJobHora.stop();
        this.isStarted = false;
        logger.success(this.serviceName, 'Todos os jobs parados');
    }
}

