import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import db from '../db.js';
import { CotacaoScraper } from '../scrapers/CotacaoScraper.js';
import { logger } from '../utils/logger.js';

export async function cotacaoRoutes(app: FastifyInstance) {
    const server = app.withTypeProvider<ZodTypeProvider>();

    server.get('/', {
        schema: {
            summary: 'Listar Cotações',
            description: 'Retorna a lista de cotações atualizadas para o Jogo do Bicho.',
            tags: ['🦁 Cotas'],
            response: {
                200: z.object({
                    data: z.array(z.object({
                        modalidade: z.string(),
                        valor: z.string(),
                        updated_at: z.string()
                    }))
                })
            }
        }
    }, async () => {
        const cotacoes = db.prepare('SELECT modalidade, valor, updated_at FROM cotacoes ORDER BY modalidade ASC').all();
        return { data: cotacoes as any };
    });

    server.post('/sync', {
        schema: {
            summary: 'Sincronizar Cotações',
            description: 'Força o scraping das cotações no site configurado.',
            tags: ['🦁 Cotas'],
            response: {
                200: z.object({
                    message: z.string()
                }),
                500: z.object({
                    error: z.string()
                })
            }
        }
    }, async (req, reply) => {
        try {
            const scraper = new CotacaoScraper();
            await scraper.execute();
            return {
                message: 'Sincronização concluída com sucesso'
            };
        } catch (error: any) {
            logger.error('CotacaoRoute', 'Erro ao sincronizar:', error);
            return reply.status(500).send({ error: 'Falha na sincronização' });
        }
    });
}
