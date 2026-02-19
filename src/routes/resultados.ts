import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import db from '../db.js';
import { RenderService } from '../services/RenderService.js';
import { logger } from '../utils/logger.js';

export async function resultadosRoutes(app: FastifyInstance) {
    const server = app.withTypeProvider<ZodTypeProvider>();
    const renderService = new RenderService();

    // ===============
    // LISTAR RESULTADOS
    // ===============
    server.get('/', {
        schema: {
            summary: 'Listar Resultados',
            description: `
Retorna uma lista dos últimos resultados filtrados por data ou lotérica.

### Exemplo de Requisição:
\`\`\`bash
# Listar últimos 20 resultados
curl -X GET "http://localhost:3002/v1/resultados" \\
  -H "x-api-key: SUA_API_KEY"

# Filtrar por data específica
curl -X GET "http://localhost:3002/v1/resultados?data=2026-02-04" \\
  -H "x-api-key: SUA_API_KEY"

# Filtrar por lotérica e data
curl -X GET "http://localhost:3002/v1/resultados?data=2026-02-04&loterica=pt-rio" \\
  -H "x-api-key: SUA_API_KEY"
\`\`\`

### Exemplo de Resposta (200 OK):
\`\`\`json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "data": "2026-02-04",
    "horario": "16:20",
    "loterica": "PT Rio / Deu no Poste",
    "share_url": "http://localhost:3002/v1/resultados/550e8400-e29b-41d4-a716-446655440000/html",
    "image_url": "http://localhost:3002/v1/resultados/550e8400-e29b-41d4-a716-446655440000/image",
    "premios": [
      { "posicao": 1, "milhar": "1234", "grupo": 9, "bicho": "Cobra" },
      { "posicao": 2, "milhar": "5678", "grupo": 20, "bicho": "Peru" },
      { "posicao": 3, "milhar": "9012", "grupo": 3, "bicho": "Burro" },
      { "posicao": 4, "milhar": "3456", "grupo": 14, "bicho": "Gato" },
      { "posicao": 5, "milhar": "7890", "grupo": 23, "bicho": "Urso" }
    ]
  }
]
\`\`\`

### Lotéricas Disponíveis:
- \`pt-rio\` - PT Rio / Deu no Poste
- \`look-goias\` - LOOK Goiás
- \`federal\` - Federal
- \`maluca\` - Maluca
- \`lotece\` - Lotece (Ceará)
            `,
            tags: ['📊 Resultados'],
            querystring: z.object({
                data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato deve ser YYYY-MM-DD").optional()
                    .describe('Filtra por data específica (ex: 2026-02-04)'),
                loterica: z.string().optional()
                    .describe('Filtra por slug da lotérica (ex: pt-rio, look-goias, federal)'),
            }),
            response: {
                200: z.array(z.object({
                    id: z.string().uuid().describe('UUID único do resultado'),
                    data: z.string().describe('Data do sorteio (YYYY-MM-DD)'),
                    horario: z.string().describe('Horário do sorteio (HH:MM)'),
                    loterica: z.string().describe('Nome da lotérica/banca'),
                    share_url: z.string().url().describe('URL para compartilhamento (HTML embeddable)'),
                    image_url: z.string().url().describe('URL da imagem gerada do resultado'),
                    premios: z.array(z.object({
                        posicao: z.number().int().min(1).describe('Posição do prêmio (1-n)'),
                        milhar: z.string().describe('Número sorteado (milhar)'),
                        grupo: z.number().int().describe('Grupo do bicho (1-25)'),
                        bicho: z.string().describe('Nome do bicho'),
                    })).describe('Array com os prêmios do sorteio')
                })).describe('Lista de resultados encontrados (máx. 20)')
            }
        }
    }, async (request, reply) => {
        const { data, loterica } = request.query;

        let query = `
      SELECT r.id, r.data, r.horario, l.nome as loterica
      FROM resultados r
      JOIN lotericas l ON r.loterica_slug = l.slug
      WHERE 1=1
    `;
        const params: any[] = [];

        if (data) {
            query += ' AND r.data = ?';
            params.push(data);
        }

        if (loterica) {
            query += ' AND r.loterica_slug = ?';
            params.push(loterica);
        }

        query += ' ORDER BY r.data DESC, r.horario DESC LIMIT 20';

        const stmt = db.prepare(query);
        const resultados = stmt.all(...params) as any[];

        const response = [];
        const premiosStmt = db.prepare(`
            SELECT posicao, milhar, grupo, bicho 
            FROM premios WHERE resultado_id = ? ORDER BY posicao ASC
        `);

        // Obter URL base
        const protocol = request.protocol;
        const host = request.host; // Inclui porta se houver
        const baseUrl = process.env.BASE_URL || `${protocol}://${host}`;

        for (const r of resultados) {
            const premios = premiosStmt.all(r.id);
            response.push({
                ...r,
                share_url: `${baseUrl}/v1/resultados/${r.id}/html`,
                image_url: `${baseUrl}/v1/resultados/${r.id}/image`,
                premios
            });
        }

        return response;
    });

    // ===============
    // ENDPOINT HTML (IFRAME)
    // ===============
    server.get('/:id/html', {
        schema: {
            summary: 'Obter HTML do Resultado (Iframe)',
            description: `
Retorna uma página HTML completa do resultado para embed em iframes.

### Exemplo de Uso:
\`\`\`html
<iframe 
  src="http://localhost:3002/v1/resultados/550e8400-e29b-41d4-a716-446655440000/html"
  width="600" 
  height="800"
  frameborder="0">
</iframe>
\`\`\`

### Exemplo cURL:
\`\`\`bash
curl -X GET "http://localhost:3002/v1/resultados/550e8400-e29b-41d4-a716-446655440000/html" \\
  -H "x-api-key: SUA_API_KEY"
\`\`\`
            `,
            tags: ['🖼️ Compartilhamento'],
            params: z.object({
                id: z.string().uuid().describe('UUID do resultado')
            }),
            response: {
                200: z.string().describe('HTML da página do resultado'),
                404: z.object({
                    error: z.string().describe('Mensagem de erro'),
                    message: z.string().describe('Detalhes do erro')
                }).describe('Resultado não encontrado')
            }
        }
    }, async (req, reply) => {
        const { id } = req.params;
        const resultado = getResultadoById(id);

        if (!resultado) return reply.status(404).send({
            error: "Not Found",
            message: "Resultado não encontrado."
        });

        const html = await renderService.renderHtml(resultado);
        reply.header('Content-Type', 'text/html');
        return reply.send(html);
    });

    // ===============
    // ENDPOINT IMAGEM (PNG)
    // ===============
    server.get('/:id/image', {
        schema: {
            summary: 'Obter Imagem do Resultado (PNG)',
            description: `
Gera e retorna uma imagem PNG do resultado para compartilhamento em redes sociais.

### Exemplo cURL:
\`\`\`bash
# Baixar imagem
curl -X GET "http://localhost:3002/v1/resultados/550e8400-e29b-41d4-a716-446655440000/image" \\
  -H "x-api-key: SUA_API_KEY" \\
  --output resultado.png
\`\`\`

### Uso em HTML:
\`\`\`html
<img src="http://localhost:3002/v1/resultados/550e8400-e29b-41d4-a716-446655440000/image" 
     alt="Resultado do Jogo do Bicho" />
\`\`\`

### Resposta:
- **Content-Type:** image/png
- **Tamanho:** Aproximadamente 100-300KB
            `,
            tags: ['🖼️ Compartilhamento'],
            params: z.object({
                id: z.string().uuid().describe('UUID do resultado')
            }),
            response: {
                200: z.any().describe('Imagem PNG em formato binário'),
                404: z.object({
                    error: z.string(),
                    message: z.string()
                }).describe('Resultado não encontrado'),
                500: z.object({
                    error: z.string(),
                    message: z.string()
                }).describe('Erro ao gerar imagem')
            }
        }
    }, async (req, reply) => {
        const { id } = req.params;
        const resultado = getResultadoById(id);

        if (!resultado) return reply.status(404).send({
            error: "Not Found",
            message: "Resultado não encontrado."
        });

        try {
            const buffer = await renderService.renderImage(resultado);
            reply.header('Content-Type', 'image/png');
            return reply.send(buffer);
        } catch (error: any) {
            logger.error('ResultadosRoute', 'Erro ao gerar imagem:', error);
            return reply.status(500).send({
                error: "Erro ao gerar imagem.",
                message: error.message || "Erro desconhecido"
            });
        }
    });

    // Helper para buscar resultado completo
    function getResultadoById(id: string) {
        const r = db.prepare(`
            SELECT r.id, r.data, r.horario, l.nome as loterica
            FROM resultados r
            JOIN lotericas l ON r.loterica_slug = l.slug
            WHERE r.id = ?
        `).get(id) as any;

        if (!r) return null;

        const premios = db.prepare(`
            SELECT posicao, milhar, grupo, bicho 
            FROM premios WHERE resultado_id = ? ORDER BY posicao ASC
        `).all(id);

        return { ...r, premios };
    }
}
