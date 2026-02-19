import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { NumerologyService } from '../services/NumerologyService.js';

export async function numerologiaRoutes(app: FastifyInstance) {
    const server = app.withTypeProvider<ZodTypeProvider>();
    const service = new NumerologyService();

    server.get('/', {
        schema: {
            summary: 'Calcular Numerologia',
            description: `
Calcula o número da sorte baseado no nome fornecido utilizando a **Tabela Pitagórica**.

### Tabela Pitagórica:
\`\`\`
1 2 3 4 5 6 7 8 9
A B C D E F G H I
J K L M N O P Q R
S T U V W X Y Z
\`\`\`

### Como Funciona:
1. Cada letra é convertida em seu valor numérico
2. Os valores são somados
3. O resultado é reduzido a um único dígito (1-9)
4. Retorna o significado desse número

### Exemplos de Requisição:

#### Calcular para nome simples:
\`\`\`bash
curl -X GET "http://localhost:3002/v1/numerologia?nome=Maria" \\
  -H "x-api-key: SUA_API_KEY"
\`\`\`

#### Calcular para nome completo:
\`\`\`bash
curl -X GET "http://localhost:3002/v1/numerologia?nome=João+Silva" \\
  -H "x-api-key: SUA_API_KEY"
\`\`\`

#### Com caracteres especiais:
\`\`\`bash
curl -X GET "http://localhost:3002/v1/numerologia?nome=Antônio+Carlos" \\
  -H "x-api-key: SUA_API_KEY"
\`\`\`

### Exemplo de Resposta (200 OK):
\`\`\`json
{
  "input": "João Silva",
  "cleanInput": "joao silva",
  "sum": 37,
  "luckyNumber": 1,
  "details": "J(1) + O(6) + A(1) + O(6) + S(1) + I(9) + L(3) + V(4) + A(1) = 37 → 3+7 = 10 → 1+0 = 1",
  "meaning": "Liderança, independência e originalidade. Pessoas com número 1 são pioneiras, ambiciosas e determinadas."
}
\`\`\`

### Significados dos Números:
| Número | Significado |
|--------|-------------|
| 1 | Liderança, independência, originalidade |
| 2 | Cooperação, diplomacia, sensibilidade |
| 3 | Criatividade, comunicação, expressão |
| 4 | Organização, praticidade, construção |
| 5 | Liberdade, aventura, versatilidade |
| 6 | Responsabilidade, harmonia, proteção |
| 7 | Espiritualidade, análise, introspecção |
| 8 | Poder, ambição, sucesso material |
| 9 | Humanitarismo, compaixão, idealismo |

### Notas:
- Espaços são ignorados no cálculo
- Acentos são normalizados automaticamente
- Não é necessário URL encode para espaços (pode usar + ou %20)
            `,
            tags: ['🔢 Numerologia'],
            querystring: z.object({
                nome: z.string().min(1).max(100).describe('Nome completo para calcular a numerologia (ex: Maria Silva, João Carlos)')
            }),
            response: {
                200: z.object({
                    input: z.string().describe('Nome original enviado'),
                    cleanInput: z.string().describe('Nome normalizado (minúsculas, sem acentos)'),
                    sum: z.number().describe('Soma total dos valores das letras'),
                    luckyNumber: z.number().min(1).max(9).describe('Número da sorte reduzido (1-9)'),
                    details: z.string().describe('Detalhamento do cálculo passo a passo'),
                    meaning: z.string().describe('Significado e interpretação do número')
                }).describe('Resultado completo da análise numerológica')
            }
        }
    }, async (req, reply) => {
        const { nome } = req.query;
        return service.calculate(nome);
    });
}
