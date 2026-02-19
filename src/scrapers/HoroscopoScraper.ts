import { ScraperBase } from './ScraperBase.js';
import db from '../db.js';
import { LotericaConfig } from '../config/loterias.js';
import { logger } from '../utils/logger.js';

const SIGNOS = [
    { nome: 'Áries', slug: 'aries', url: 'https://www.ojogodobicho.com/aries.htm' },
    { nome: 'Touro', slug: 'touro', url: 'https://www.ojogodobicho.com/touro.htm' },
    { nome: 'Gêmeos', slug: 'gemeos', url: 'https://www.ojogodobicho.com/gemeos.htm' },
    { nome: 'Câncer', slug: 'cancer', url: 'https://www.ojogodobicho.com/cancer.htm' },
    { nome: 'Leão', slug: 'leao', url: 'https://www.ojogodobicho.com/leao.htm' },
    { nome: 'Virgem', slug: 'virgem', url: 'https://www.ojogodobicho.com/virgem.htm' },
    { nome: 'Libra', slug: 'libra', url: 'https://www.ojogodobicho.com/libra.htm' },
    { nome: 'Escorpião', slug: 'escorpiao', url: 'https://www.ojogodobicho.com/escorpiao.htm' },
    { nome: 'Sagitário', slug: 'sagitario', url: 'https://www.ojogodobicho.com/sagitario.htm' },
    { nome: 'Capricórnio', slug: 'capricornio', url: 'https://www.ojogodobicho.com/capricornio.htm' },
    { nome: 'Aquário', slug: 'aquario', url: 'https://www.ojogodobicho.com/aquario.htm' },
    { nome: 'Peixes', slug: 'peixes', url: 'https://www.ojogodobicho.com/peixes.htm' }
];

export class HoroscopoScraper extends ScraperBase {
    protected serviceName = 'HoroscopoScraper';

    constructor() {
        super('https://www.ojogodobicho.com/');
    }

    async execute(targets?: LotericaConfig[], targetSlug?: string): Promise<void> {
        logger.info(this.serviceName, 'Iniciando varredura de horóscopo...');
        const today = new Date().toISOString().split('T')[0];

        // Verificar se já processamos hoje (são 12 signos)
        const check = db.prepare('SELECT count(*) as count FROM horoscopo_diario WHERE data = ?').get(today) as { count: number };

        if (check && check.count >= 12) {
            logger.info(this.serviceName, `Horóscopo de hoje (${today}) já está completo (${check.count} registros). Pulando.`);
            return;
        }

        for (const signo of SIGNOS) {
            try {
                await this.scrapeSigno(signo, today);
            } catch (error) {
                logger.error(this.serviceName, `Erro ao buscar ${signo.nome}:`, error);
            }
        }

        logger.success(this.serviceName, 'Varredura finalizada.');
    }

    private async scrapeSigno(signo: typeof SIGNOS[0], data: string): Promise<void> {
        // Usar fetchHtmlWithRetry para ter retry infinito e proteção contra bloqueios
        const $ = await this.fetchHtmlWithRetry(signo.url);
        if (!$) {
            logger.warn(this.serviceName, `Não foi possível carregar página do signo ${signo.nome}`);
            return;
        }

        // Buscar os números da sorte
        const numeros: string[] = [];
        const text = $('body').text();

        // Procurar seção "Números da sorte para hoje"
        const numerosMatch = text.match(/Números da sorte para hoje[\s\S]*?(?=Os arianos|Os taurinos|Os geminianos|Os cancerianos|Os leoninos|Os virginianos|Os librianos|Os escorpianos|Os sagitarianos|Os capricornianos|Os aquarianos|Os piscianos|Publicidade)/i);

        if (numerosMatch) {
            const nums = numerosMatch[0].match(/\d{2,4}/g);
            if (nums) {
                numeros.push(...nums.slice(0, 14)); // Até 14 números
            }
        }

        // Buscar descrição do signo
        const descMatch = text.match(/Características do signo de \w+\s*([\s\S]*?)(?=Números da sorte|$)/i);
        const descricao = descMatch ? descMatch[1].trim().substring(0, 500) : '';

        if (numeros.length > 0) {
            // Salvar no banco
            const stmt = db.prepare(`
                INSERT OR REPLACE INTO horoscopo_diario (signo, texto, numeros, data)
                VALUES (?, ?, ?, ?)
            `);

            stmt.run(
                signo.nome,
                descricao,
                numeros.join(', '),
                data
            );

            logger.success(this.serviceName, `${signo.nome}: ${numeros.length} números salvos`);
        } else {
            logger.warn(this.serviceName, `${signo.nome}: Nenhum número encontrado`);
        }
    }
}
