import { GlobalScraper } from '../scrapers/GlobalScraper.js';
import { GigaBichoScraper } from '../scrapers/GigaBichoScraper.js';
import { ResultadoFacilScraper } from '../scrapers/ResultadoFacilScraper.js';
import { LoteriaNacionalScraper } from '../scrapers/LoteriaNacionalScraper.js';
import { BichoCertoScraper } from '../scrapers/BichoCertoScraper.js';
import { HoroscopoScraper } from '../scrapers/HoroscopoScraper.js';
import { PalpitesScraper } from '../scrapers/PalpitesScraper.js';
import { logger } from '../utils/logger.js';
import { LotericaConfig } from '../config/loterias.js';

// Interface para rastrear horários específicos pendentes
export interface LoteriaPendente {
    loteria: LotericaConfig;
    horariosPendentes: string[];
}

export class ScraperService {
    private primary = new GlobalScraper();
    private secondary = new GigaBichoScraper();
    private tertiary = new ResultadoFacilScraper();
    private quaternary = new LoteriaNacionalScraper();
    private quinary = new BichoCertoScraper();
    private horoscopo = new HoroscopoScraper();
    private palpites = new PalpitesScraper();
    private serviceName = 'ScraperService';

    async executeHoroscopo(): Promise<void> {
        logger.info(this.serviceName, 'Executando scraper de Horóscopo...');
        await this.horoscopo.execute();
    }

    async executePalpites(): Promise<void> {
        logger.info(this.serviceName, 'Executando scraper de Palpites do Dia...');
        await this.palpites.execute(undefined, 'palpites');
    }

    async executeBingo(): Promise<void> {
        logger.info(this.serviceName, 'Executando scraper de Bingos...');
        await this.palpites.execute(undefined, 'bingos');
    }

    async executeTargeted(targets: LoteriaPendente[], shouldNotify: boolean = true): Promise<void> {
        if (targets.length === 0) return;

        const totalHorarios = targets.reduce((sum, t) => sum + t.horariosPendentes.length, 0);
        logger.info(this.serviceName, `Executando varredura direcionada para ${targets.length} lotéricas (${totalHorarios} horários pendentes)...`);

        // Executar Primary apenas para os targets e horários específicos
        try {
            await this.primary.execute(targets, undefined, shouldNotify);
        } catch (e) {
            logger.error(this.serviceName, 'Erro no Primary (Targeted):', e);
        }

        // Executar Secondary apenas para os targets e horários específicos
        try {
            await this.secondary.execute(targets, undefined, shouldNotify);
        } catch (e) {
            logger.error(this.serviceName, 'Erro no Secondary (Targeted):', e);
        }

        // Executar Tertiary (ResultadoFacil) apenas para os targets e horários específicos como fallback
        try {
            await this.tertiary.execute(targets, undefined, shouldNotify);
        } catch (e) {
            logger.error(this.serviceName, 'Erro no Tertiary (Targeted):', e);
        }

        // Executar Quaternary (LoteriaNacional) apenas para os targets e horários específicos como fallback
        try {
            await this.quaternary.execute(targets, undefined, shouldNotify);
        } catch (e) {
            logger.error(this.serviceName, 'Erro no Quaternary (Targeted):', e);
        }

        // Executar Quinary (BichoCerto) apenas para os targets e horários específicos como fallback
        try {
            await this.quinary.execute(targets, undefined, shouldNotify);
        } catch (e) {
            logger.error(this.serviceName, 'Erro no Quinary (Targeted):', e);
        }
    }

    async executeGlobal(shouldNotify: boolean = true): Promise<void> {
        logger.info(this.serviceName, 'Iniciando ciclo de scraping GLOBAL multi-fonte...');

        // 1. O Jogo do Bicho (Primary)
        try {
            await this.primary.execute(undefined, undefined, shouldNotify);
        } catch (e) {
            logger.error(this.serviceName, 'Erro no Primary (GlobalScraper):', e);
        }

        // 2. GigaBicho (Secondary)
        try {
            await this.secondary.execute(undefined, undefined, shouldNotify);
        } catch (e) {
            logger.error(this.serviceName, 'Erro no Secondary (GigaBicho):', e);
        }

        // 3. ResultadoFacil (Tertiary - Fallback/Test)
        try {
            await this.tertiary.execute(undefined, undefined, shouldNotify);
        } catch (e) {
            logger.error(this.serviceName, 'Erro no Tertiary (ResultadoFacil):', e);
        }

        // 4. LoteriaNacional (Quaternary - Fallback)
        try {
            await this.quaternary.execute(undefined, undefined, shouldNotify);
        } catch (e) {
            logger.error(this.serviceName, 'Erro no Quaternary (LoteriaNacional):', e);
        }

        // 5. BichoCerto (Quinary - Fallback)
        try {
            await this.quinary.execute(undefined, undefined, shouldNotify);
        } catch (e) {
            logger.error(this.serviceName, 'Erro no Quinary (BichoCerto):', e);
        }

        // 6. Horóscopo (números da sorte por signo)
        try {
            await this.horoscopo.execute();
        } catch (e) {
            logger.error(this.serviceName, 'Erro no Horóscopo Scraper:', e);
        }

        logger.success(this.serviceName, 'Ciclo finalizado');
    }

    public getDiagnosticSummary(): string {
        const diagnostics: string[] = [];

        if (this.primary.getLastError()) diagnostics.push(`Fonte Principal: ${this.primary.getLastError()}`);
        if (this.secondary.getLastError()) diagnostics.push(`Fonte Secundária: ${this.secondary.getLastError()}`);
        if (this.tertiary.getLastError()) diagnostics.push(`Fonte Terciária: ${this.tertiary.getLastError()}`);
        if (this.quaternary.getLastError()) diagnostics.push(`Fonte Quaternária: ${this.quaternary.getLastError()}`);
        if (this.quinary.getLastError()) diagnostics.push(`Fonte Quinária: ${this.quinary.getLastError()}`);
        if (this.horoscopo.getLastError()) diagnostics.push(`Horóscopo: ${this.horoscopo.getLastError()}`);
        if (this.palpites.getLastError()) diagnostics.push(`Palpites/Bingos: ${this.palpites.getLastError()}`);

        if (diagnostics.length === 0) {
            return 'Página carregada, mas os resultados ainda não foram publicados no site de origem.';
        }

        return diagnostics.join(' | ');
    }
}
