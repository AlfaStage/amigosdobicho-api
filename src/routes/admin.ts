import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { RenderService } from '../services/RenderService.js';
import { scrapingStatusService } from '../services/ScrapingStatusService.js';
import { logger } from '../utils/logger.js';
import path from 'path';
import fs from 'fs';

export async function adminRoutes(app: FastifyInstance) {
    const server = app.withTypeProvider<ZodTypeProvider>();
    const renderService = new RenderService();

    // Página inicial redireciona para status
    server.get('/', async (req, reply) => {
        const queryString = new URL(req.url, 'http://localhost').search;
        return reply.redirect(`/admin/status${queryString}`);
    });

    // Helper para servir arquivos do build do Vite
    const serveAdminPage = (pagePath: string, reply: any) => {
        try {
            const fullPath = path.resolve('dist-admin/src/admin/pages', pagePath, 'index.html');
            const html = fs.readFileSync(fullPath, 'utf-8');
            reply.header('Content-Type', 'text/html');
            return reply.send(html);
        } catch (error) {
            logger.error('Admin', `Erro ao carregar página ${pagePath}:`, error);
            return reply.status(500).send({ error: 'Erro ao carregar recurso do admin' });
        }
    };

    server.get('/status', async (req, reply) => serveAdminPage('status', reply));
    server.get('/webhooks', async (req, reply) => serveAdminPage('webhooks', reply));
    server.get('/proxies', async (req, reply) => serveAdminPage('proxies', reply));
    server.get('/template', async (req, reply) => serveAdminPage('template', reply));
    server.get('/cotacoes', async (req, reply) => serveAdminPage('cotacoes', reply));

    // API: Obter Template Atual
    server.get('/api/template', {
        schema: {
            summary: 'Obter Template Atual',
            description: `
Retorna o template HTML atual usado para geração de imagens dos resultados.

### Exemplo de Requisição:
\`\`\`bash
curl -X GET "http://localhost:3002/admin/api/template"
\`\`\`

### Exemplo de Resposta (200 OK):
\`\`\`json
{
  "html": "<!DOCTYPE html>...<html>...</html>"
}
\`\`\`
            `,
            tags: ['⚙️ Admin'],
            response: {
                200: z.object({
                    html: z.string().describe('Template HTML completo')
                })
            }
        }
    }, async () => {
        return { html: await renderService.getTemplate() };
    });

    // API: Salvar Template
    server.post('/api/template', {
        schema: {
            summary: 'Salvar Template',
            description: `
Salva um novo template HTML para geração de imagens.

### Exemplo de Requisição:
\`\`\`bash
curl -X POST "http://localhost:3002/admin/api/template" \\
  -H "Content-Type: application/json" \\
  -d '{
    "html": "<!DOCTYPE html><html>...</html>"
  }'
\`\`\`

### Exemplo de Resposta (200 OK):
\`\`\`json
{
  "message": "Template salvo com sucesso!"
}
\`\`\`
            `,
            tags: ['⚙️ Admin'],
            body: z.object({
                html: z.string().describe('HTML do template completo')
            }),
            response: {
                200: z.object({
                    message: z.string()
                })
            }
        }
    }, async (req, reply) => {
        const { html } = req.body;
        await renderService.saveTemplate(html);
        return reply.send({ message: 'Template salvo com sucesso!' });
    });

    // API: Preview Template (Renderiza imagem temporária)
    server.post('/api/preview', {
        schema: {
            summary: 'Preview do Template',
            description: `
Gera um preview da imagem usando um template HTML personalizado com dados mockados.

Útil para testar templates antes de salvá-los definitivamente.

### Exemplo de Requisição:
\`\`\`bash
curl -X POST "http://localhost:3002/admin/api/preview" \\
  -H "Content-Type: application/json" \\
  -d '{
    "html": "<!DOCTYPE html><html>...</html>"
  }' \\
  --output preview.png
\`\`\`

### Exemplo de Resposta (200 OK):
\`\`\`json
{
  "image": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAA...",
  "html": "<!DOCTYPE html>..."
}
\`\`\`
            `,
            tags: ['⚙️ Admin'],
            body: z.object({
                html: z.string().describe('HTML do template para preview')
            }),
            response: {
                200: z.object({
                    image: z.string().describe('Imagem em base64 (data URI)'),
                    html: z.string().describe('HTML renderizado')
                }),
                500: z.object({
                    message: z.string(),
                    error: z.string(),
                    stack: z.string()
                }).describe('Erro ao gerar preview')
            }
        }
    }, async (req, reply) => {
        const { html } = req.body;

        // Mock de dados para preview
        const mockResultado = {
            data: '2026-02-04',
            horario: '16:20',
            loterica: 'LOOK Goiás (Preview)',
            premios: [
                { posicao: 1, milhar: '1234', grupo: 9, bicho: 'Cobra' },
                { posicao: 2, milhar: '5678', grupo: 20, bicho: 'Peru' },
                { posicao: 3, milhar: '9012', grupo: 3, bicho: 'Burro' },
                { posicao: 4, milhar: '3456', grupo: 14, bicho: 'Gato' },
                { posicao: 5, milhar: '7890', grupo: 23, bicho: 'Urso' },
                { posicao: 6, milhar: '1122', grupo: 6, bicho: 'Cabra' },
                { posicao: 7, milhar: '334', grupo: 9, bicho: 'Cobra' },
            ]
        };

        try {
            logger.info('Preview', 'Recebendo HTML:', html?.substring(0, 50) + '...');

            // Garantir que fontes estão carregadas
            await renderService.initFonts();

            const buffer = await renderService.renderImage(mockResultado, html);
            const htmlRendered = await renderService.renderHtml(mockResultado, html);

            logger.success('Preview', 'Sucesso. Tamanho do Buffer:', buffer.length);

            return {
                image: `data:image/png;base64,${buffer.toString('base64')}`,
                html: htmlRendered
            };
        } catch (error: any) {
            logger.error('Preview', 'Erro detalhado:', error);
            return reply.status(500).send({
                message: "Erro ao gerar preview",
                error: error.message,
                stack: error.stack
            });
        }
    });
}
