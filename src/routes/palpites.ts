import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import db from '../db.js';

export async function palpitesRoutes(app: FastifyInstance) {
    app.get('/', {
        schema: {
            tags: ['🦁 Palpites'],
            summary: 'Obter palpites do dia',
            description: 'Retorna os palpites gerados para o dia (disponíveis após as 07h00).',
            querystring: z.object({
                data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Data no formato YYYY-MM-DD (padrão: hoje)')
            }),
            response: {
                200: z.object({
                    data: z.string().describe('Data dos palpites (YYYY-MM-DD)'),
                    palpites: z.object({
                        grupos: z.array(z.object({
                            bicho: z.string().describe('Nome do bicho (ex: Elefante)'),
                            grupo: z.number().describe('Número do grupo (ex: 12)'),
                            dezenas: z.string().describe('Dezenas do grupo (ex: 45, 46, 47, 48)')
                        })).describe('Lista de grupos fortes para o dia'),
                        milhares: z.array(z.string()).describe('Lista de milhares sugeridas'),
                        centenas: z.array(z.string()).describe('Lista de centenas sugeridas')
                    }).nullable().describe('Dados dos palpites do dia (null se ainda não coletado)'),

                }).describe('Objeto contendo os palpites do dia')
            },
            examples: [
                {
                    data: "2026-02-12",
                    palpites: {
                        grupos: [
                            { bicho: "Elefante", grupo: 12, dezenas: "45, 46, 47, 48" }
                        ],
                        milhares: ["1458", "1484"],
                        centenas: ["145", "148"]
                    },
                    bingos: {
                        milhares: [
                            { numero: "8145", extracao: "LOTECE - CE...", premio: "6º Premio" }
                        ],
                        centenas: [],
                        grupos: []
                    }
                }
            ]
        }
    }, async (request, reply) => {
        const { data } = request.query as { data?: string };
        const queryDate = data || new Date().toISOString().split('T')[0];

        // Buscar Palpites
        const palpite = db.prepare('SELECT id FROM palpites_dia WHERE data = ?').get(queryDate) as { id: string } | undefined;
        let palpitesData = null;

        if (palpite) {
            const grupos = db.prepare('SELECT bicho, grupo, dezenas FROM palpites_grupos WHERE palpite_id = ?').all(palpite.id);
            const milhares = db.prepare('SELECT numero FROM palpites_milhares WHERE palpite_id = ?').all(palpite.id).map((m: any) => m.numero);
            const centenas = db.prepare('SELECT numero FROM palpites_centenas WHERE palpite_id = ?').all(palpite.id).map((c: any) => c.numero);

            palpitesData = {
                grupos,
                milhares,
                centenas
            };
        }



        return {
            data: queryDate,
            palpites: palpitesData
        };
    });

    // GET /bingos
    app.get('/bingos', {
        schema: {
            tags: ['🦁 Bingos'],
            summary: 'Obter bingos/resultados premiados',
            description: 'Retorna os resultados premiados/bingos (disponíveis após as 23h30).',
            querystring: z.object({
                data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Data no formato YYYY-MM-DD (padrão: hoje)')
            }),
            response: {
                200: z.object({
                    data: z.string().describe('Data dos bingos (YYYY-MM-DD)'),
                    bingos: z.object({
                        milhares: z.array(z.object({
                            numero: z.string(),
                            extracao: z.string(),
                            premio: z.string()
                        })),
                        centenas: z.array(z.object({
                            numero: z.string(),
                            extracao: z.string(),
                            premio: z.string()
                        })),
                        grupos: z.array(z.object({
                            numero: z.string(),
                            extracao: z.string(),
                            premio: z.string()
                        }))
                    }).nullable().describe('Resultados premiados/bingos do dia (null se ainda não coletado)')
                })
            }
        }
    }, async (request, reply) => {
        const { data } = request.query as { data?: string };
        const queryDate = data || new Date().toISOString().split('T')[0];

        // Buscar Bingos
        const bingo = db.prepare('SELECT id FROM bingos_dia WHERE data = ?').get(queryDate) as { id: string } | undefined;
        let bingosData = null;

        if (bingo) {
            const premios = db.prepare('SELECT tipo, numero, extracao, premio FROM bingos_premios WHERE bingo_id = ?').all(bingo.id) as any[];

            bingosData = {
                milhares: premios.filter(p => p.tipo === 'milhar').map(({ numero, extracao, premio }) => ({ numero, extracao, premio })),
                centenas: premios.filter(p => p.tipo === 'centena').map(({ numero, extracao, premio }) => ({ numero, extracao, premio })),
                grupos: premios.filter(p => p.tipo === 'grupo').map(({ numero, extracao, premio }) => ({ numero, extracao, premio }))
            };
        }

        return {
            data: queryDate,
            bingos: bingosData
        };
    });
}
