import { type FastifyInstance } from 'fastify';
import { BICHOS } from '../config/bichos.js';
import { LOTERICAS } from '../config/lotericas.js';
import { getDb } from '../database/schema.js';
import { getResultados, getResultadoById } from '../services/AmigosDoBichoService.js';
import { getPalpitesDia, getPremiadosDia, getPremiadoById } from '../services/ScraperService.js';
import { calcularNumerologia } from '../services/NumerologiaService.js';
import { getHoroscopo } from '../services/HoroscopoService.js';
import {
    renderResultadoHtml, renderResultadoImage,
    renderPalpitesHtml, renderPalpitesImage,
    renderPremiadoUnitarioHtml, renderPremiadoUnitarioImage,
    renderPremiadosDiaHtml, renderPremiadosDiaImage,
    renderCotacoesHtml, renderCotacoesImage,
} from '../services/RenderService.js';
import { todayStr, formatDateBR } from '../utils/helpers.js';

export async function registerPublicRoutes(app: FastifyInstance): Promise<void> {
    // ==================== RESULTADOS ====================
    app.get('/v1/resultados', {
        schema: {
            tags: ['Resultados'],
            summary: 'Buscar resultados por data e/ou lotérica',
            querystring: {
                type: 'object',
                required: ['data'],
                properties: {
                    data: { type: 'string', description: 'Data no formato YYYY-MM-DD', examples: ['2026-02-20'] },
                    loterica: { type: 'string', description: 'Slug da lotérica', examples: ['pt-rio'] },
                },
            },
            response: { 200: { type: 'array', items: { type: 'object', additionalProperties: true }, description: 'Lista de resultados', examples: [[{ id: 'uuid', loterica_slug: 'pt-rio', data: '2026-02-20', horario: '14:00', premio1: '1234', grupo1: 7, bicho1: 'Carneiro' }]] } },
        },
    }, async (req) => {
        const { data, loterica } = req.query as any;
        return getResultados(data, loterica);
    });



    app.get('/v1/resultados/:id', {
        schema: {
            tags: ['Resultados'],
            summary: 'Buscar resultado por ID',
            params: { type: 'object', properties: { id: { type: 'string' } } },
        },
    }, async (req, reply) => {
        const { id } = req.params as any;
        const result = getResultadoById(id);
        if (!result) return reply.code(404).send({ error: 'Resultado not found' });
        return result;
    });

    app.get('/v1/resultados/:id/html', {
        schema: { tags: ['Resultados'], summary: 'Resultado renderizado como HTML', params: { type: 'object', properties: { id: { type: 'string' } } } },
    }, async (req, reply) => {
        const { id } = req.params as any;
        const result = getResultadoById(id);
        if (!result) return reply.code(404).send({ error: 'Resultado not found' });
        const html = renderResultadoHtml(result);
        reply.type('text/html').send(html);
    });

    app.get('/v1/resultados/:id/image', {
        schema: { tags: ['Resultados'], summary: 'Resultado renderizado como imagem PNG', params: { type: 'object', properties: { id: { type: 'string' } } } },
    }, async (req, reply) => {
        const { id } = req.params as any;
        const result = getResultadoById(id);
        if (!result) return reply.code(404).send({ error: 'Resultado not found' });
        const png = await renderResultadoImage(result);
        reply.type('image/png').send(png);
    });

    // ==================== LOTÉRICAS ====================
    app.get('/v1/lotericas', {
        schema: {
            tags: ['Lotéricas'],
            summary: 'Lista completa de lotéricas e horários',
            response: { 200: { type: 'array', items: { type: 'object', properties: { slug: { type: 'string' }, nome: { type: 'string' }, estado: { type: 'string' }, horarios: { type: 'array', items: { type: 'object', properties: { horario: { type: 'string' }, dias: { type: 'array', items: { type: 'number' } } } } } } }, examples: [[{ slug: 'pt-rio', nome: 'PT', estado: 'RJ', horarios: [{ horario: '14:20', dias: [0, 1, 2, 3, 4, 5, 6] }] }]] } },
        },
    }, async () => {
        return LOTERICAS;
    });

    // ==================== BICHOS ====================
    app.get('/v1/bichos', {
        schema: {
            tags: ['Bichos'],
            summary: 'Tabela completa dos 25 grupos do Jogo do Bicho',
            response: { 200: { type: 'array', items: { type: 'object', properties: { grupo: { type: 'number' }, nome: { type: 'string' }, dezenas: { type: 'array', items: { type: 'string' } } } }, examples: [[{ grupo: 1, nome: 'Avestruz', dezenas: ['01', '02', '03', '04'] }, { grupo: 2, nome: 'Águia', dezenas: ['05', '06', '07', '08'] }]] } },
        },
    }, async () => {
        return BICHOS;
    });

    // ==================== PALPITES ====================
    app.get('/v1/palpites/dia/:data', {
        schema: {
            tags: ['Palpites'],
            summary: 'Palpites do dia para uma data específica',
            params: { type: 'object', properties: { data: { type: 'string', description: 'YYYY-MM-DD' } } },
        },
    }, async (req, reply) => {
        const { data } = req.params as any;
        const palpites = getPalpitesDia(data);
        if (!palpites) return reply.code(404).send({ error: 'Palpites not found for this date' });
        return palpites;
    });

    app.get('/v1/palpites/html', {
        schema: { tags: ['Palpites'], summary: 'Palpites do dia como HTML', querystring: { type: 'object', properties: { data: { type: 'string' } } } },
    }, async (req, reply) => {
        const data = (req.query as any).data || todayStr();
        const palpites = getPalpitesDia(data);
        if (!palpites) return reply.code(404).send({ error: 'No palpites' });
        const html = renderPalpitesHtml(palpites);
        reply.type('text/html').send(html);
    });

    app.get('/v1/palpites/image', {
        schema: { tags: ['Palpites'], summary: 'Palpites do dia como imagem PNG', querystring: { type: 'object', properties: { data: { type: 'string' } } } },
    }, async (req, reply) => {
        const data = (req.query as any).data || todayStr();
        const palpites = getPalpitesDia(data);
        if (!palpites) return reply.code(404).send({ error: 'No palpites' });
        const png = await renderPalpitesImage(palpites);
        reply.type('image/png').send(png);
    });

    // ==================== PREMIADOS ====================
    app.get('/v1/premiados', {
        schema: {
            tags: ['Premiados'],
            summary: 'Palpites premiados do dia',
            querystring: { type: 'object', properties: { data: { type: 'string', description: 'YYYY-MM-DD (default: hoje)' } } },
        },
    }, async (req) => {
        const { data } = req.query as any;
        return getPremiadosDia(data || todayStr());
    });

    app.get('/v1/premiados/:id', {
        schema: { tags: ['Premiados'], summary: 'Premiado por ID', params: { type: 'object', properties: { id: { type: 'string' } } } },
    }, async (req, reply) => {
        const { id } = req.params as any;
        const premiado = getPremiadoById(id);
        if (!premiado) return reply.code(404).send({ error: 'Premiado not found' });
        return premiado;
    });

    app.get('/v1/premiados/:id/html', {
        schema: { tags: ['Premiados'], summary: 'Premiado como HTML', params: { type: 'object', properties: { id: { type: 'string' } } } },
    }, async (req, reply) => {
        const { id } = req.params as any;
        const premiado = getPremiadoById(id);
        if (!premiado) return reply.code(404).send({ error: 'Premiado not found' });
        const html = renderPremiadoUnitarioHtml(premiado);
        reply.type('text/html').send(html);
    });

    app.get('/v1/premiados/:id/image', {
        schema: { tags: ['Premiados'], summary: 'Premiado como imagem PNG', params: { type: 'object', properties: { id: { type: 'string' } } } },
    }, async (req, reply) => {
        const { id } = req.params as any;
        const premiado = getPremiadoById(id);
        if (!premiado) return reply.code(404).send({ error: 'Premiado not found' });
        const png = await renderPremiadoUnitarioImage(premiado);
        reply.type('image/png').send(png);
    });

    app.get('/v1/premiados/dia/html', {
        schema: { tags: ['Premiados'], summary: 'Premiados do dia como HTML', querystring: { type: 'object', properties: { data: { type: 'string' } } } },
    }, async (req, reply) => {
        const data = (req.query as any).data || todayStr();
        const premiados = getPremiadosDia(data);
        const html = renderPremiadosDiaHtml(premiados, data);
        reply.type('text/html').send(html);
    });

    app.get('/v1/premiados/dia/image', {
        schema: { tags: ['Premiados'], summary: 'Premiados do dia como imagem PNG', querystring: { type: 'object', properties: { data: { type: 'string' } } } },
    }, async (req, reply) => {
        const data = (req.query as any).data || todayStr();
        const premiados = getPremiadosDia(data);
        const png = await renderPremiadosDiaImage(premiados, data);
        reply.type('image/png').send(png);
    });

    // ==================== HORÓSCOPO ====================
    app.get('/v1/horoscopo/:data', {
        schema: {
            tags: ['Horóscopo'],
            summary: 'Horóscopo com números da sorte por data',
            params: { type: 'object', properties: { data: { type: 'string', description: 'YYYY-MM-DD' } } },
        },
    }, async (req, reply) => {
        const { data } = req.params as any;
        const db = getDb();
        const horoscopo = getHoroscopo(db, data);
        if (!horoscopo) return reply.code(404).send({ error: 'Horoscope not found for this date' });
        return horoscopo;
    });

    // ==================== NUMEROLOGIA ====================
    app.get('/v1/numerologia', {
        schema: {
            tags: ['Numerologia'],
            summary: 'Cálculo numerológico pitagórico a partir do nome',
            querystring: { type: 'object', required: ['nome'], properties: { nome: { type: 'string', description: 'Nome completo', examples: ['Maria da Silva'] } } },
            response: {
                200: { type: 'object', properties: { nome: { type: 'string' }, somaTotal: { type: 'number' }, numeroDestino: { type: 'number' }, numerosLucky: { type: 'array', items: { type: 'number' } }, interpretacao: { type: 'string' } }, examples: [{ nome: 'Maria da Silva', somaTotal: 47, numeroDestino: 2, numerosLucky: [46, 78, 11, 43, 25], interpretacao: 'O número 2 representa...' }] },
                400: { type: 'object', properties: { error: { type: 'string' } } }
            },
        },
    }, async (req, reply) => {
        const { nome } = req.query as any;
        if (!nome) return reply.code(400).send({ error: 'Query param "nome" is required' });
        return calcularNumerologia(nome);
    });

    // ==================== COTAÇÃO ====================
    app.get('/v1/cotacao', {
        schema: {
            tags: ['Cotação'],
            summary: 'Valores de pagamento por modalidade de aposta',
            response: {
                200: {
                    type: 'object',
                    properties: {
                        items: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    modalidade: { type: 'string' },
                                    valor: { type: 'string' },
                                    updated_at: { type: 'string' }
                                }
                            }
                        },
                        html: { type: 'string', description: 'URL para visualização em HTML' },
                        image: { type: 'string', description: 'URL para visualização em imagem PNG' }
                    },
                    examples: [{
                        items: [{ modalidade: 'milhar', valor: 'R$ 4.000,00', updated_at: '2026-02-20' }],
                        html: '/v1/cotacao/html',
                        image: '/v1/cotacao/image'
                    }]
                }
            },
        },
    }, async () => {
        const db = getDb();
        const rows = db.exec('SELECT modalidade, valor, updated_at FROM cotacoes ORDER BY modalidade');
        const items = rows.length ? rows[0].values.map((r: any) => ({ modalidade: r[0], valor: r[1], updated_at: r[2] })) : [];
        return {
            items,
            html: '/v1/cotacao/html',
            image: '/v1/cotacao/image'
        };
    });

    app.get('/v1/cotacao/html', {
        schema: { tags: ['Cotação'], summary: 'Cotações renderizadas como HTML' },
    }, async (req, reply) => {
        const db = getDb();
        const rows = db.exec('SELECT modalidade, valor, updated_at FROM cotacoes ORDER BY modalidade');
        const items = rows.length ? rows[0].values.map((r: any) => ({ modalidade: r[0], valor: r[1], updated_at: r[2] })) : [];
        const html = renderCotacoesHtml(items);
        reply.type('text/html').send(html);
    });

    app.get('/v1/cotacao/image', {
        schema: { tags: ['Cotação'], summary: 'Cotações renderizadas como imagem PNG' },
    }, async (req, reply) => {
        const db = getDb();
        const rows = db.exec('SELECT modalidade, valor, updated_at FROM cotacoes ORDER BY modalidade');
        const items = rows.length ? rows[0].values.map((r: any) => ({ modalidade: r[0], valor: r[1], updated_at: r[2] })) : [];
        const png = await renderCotacoesImage(items);
        reply.type('image/png').send(png);
    });

    // ==================== COMO JOGAR ====================
    app.get('/v1/como-jogar', {
        schema: {
            tags: ['Info'],
            summary: 'Regras e explicações sobre o Jogo do Bicho',
            response: { 200: { type: 'object', properties: { titulo: { type: 'string' }, secoes: { type: 'array', items: { type: 'object', properties: { titulo: { type: 'string' }, texto: { type: 'string' } } } } } } },
        },
    }, async () => {
        return {
            titulo: 'Como Jogar no Jogo do Bicho',
            secoes: [
                { titulo: 'O que é o Jogo do Bicho?', texto: 'O Jogo do Bicho é uma das loterias mais populares do Brasil, criada em 1892. Cada número de 00 a 99 é associado a um dos 25 animais (bichos), divididos em grupos de 4 dezenas.' },
                { titulo: 'Grupos e Dezenas', texto: 'São 25 grupos, cada um com 4 dezenas. Por exemplo: Avestruz (Grupo 01) = dezenas 01, 02, 03, 04. Vaca (Grupo 25) = dezenas 97, 98, 99, 00.' },
                { titulo: 'Modalidades de Aposta', texto: 'Milhar (4 dígitos), Centena (3 dígitos), Dezena (2 dígitos) e Grupo (qualquer dezena do animal). Quanto mais específica a aposta, maior o prêmio.' },
                { titulo: 'Horários dos Sorteios', texto: 'Os sorteios ocorrem em diversos horários ao longo do dia, variando por estado e lotérica. Consulte /v1/lotericas para ver os horários disponíveis.' },
            ],
        };
    });
}
