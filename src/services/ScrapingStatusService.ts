import db from '../db.js';
import { logger } from '../utils/logger.js';
import { LOTERIAS } from '../config/loterias.js';

export interface ScrapingStatus {
    id?: number;
    loteria_slug: string;
    loteria_nome: string;
    horario: string;
    data: string;
    status: 'pending' | 'success' | 'error' | 'retrying';
    tentativas: number;
    ultimo_erro?: string;
    fonte_usada?: string;
    proxima_tentativa?: string;
    resultado_id?: number;
    created_at: string;
    updated_at: string;
}

export class ScrapingStatusService {
    private serviceName = 'ScrapingStatusService';

    constructor() {
        this.initTable();
    }

    private initTable() {
        db.exec(`
            CREATE TABLE IF NOT EXISTS scraping_status (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                loteria_slug TEXT NOT NULL,
                loteria_nome TEXT NOT NULL,
                horario TEXT NOT NULL,
                data TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                tentativas INTEGER DEFAULT 0,
                ultimo_erro TEXT,
                fonte_usada TEXT,
                proxima_tentativa TEXT,
                resultado_id INTEGER,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(loteria_slug, horario, data)
            )
        `);

        // Tabela de histórico de execuções de scraping
        db.exec(`
            CREATE TABLE IF NOT EXISTS scraping_runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tipo TEXT NOT NULL,
                urls_processadas INTEGER DEFAULT 0,
                resultados_encontrados INTEGER DEFAULT 0,
                erros INTEGER DEFAULT 0,
                duracao_ms INTEGER DEFAULT 0,
                detalhes TEXT,
                created_at TEXT NOT NULL
            )
        `);

        // Indexes para consultas rápidas
        db.exec(`CREATE INDEX IF NOT EXISTS idx_scraping_status_data ON scraping_status(data)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_scraping_status_slug ON scraping_status(loteria_slug)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_scraping_runs_created ON scraping_runs(created_at)`);

        logger.info(this.serviceName, 'Tabelas de status inicializadas');
    }

    // Registrar início de uma execução de scraping
    registerScrapingRun(tipo: string, urlsProcessadas: number, resultadosEncontrados: number, erros: number, duracaoMs: number, detalhes?: string): number {
        const now = new Date().toISOString();

        const result = db.prepare(`
            INSERT INTO scraping_runs (tipo, urls_processadas, resultados_encontrados, erros, duracao_ms, detalhes, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(tipo, urlsProcessadas, resultadosEncontrados, erros, duracaoMs, detalhes || null, now);

        return result.lastInsertRowid as number;
    }

    // Buscar histórico de execuções de hoje
    getHistoricoHoje(): {
        id: number;
        tipo: string;
        urls_processadas: number;
        resultados_encontrados: number;
        erros: number;
        duracao_ms: number;
        detalhes: string | null;
        created_at: string;
    }[] {
        const today = this.getTodayString();

        return db.prepare(`
            SELECT * FROM scraping_runs 
            WHERE DATE(created_at) = ?
            ORDER BY created_at DESC
            LIMIT 50
        `).all(today) as any[];
    }


    // Registrar que vamos tentar buscar um horário
    registerPending(loteriaSlug: string, loteriaNome: string, horario: string, data: string): void {
        const now = new Date().toISOString();

        db.prepare(`
            INSERT INTO scraping_status (loteria_slug, loteria_nome, horario, data, status, tentativas, created_at, updated_at)
            VALUES (?, ?, ?, ?, 'pending', 0, ?, ?)
            ON CONFLICT(loteria_slug, horario, data) DO UPDATE SET
                status = CASE WHEN status = 'success' THEN 'success' ELSE 'pending' END,
                updated_at = ?
        `).run(loteriaSlug, loteriaNome, horario, data, now, now, now);
    }

    // Registrar tentativa de scraping
    registerAttempt(loteriaSlug: string, horario: string, data: string): void {
        const now = new Date().toISOString();

        db.prepare(`
            UPDATE scraping_status 
            SET tentativas = tentativas + 1, 
                status = 'retrying',
                updated_at = ?
            WHERE loteria_slug = ? AND horario = ? AND data = ?
        `).run(now, loteriaSlug, horario, data);
    }

    // Registrar sucesso
    registerSuccess(loteriaSlug: string, horario: string, data: string, fonte: string, resultadoId?: string | number): void {
        const now = new Date().toISOString();

        db.prepare(`
            UPDATE scraping_status 
            SET status = 'success',
                fonte_usada = ?,
                resultado_id = ?,
                ultimo_erro = NULL,
                proxima_tentativa = NULL,
                updated_at = ?
            WHERE loteria_slug = ? AND horario = ? AND data = ?
        `).run(fonte, resultadoId || null, now, loteriaSlug, horario, data);

        logger.success(this.serviceName, `✅ ${loteriaSlug} ${horario} - Sucesso via ${fonte}`);
    }

    // Registrar erro
    registerError(loteriaSlug: string, horario: string, data: string, erro: string, proximaTentativa?: Date): void {
        const now = new Date().toISOString();
        const proxTentStr = proximaTentativa ? proximaTentativa.toISOString() : null;

        db.prepare(`
            UPDATE scraping_status 
            SET status = 'error',
                ultimo_erro = ?,
                proxima_tentativa = ?,
                updated_at = ?
            WHERE loteria_slug = ? AND horario = ? AND data = ?
        `).run(erro, proxTentStr, now, loteriaSlug, horario, data);

        logger.warn(this.serviceName, `❌ ${loteriaSlug} ${horario} - Erro: ${erro.slice(0, 100)}`);
    }

    // Buscar status de hoje (para a página de status)
    getStatusHoje(): ScrapingStatus[] {
        const today = this.getTodayString();

        return db.prepare(`
            SELECT * FROM scraping_status 
            WHERE data = ?
            ORDER BY horario ASC, loteria_nome ASC
        `).all(today) as ScrapingStatus[];
    }

    // Buscar status por data
    getStatusByDate(data: string): ScrapingStatus[] {
        return db.prepare(`
            SELECT * FROM scraping_status 
            WHERE data = ?
            ORDER BY horario ASC, loteria_nome ASC
        `).all(data) as ScrapingStatus[];
    }

    // Resumo de status agrupado por lotérica
    getResumoHoje(): {
        loteria_slug: string;
        loteria_nome: string;
        total_horarios: number;
        sucesso: number;
        erro: number;
        pendente: number;
        horarios: ScrapingStatus[];
    }[] {
        const statusList = this.getStatusHoje();
        const resumo = new Map<string, {
            loteria_slug: string;
            loteria_nome: string;
            total_horarios: number;
            sucesso: number;
            erro: number;
            pendente: number;
            horarios: ScrapingStatus[];
        }>();

        for (const s of statusList) {
            if (!resumo.has(s.loteria_slug)) {
                resumo.set(s.loteria_slug, {
                    loteria_slug: s.loteria_slug,
                    loteria_nome: s.loteria_nome,
                    total_horarios: 0,
                    sucesso: 0,
                    erro: 0,
                    pendente: 0,
                    horarios: []
                });
            }

            const r = resumo.get(s.loteria_slug)!;
            r.total_horarios++;
            r.horarios.push(s);

            if (s.status === 'success') r.sucesso++;
            else if (s.status === 'error') r.erro++;
            else r.pendente++;
        }

        return Array.from(resumo.values()).sort((a, b) => a.loteria_nome.localeCompare(b.loteria_nome));
    }

    // Estatísticas gerais (antigo - mantido para compatibilidade)
    getEstatisticasHoje(): {
        total_horarios: number;
        sucesso: number;
        erro: number;
        pendente: number;
        taxa_sucesso: number;
    } {
        const kpis = this.getKPIsHoje();
        return {
            total_horarios: kpis.processados,
            sucesso: kpis.sucesso,
            erro: kpis.erro,
            pendente: kpis.pendente,
            taxa_sucesso: kpis.taxa_sucesso
        };
    }

    // KPIs completos do dia
    getKPIsHoje(): {
        total_dia: number;       // Total de horários configurados para hoje
        processados: number;     // Já tentamos buscar (sucesso + erro + pendente)
        sucesso: number;         // Funcionaram
        erro: number;            // Falharam
        pendente: number;        // Em processamento
        faltando: number;        // Horários futuros (ainda não chegaram)
        taxa_sucesso: number;    // % de sucesso sobre os processados
    } {
        const today = this.getTodayString();
        const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
        const horaAtualMinutos = now.getHours() * 60 + now.getMinutes();

        // Calcular total de horários configurados para hoje
        let totalDia = 0;
        let horariosFuturos = 0;

        for (const loteria of LOTERIAS) {
            if (!loteria.horarios) continue;

            for (const horario of loteria.horarios) {
                totalDia++;
                const [h, m] = horario.split(':').map(Number);
                const minutosHorario = h * 60 + m;

                // Se o horário ainda não chegou (+1 min de delay)
                if (horaAtualMinutos < minutosHorario + 1) {
                    horariosFuturos++;
                }
            }
        }

        // Buscar status dos já processados
        const stats = db.prepare(`
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as sucesso,
                SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as erro,
                SUM(CASE WHEN status IN ('pending', 'retrying') THEN 1 ELSE 0 END) as pendente
            FROM scraping_status 
            WHERE data = ?
        `).get(today) as { total: number; sucesso: number; erro: number; pendente: number };

        const processados = stats.total || 0;
        const sucesso = stats.sucesso || 0;
        const erro = stats.erro || 0;
        const pendente = stats.pendente || 0;

        return {
            total_dia: totalDia,
            processados,
            sucesso,
            erro,
            pendente,
            faltando: horariosFuturos,
            taxa_sucesso: processados > 0 ? Math.round((sucesso / processados) * 100) : 0
        };
    }

    // Limpar registros antigos (mais de 7 dias)
    cleanOldRecords(): number {
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        const dateStr = sevenDaysAgo.toISOString().split('T')[0];

        const result = db.prepare('DELETE FROM scraping_status WHERE data < ?').run(dateStr);

        // Limpar também histórico de runs
        db.prepare('DELETE FROM scraping_runs WHERE DATE(created_at) < ?').run(dateStr);

        return result.changes;
    }

    // Tabela completa de todas as lotéricas com todos os horários
    getTabelaLotericas(): {
        loteria_slug: string;
        loteria_nome: string;
        horarios: {
            horario: string;
            status: 'sucesso' | 'atraso' | 'erro' | 'pendente' | 'futuro';
            tentativas: number;
            erro?: string;
            fonte?: string;
        }[];
    }[] {
        const today = this.getTodayString();
        const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
        const horaAtualMinutos = now.getHours() * 60 + now.getMinutes();

        // Buscar todos os status de hoje
        const statusMap = new Map<string, ScrapingStatus>();
        const statusList = this.getStatusHoje();
        for (const s of statusList) {
            statusMap.set(`${s.loteria_slug}:${s.horario}`, s);
        }

        const resultado: {
            loteria_slug: string;
            loteria_nome: string;
            horarios: {
                horario: string;
                status: 'sucesso' | 'atraso' | 'erro' | 'pendente' | 'futuro';
                tentativas: number;
                erro?: string;
                fonte?: string;
            }[];
        }[] = [];

        for (const loteria of LOTERIAS) {
            if (!loteria.horarios || loteria.horarios.length === 0) continue;

            const horariosInfo: {
                horario: string;
                status: 'sucesso' | 'atraso' | 'erro' | 'pendente' | 'futuro';
                tentativas: number;
                erro?: string;
                fonte?: string;
            }[] = [];

            for (const horario of loteria.horarios) {
                const [h, m] = horario.split(':').map(Number);
                const minutosHorario = h * 60 + m;
                const ehFuturo = horaAtualMinutos < minutosHorario + 1;

                const statusKey = `${loteria.slug}:${horario}`;
                const statusData = statusMap.get(statusKey);

                let status: 'sucesso' | 'atraso' | 'erro' | 'pendente' | 'futuro';
                let tentativas = 0;
                let erro: string | undefined;
                let fonte: string | undefined;

                if (ehFuturo) {
                    status = 'futuro';
                } else if (!statusData) {
                    status = 'pendente';
                } else if (statusData.status === 'success') {
                    // Verificar se foi com atraso (mais de 2 tentativas)
                    status = statusData.tentativas > 2 ? 'atraso' : 'sucesso';
                    tentativas = statusData.tentativas;
                    fonte = statusData.fonte_usada || undefined;
                } else if (statusData.status === 'error') {
                    status = 'erro';
                    tentativas = statusData.tentativas;
                    erro = statusData.ultimo_erro || undefined;
                } else {
                    status = 'pendente';
                    tentativas = statusData.tentativas;
                }

                horariosInfo.push({
                    horario,
                    status,
                    tentativas,
                    erro,
                    fonte
                });
            }

            resultado.push({
                loteria_slug: loteria.slug,
                loteria_nome: loteria.nome,
                horarios: horariosInfo.sort((a, b) => a.horario.localeCompare(b.horario))
            });
        }

        // Adicionar Palpites e Bingos manualmente à tabela
        const palpitesStatus = statusMap.get('palpites:07:00');
        const bingosStatus = statusMap.get('bingos:23:30');

        if (palpitesStatus || bingosStatus) {
            const extras: {
                horario: string;
                status: 'sucesso' | 'atraso' | 'erro' | 'pendente' | 'futuro';
                tentativas: number;
                erro?: string;
                fonte?: string;
                nome: string;
            }[] = [];

            if (palpitesStatus) {
                extras.push({
                    horario: '07:00',
                    nome: 'Palpites do Dia',
                    status: palpitesStatus.status === 'success' ? 'sucesso' : (palpitesStatus.status === 'error' ? 'erro' : 'pendente'),
                    tentativas: palpitesStatus.tentativas,
                    erro: palpitesStatus.ultimo_erro,
                    fonte: palpitesStatus.fonte_usada
                });
            }

            if (bingosStatus) {
                extras.push({
                    horario: '23:30',
                    nome: 'Bingos do Dia',
                    status: bingosStatus.status === 'success' ? 'sucesso' : (bingosStatus.status === 'error' ? 'erro' : 'pendente'),
                    tentativas: bingosStatus.tentativas,
                    erro: bingosStatus.ultimo_erro,
                    fonte: bingosStatus.fonte_usada
                });
            }

            // Adicionar como uma "Loteria" especial no início ou fim
            resultado.unshift({
                loteria_slug: 'palpites_bingos',
                loteria_nome: '🦁 Palpites & Bingos',
                horarios: extras
            });
        }

        return resultado.sort((a, b) => {
            // Manter Palpites no topo
            if (a.loteria_slug === 'palpites_bingos') return -1;
            if (b.loteria_slug === 'palpites_bingos') return 1;
            return a.loteria_nome.localeCompare(b.loteria_nome);
        });
    }

    private getTodayString(): string {
        const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }
}

// Singleton
export const scrapingStatusService = new ScrapingStatusService();
