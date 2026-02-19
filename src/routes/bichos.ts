import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { bichosData, getBichoByDezena, getBichoByGrupo, getBichoByNome } from '../utils/bichos.js';

export async function bichosRoutes(app: FastifyInstance) {
    const server = app.withTypeProvider<ZodTypeProvider>();

    server.get('/', {
        schema: {
            summary: 'Listar Todos os Bichos',
            description: `
Retorna a tabela completa de bichos (grupos de 1 a 25) com suas dezenas associadas.

### Exemplo de Requisição:
\`\`\`bash
curl -X GET "http://localhost:3002/v1/bichos" \\
  -H "x-api-key: SUA_API_KEY"
\`\`\`

### Exemplo de Resposta (200 OK):
\`\`\`json
[
  { "grupo": 1, "nome": "Avestruz", "dezenas": ["01", "02", "03", "04"] },
  { "grupo": 2, "nome": "Águia", "dezenas": ["05", "06", "07", "08"] },
  { "grupo": 3, "nome": "Burro", "dezenas": ["09", "10", "11", "12"] },
  { "grupo": 4, "nome": "Borboleta", "dezenas": ["13", "14", "15", "16"] },
  { "grupo": 5, "nome": "Cachorro", "dezenas": ["17", "18", "19", "20"] }
  // ... grupos 6 a 25
]
\`\`\`

### Significado dos Grupos:
Cada grupo representa um animal e contém 4 dezenas. Por exemplo:
- **Grupo 1 (Avestruz):** 01, 02, 03, 04
- **Grupo 9 (Cobra):** 21, 22, 23, 24
- **Grupo 25 (Vaca):** 97, 98, 99, 00
            `,
            tags: ['🦁 Bichos'],
            response: {
                200: z.array(z.object({
                    grupo: z.number().int().min(1).max(25).describe('Número do grupo (1-25)'),
                    nome: z.string().describe('Nome do animal'),
                    dezenas: z.array(z.string()).describe('Array com 4 dezenas (00-99)'),
                })).describe('Lista completa dos 25 grupos de bichos')
            }
        }
    }, async () => {
        return bichosData;
    });

    server.get('/:query', {
        schema: {
            summary: 'Buscar Bicho por Grupo, Dezena ou Nome',
            description: `
Busca um bicho específico. A query pode ser:
- **Número do grupo** (1-25): Ex: \`9\`, \`15\`, \`25\`
- **Dezena específica** (00-99): Ex: \`23\`, \`07\`, \`00\`
- **Nome do bicho**: Ex: \`cavalo\`, \`cobra\`, \`elefante\`

### Exemplos de Requisição:

#### Buscar por grupo:
\`\`\`bash
curl -X GET "http://localhost:3002/v1/bichos/9" \\
  -H "x-api-key: SUA_API_KEY"
\`\`\`

#### Buscar por dezena:
\`\`\`bash
curl -X GET "http://localhost:3002/v1/bichos/23" \\
  -H "x-api-key: SUA_API_KEY"
\`\`\`

#### Buscar por nome:
\`\`\`bash
curl -X GET "http://localhost:3002/v1/bichos/cobra" \\
  -H "x-api-key: SUA_API_KEY"
\`\`\`

### Exemplo de Resposta (200 OK):
\`\`\`json
[
  {
    "grupo": 9,
    "nome": "Cobra",
    "dezenas": ["21", "22", "23", "24"]
  }
]
\`\`\`

### Exemplo de Resposta (404 Not Found):
\`\`\`json
null
\`\`\`

### Notas:
- A busca por nome é case-insensitive (\`COBRA\`, \`cobra\`, \`Cobra\` retornam o mesmo resultado)
- Se uma dezena pertencer a um grupo, o sistema retorna o bicho correspondente
- Buscas por dezenas são normalizadas (\`5\` é convertido para \`05\`)
            `,
            tags: ['🦁 Bichos'],
            params: z.object({
                query: z.string().describe('Número do grupo (1-25), dezena (00-99) ou nome do bicho')
            }),
            response: {
                200: z.array(z.object({
                    grupo: z.number().int().describe('Número do grupo (1-25)'),
                    nome: z.string().describe('Nome do animal'),
                    dezenas: z.array(z.string()).describe('Dezenas associadas'),
                })).describe('Lista de bichos encontrados (geralmente 1 item)'),
                404: z.null().describe('Nenhum bicho encontrado para a query informada')
            }
        }
    }, async (req, reply) => {
        const { query } = req.params;
        const matches: any[] = [];

        // 1. Verificar se é um grupo (1-25)
        const grupoNum = parseInt(query);
        if (!isNaN(grupoNum) && grupoNum >= 1 && grupoNum <= 25) {
            const bicho = getBichoByGrupo(grupoNum);
            if (bicho) matches.push(bicho);
        }

        // 2. Verificar se é uma dezena (00-99)
        // Normaliza a dezena para garantir 2 dígitos se for busca por dezena específica
        const dezenaBusca = query.padStart(2, '0');
        const bichoPorDezena = getBichoByDezena(dezenaBusca);

        if (bichoPorDezena) {
            // Evitar duplicidade se o grupo já foi adicionado
            if (!matches.some(m => m.grupo === bichoPorDezena.grupo)) {
                matches.push(bichoPorDezena);
            }
        }

        if (matches.length > 0) {
            return matches;
        }

        // 3. Verificar se é uma busca por nome (ex: cavalo, elefante)
        const bichoPorNome = getBichoByNome(query);
        if (bichoPorNome) {
            return [bichoPorNome];
        }

        return reply.status(404).send(null);
    });
}
