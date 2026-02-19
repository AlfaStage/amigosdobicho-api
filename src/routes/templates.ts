import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import db from '../db.js';
import { logger } from '../utils/logger.js';

export async function templatesRoutes(app: FastifyInstance) {
    app.get('/', {
        schema: {
            tags: ['Templates'],
            summary: 'Listar templates'
        }
    }, async () => {
        return db.prepare('SELECT id, type, name FROM templates').all();
    });

    app.get('/:type', {
        schema: {
            tags: ['Templates'],
            summary: 'Obter template por tipo (resultado, bingo)',
            params: {
                type: 'object',
                properties: {
                    type: { type: 'string' }
                }
            }
        }
    }, async (request, reply) => {
        const { type } = request.params as { type: string };
        const template = db.prepare('SELECT * FROM templates WHERE type = ?').get(type);
        if (!template) {
            return reply.status(404).send({ error: 'Template not found' });
        }
        return template;
    });

    app.put('/:type', {
        schema: {
            tags: ['Templates'],
            summary: 'Atualizar template',
            params: {
                type: 'object',
                properties: {
                    type: { type: 'string' }
                }
            },
            body: {
                type: 'object',
                properties: {
                    name: { type: 'string' },
                    html_content: { type: 'string' },
                    css_content: { type: 'string' },
                    width: { type: 'number' },
                    height: { type: 'number' }
                }
            }
        }
    }, async (request, reply) => {
        const { type } = request.params as { type: string };
        const body = request.body as any;

        try {
            const stmt = db.prepare(`
                UPDATE templates 
                SET name = COALESCE(?, name),
                    html_content = COALESCE(?, html_content),
                    css_content = COALESCE(?, css_content),
                    width = COALESCE(?, width),
                    height = COALESCE(?, height),
                    updated_at = CURRENT_TIMESTAMP
                WHERE type = ?
            `);

            const info = stmt.run(body.name, body.html_content, body.css_content, body.width, body.height, type);

            if (info.changes === 0) {
                // Tentar criar se não existir? Ou retornar 404?
                // Melhor retornar 404 para ser estrito, criação via POST se necessário (mas não está no escopo)
                return reply.status(404).send({ error: 'Template not found' });
            }

            return { success: true };
        } catch (error: any) {
            logger.error('Templates', `Erro ao atualizar template ${type}: ${error.message}`);
            return reply.status(500).send({ error: 'Internal Server Error' });
        }
    });
}
