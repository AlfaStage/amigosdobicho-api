import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import db from '../db.js';

export async function horoscopoRoutes(app: FastifyInstance) {
    const server = app.withTypeProvider<ZodTypeProvider>();

    server.get('/', {
        schema: {
            summary: 'Horóscopo do Dia (Todos os Signos)',
            description: `
Retorna as previsões do horóscopo para todos os 12 signos do zodíaco. Se não informada, usa a data atual.

### Signos Disponíveis:
- Áries ♈
- Touro ♉
- Gêmeos ♊
- Câncer ♋
- Leão ♌
- Virgem ♍
- Libra ♎
- Escorpião ♏
- Sagitário ♐
- Capricórnio ♑
- Aquário ♒
- Peixes ♓

### Exemplos de Requisição:

#### Horóscopo de hoje:
\`\`\`bash
curl -X GET "http://localhost:3002/v1/horoscopo" \\
  -H "x-api-key: SUA_API_KEY"
\`\`\`

#### Horóscopo de data específica:
\`\`\`bash
curl -X GET "http://localhost:3002/v1/horoscopo?data=2026-02-04" \\
  -H "x-api-key: SUA_API_KEY"
\`\`\`

### Exemplo de Resposta (200 OK):
\`\`\`json
[
  {
    "signo": "Áries",
    "texto": "Hoje é um dia favorável para novos projetos. Sua energia está alta e o universo conspira a seu favor. Aproveite para tomar decisões importantes.",
    "numeros": "09, 21, 34, 45, 67",
    "data": "2026-02-04"
  },
  {
    "signo": "Touro",
    "texto": "Momento de reflexão e planejamento. Cuide das suas finanças e evite gastos desnecessários. A paciência será sua aliada.",
    "numeros": "12, 28, 39, 51, 73",
    "data": "2026-02-04"
  }
  // ... outros 10 signos
]
\`\`\`

### Exemplo de Resposta (400 Bad Request):
\`\`\`json
{
  "error": "Data inválida",
  "message": "Não é possível consultar datas futuras"
}
\`\`\`

### Notas:
- Não é possível consultar datas futuras
- Os números da sorte são atualizados diariamente
- O horóscopo é atualizado automaticamente todos os dias às 06:00
            `,
            tags: ['🔮 Horóscopo'],
            querystring: z.object({
                data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato deve ser YYYY-MM-DD").optional()
                    .describe('Data da previsão (ex: 2026-02-04). Padrão: data atual.')
            }),
            response: {
                200: z.array(z.object({
                    signo: z.string().describe('Nome do signo'),
                    texto: z.string().nullable().describe('Texto da previsão astrológica'),
                    numeros: z.string().nullable().describe('Números da sorte (separados por vírgula)'),
                    data: z.string().describe('Data da previsão (YYYY-MM-DD)')
                })).describe('Array com previsões dos 12 signos'),
                400: z.object({
                    error: z.string().describe('Tipo do erro'),
                    message: z.string().describe('Mensagem detalhada do erro')
                }).describe('Erro de validação - data inválida ou futura')
            }
        }
    }, async (request, reply) => {
        const { data } = request.query;
        const targetDate = data || new Date().toISOString().split('T')[0];
        
        // Validar se data não é futura
        const today = new Date().toISOString().split('T')[0];
        if (targetDate > today) {
            return reply.status(400).send({ 
                error: 'Data inválida', 
                message: 'Não é possível consultar datas futuras' 
            });
        }
        
        // Retornar do banco
        const stmt = db.prepare('SELECT signo, texto, numeros, data FROM horoscopo_diario WHERE data = ?');
        const results = stmt.all(targetDate);

        return results as any[];
    });

    // Rota por signo específico
    server.get('/:signo', {
        schema: {
            summary: 'Horóscopo por Signo Específico',
            description: `
Retorna a previsão para um signo específico do zodíaco.

### Exemplos de Requisição:

#### Consultar Áries:
\`\`\`bash
curl -X GET "http://localhost:3002/v1/horoscopo/aries" \\
  -H "x-api-key: SUA_API_KEY"
\`\`\`

#### Consultar Leão com data específica:
\`\`\`bash
curl -X GET "http://localhost:3002/v1/horoscopo/leao?data=2026-02-04" \\
  -H "x-api-key: SUA_API_KEY"
\`\`\`

#### Aceita acentos e variações:
\`\`\`bash
# Todas estas requisições funcionam:
curl -X GET "http://localhost:3002/v1/horoscopo/cancer" -H "x-api-key: SUA_API_KEY"
curl -X GET "http://localhost:3002/v1/horoscopo/câncer" -H "x-api-key: SUA_API_KEY"
curl -X GET "http://localhost:3002/v1/horoscopo/CANCER" -H "x-api-key: SUA_API_KEY"
\`\`\`

### Exemplo de Resposta (200 OK):
\`\`\`json
{
  "signo": "Leão",
  "texto": "Dia de brilhar! Sua criatividade está em alta e novas oportunidades surgirão. Aproveite para socializar e expandir seus horizontes.",
  "numeros": "05, 18, 29, 42, 56",
  "data": "2026-02-04"
}
\`\`\`

### Exemplo de Resposta (Signo não encontrado - retorna mensagem padrão):
\`\`\`json
{
  "signo": "Signoinvalido",
  "texto": "Previsão não disponível para esta data. Consulte novamente mais tarde.",
  "numeros": null,
  "data": "2026-02-04"
}
\`\`\`

### Lista de Signos Válidos:
- \`aries\` ou \`áries\`
- \`touro\`
- \`gemeos\` ou \`gêmeos\`
- \`cancer\` ou \`câncer\`
- \`leao\` ou \`leão\`
- \`virgem\`
- \`libra\`
- \`escorpiao\` ou \`escorpião\`
- \`sagitario\` ou \`sagitário\`
- \`capricornio\` ou \`capricórnio\`
- \`aquario\` ou \`aquário\`
- \`peixes\`
            `,
            tags: ['🔮 Horóscopo'],
            params: z.object({
                signo: z.string().describe('Nome do signo (ex: aries, leao, touro, cancer) - aceita com ou sem acentos')
            }),
            querystring: z.object({
                data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato deve ser YYYY-MM-DD").optional()
                    .describe('Data da previsão (ex: 2026-02-04). Padrão: data atual.')
            }),
            response: {
                200: z.object({
                    signo: z.string().describe('Nome do signo'),
                    texto: z.string().nullable().describe('Texto da previsão'),
                    numeros: z.string().nullable().describe('Números da sorte'),
                    data: z.string().describe('Data da previsão')
                }).describe('Previsão do signo solicitado'),
                400: z.object({
                    error: z.string(),
                    message: z.string()
                }).describe('Data inválida ou futura')
            }
        }
    }, async (request, reply) => {
        const { signo } = request.params;
        const { data } = request.query;
        const targetDate = data || new Date().toISOString().split('T')[0];

        // Validar se data não é futura
        const today = new Date().toISOString().split('T')[0];
        if (targetDate > today) {
            return reply.status(400).send({ 
                error: 'Data inválida', 
                message: 'Não é possível consultar datas futuras' 
            });
        }

        // Normalizar signo (sem acentos)
        const signoNorm = signo.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

        const stmt = db.prepare('SELECT signo, texto, numeros, data FROM horoscopo_diario WHERE data = ?');
        const results = stmt.all(targetDate) as any[];

        const found = results.find(r => {
            const rNorm = r.signo.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            return rNorm === signoNorm;
        });

        if (found) return found;

        // Se não houver dados no banco, retornar previsão genérica
        return {
            signo: signo.charAt(0).toUpperCase() + signo.slice(1).toLowerCase(),
            texto: 'Previsão não disponível para esta data. Consulte novamente mais tarde.',
            numeros: null,
            data: targetDate
        };
    });
}
