import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import fs from 'fs/promises';
import path from 'path';

export async function comoJogarRoutes(app: FastifyInstance) {
    const server = app.withTypeProvider<ZodTypeProvider>();

    const getSection = (content: string, header: string) => {
        const regex = new RegExp(`#{2,3} ${header}([\\s\\S]*?)(?=\\n#{2,3} |$)`, 'i');
        const match = content.match(regex);
        return match ? match[1].trim() : 'Seção não encontrada.';
    };

    const readContent = async () => {
        // Tenta vários caminhos para ser resiliente a diferentes estruturas de deploy
        const paths = [
            path.resolve('src/data/historia.md'),
            path.resolve('dist/src/data/historia.md'),
            path.join(process.cwd(), 'src/data/historia.md')
        ];

        for (const p of paths) {
            try {
                return await fs.readFile(p, 'utf-8');
            } catch { }
        }
        throw new Error('Arquivo historia.md não encontrado.');
    };

    // Rota Principal (Todo o conteúdo)
    server.get('/', {
        schema: {
            summary: '📖 Instruções Completas de Como Jogar',
            description: `
Retorna todo o conteúdo educacional sobre o Jogo do Bicho em formato Markdown.

Inclui:
- Regras básicas do jogo
- Tabela completa de grupos e dezenas
- Modalidades de aposta
- Curiosidades históricas
- Dicas de apostas

### Exemplo de Requisição:
\`\`\`bash
curl -X GET "http://localhost:3002/v1/como-jogar" \\
  -H "x-api-key: SUA_API_KEY"
\`\`\`

### Exemplo de Resposta (200 OK):
\`\`\`json
{
  "content": "# Como Jogar no Jogo do Bicho\\n\\n## Regras Básicas\\nO Jogo do Bicho é uma loteria..."
}
\`\`\`

### Uso Recomendado:
Este endpoint é ideal para aplicativos que querem exibir o conteúdo completo em uma página de ajuda ou tutorial.

### Formato:
O conteúdo é retornado em **Markdown**, pronto para ser renderizado em qualquer visualizador Markdown.
            `,
            tags: ['ℹ️ Info'],
            response: { 
                200: z.object({ 
                    content: z.string().describe('Conteúdo completo em formato Markdown') 
                })
            }
        }
    }, async () => {
        try {
            const content = await readContent();
            return { content };
        } catch (error) {
            return { content: 'Conteúdo ainda não disponível.' };
        }
    });

    // Sub-rotas para partes específicas
    const sections = [
        { 
            path: '/regras', 
            header: 'Regras Básicas', 
            summary: '📋 Regras Básicas do Jogo',
            description: 'Regras fundamentais e funcionamento do Jogo do Bicho.'
        },
        { 
            path: '/tabela', 
            header: 'Tabela de Grupos e Dezenas', 
            summary: '📊 Tabela Completa de Animais',
            description: 'Lista completa dos 25 grupos com seus respectivos animais e dezenas.'
        },
        { 
            path: '/modalidades', 
            header: 'Modalidades de Aposta', 
            summary: '🎲 Modalidades de Aposta',
            description: 'Diferentes formas de apostar: Grupo, Dezena, Centena, Milhar, etc.'
        },
        { 
            path: '/historia', 
            header: 'Curiosidades Históricas', 
            summary: '📚 História do Jogo do Bicho',
            description: 'Origem, curiosidades e evolução histórica do jogo.'
        },
        { 
            path: '/dicas', 
            header: 'Dicas de Apostas', 
            summary: '💡 Dicas e Estratégias',
            description: 'Dicas úteis e estratégias para apostar de forma consciente.'
        },
    ];

    for (const section of sections) {
        server.get(section.path, {
            schema: {
                summary: section.summary,
                description: `
${section.description}

### Exemplo de Requisição:
\`\`\`bash
curl -X GET "http://localhost:3002/v1/como-jogar${section.path}" \\
  -H "x-api-key: SUA_API_KEY"
\`\`\`

### Exemplo de Resposta (200 OK):
\`\`\`json
{
  "content": "Conteúdo específico da seção em formato Markdown..."
}
\`\`\`
                `,
                tags: ['ℹ️ Info'],
                response: { 
                    200: z.object({ 
                        content: z.string().describe(`Conteúdo da seção: ${section.header}`) 
                    })
                }
            }
        }, async () => {
            try {
                const content = await readContent();
                return { content: getSection(content, section.header) };
            } catch (error) {
                return { content: 'Seção indisponível.' };
            }
        });
    }
}
