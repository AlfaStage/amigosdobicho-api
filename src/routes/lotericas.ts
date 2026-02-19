import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import db from '../db.js';

export async function lotericasRoutes(app: FastifyInstance) {
    const server = app.withTypeProvider<ZodTypeProvider>();

    server.get('/', {
        schema: {
            summary: 'Listar Lotéricas Disponíveis',
            description: `
Retorna a lista completa de lotéricas e bancas disponíveis na API.

### Exemplo de Requisição:
\`\`\`bash
curl -X GET "http://localhost:3002/v1/lotericas" \\
  -H "x-api-key: SUA_API_KEY"
\`\`\`

### Exemplo de Resposta (200 OK):
\`\`\`json
[
  {
    "slug": "pt-rio",
    "nome": "PT Rio / Deu no Poste"
  },
  {
    "slug": "look-goias",
    "nome": "LOOK Goiás"
  },
  {
    "slug": "federal",
    "nome": "Federal"
  },
  {
    "slug": "maluca",
    "nome": "Maluca"
  },
  {
    "slug": "lotece",
    "nome": "Lotece (Ceará)"
  },
  {
    "slug": "ceara",
    "nome": "Ceará"
  }
]
\`\`\`

### Uso dos Slugs:
Os slugs retornados podem ser usados para filtrar resultados:
\`\`\`bash
curl -X GET "http://localhost:3002/v1/resultados?loterica=pt-rio" \\
  -H "x-api-key: SUA_API_KEY"
\`\`\`

### Lotéricas Disponíveis:
| Slug | Nome | Horários Principais |
|------|------|---------------------|
| pt-rio | PT Rio / Deu no Poste | 11:00, 14:00, 16:00, 18:00, 21:00 |
| look-goias | LOOK Goiás | 11:20, 14:00, 16:00, 18:00, 21:00 |
| federal | Federal | 19:00 (quarta e sábado) |
| maluca | Maluca | Vários horários |
| lotece | Lotece (Ceará) | Vários horários |
| ceara | Ceará | Vários horários |
            `,
            tags: ['🏪 Lotéricas'],
            response: {
                200: z.array(z.object({
                    slug: z.string().describe('Slug único da banca (ex: pt-rio, look-goias)'),
                    nome: z.string().describe('Nome legível da lotérica'),
                })).describe('Lista de todas as lotéricas disponíveis')
            }
        }
    }, async () => {
        const stmt = db.prepare('SELECT slug, nome FROM lotericas');
        return stmt.all() as any[];
    });
}
