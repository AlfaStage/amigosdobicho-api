import axios from 'axios';
import db from '../db.js';
import { randomUUID } from 'crypto';
import { logger } from '../utils/logger.js';
import { LOTERIAS } from '../config/loterias.js';

export interface WebhookLog {
    id: string;
    webhook_id: string;
    event: string;
    payload: string;
    status: 'success' | 'error';
    status_code?: number;
    response_body?: string;
    error_message?: string;
    created_at: string;
}

export interface WebhookLoterica {
    id: string;
    webhook_id: string;
    loterica_slug: string;
    enabled: boolean;
}

export interface WebhookWithConfig {
    id: string;
    url: string;
    created_at: string;
    lotericas: {
        slug: string;
        nome: string;
        enabled: boolean;
    }[];
}

export class WebhookService {
    private serviceName = 'WebhookService';

    // Registrar novo webhook
    async register(url: string): Promise<string> {
        // Validação robusta de URL
        try {
            const urlObj = new URL(url);
            if (!['http:', 'https:'].includes(urlObj.protocol)) {
                throw new Error('Protocolo inválido. Use http:// ou https://');
            }
            // Verificar se não é localhost em produção
            if (process.env.NODE_ENV === 'production' && ['localhost', '127.0.0.1'].includes(urlObj.hostname)) {
                throw new Error('URLs localhost não são permitidas em produção');
            }
        } catch (error: any) {
            logger.error(this.serviceName, `URL inválida: ${error.message}`);
            throw new Error(`URL inválida: ${error.message}`);
        }

        const id = randomUUID();
        const stmt = db.prepare('INSERT INTO webhooks (id, url) VALUES (?, ?)');
        stmt.run(id, url);

        logger.success(this.serviceName, `Webhook registrado: ${url}`);

        // Por padrão, ativar todas as lotéricas para este webhook
        await this.enableAllLotericasForWebhook(id);

        return id;
    }

    // Listar webhooks
    list(): any[] {
        return db.prepare('SELECT * FROM webhooks ORDER BY created_at DESC').all();
    }

    // Listar webhooks com configuração de lotéricas
    listWithConfig(): WebhookWithConfig[] {
        const webhooks = this.list();

        return webhooks.map((webhook: any) => {
            const lotericas = this.getWebhookLotericas(webhook.id);
            return {
                ...webhook,
                lotericas
            };
        });
    }

    // Remover webhook
    delete(id: string): void {
        db.prepare('DELETE FROM webhooks WHERE id = ?').run(id);
        logger.info(this.serviceName, `Webhook removido: ${id}`);
    }

    // Obter webhook por ID
    getById(id: string): any {
        return db.prepare('SELECT * FROM webhooks WHERE id = ?').get(id);
    }

    // Ativar todas as lotéricas para um webhook (padrão)
    private async enableAllLotericasForWebhook(webhookId: string): Promise<void> {
        const insertStmt = db.prepare('INSERT OR IGNORE INTO webhook_lotericas (id, webhook_id, loterica_slug, enabled) VALUES (?, ?, ?, ?)');

        for (const loteria of LOTERIAS) {
            insertStmt.run(randomUUID(), webhookId, loteria.slug, 1);
        }

        logger.info(this.serviceName, `Todas as lotéricas ativadas para webhook: ${webhookId}`);
    }

    // Configurar lotéricas para um webhook
    setWebhookLotericas(webhookId: string, lotericaSlugs: string[]): void {
        // Desativar todas primeiro
        db.prepare('UPDATE webhook_lotericas SET enabled = 0 WHERE webhook_id = ?').run(webhookId);

        // Ativar apenas as selecionadas
        const updateStmt = db.prepare('UPDATE webhook_lotericas SET enabled = 1 WHERE webhook_id = ? AND loterica_slug = ?');

        for (const slug of lotericaSlugs) {
            updateStmt.run(webhookId, slug);
        }

        logger.info(this.serviceName, `Configuração de lotéricas atualizada para webhook: ${webhookId}`);
    }

    // Obter lotéricas configuradas para um webhook
    getWebhookLotericas(webhookId: string): { slug: string; nome: string; enabled: boolean }[] {
        const query = `
            SELECT l.slug, l.nome, COALESCE(wl.enabled, 1) as enabled
            FROM lotericas l
            LEFT JOIN webhook_lotericas wl ON l.slug = wl.loterica_slug AND wl.webhook_id = ?
            ORDER BY l.nome
        `;

        const results = db.prepare(query).all(webhookId) as any[];
        return results.map(r => ({
            ...r,
            enabled: r.enabled === 1 || r.enabled === true
        }));
    }

    // Verificar se uma lotérica está habilitada para um webhook
    isLotericaEnabled(webhookId: string, lotericaSlug: string): boolean {
        const result = db.prepare(
            'SELECT enabled FROM webhook_lotericas WHERE webhook_id = ? AND loterica_slug = ?'
        ).get(webhookId, lotericaSlug) as { enabled: number } | undefined;

        // Se não existir registro, considerar como habilitado (padrão)
        return result ? result.enabled === 1 : true;
    }

    // Registrar log de disparo
    private logWebhookDelivery(
        webhookId: string,
        event: string,
        payload: any,
        status: 'success' | 'error',
        statusCode?: number,
        responseBody?: string,
        errorMessage?: string
    ): void {
        const stmt = db.prepare(`
            INSERT INTO webhook_logs (id, webhook_id, event, payload, status, status_code, response_body, error_message)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);

        stmt.run(
            randomUUID(),
            webhookId,
            event,
            JSON.stringify(payload),
            status,
            statusCode || null,
            responseBody || null,
            errorMessage || null
        );
    }

    // Obter histórico de disparos de um webhook
    getWebhookHistory(webhookId: string, limit: number = 50): WebhookLog[] {
        return db.prepare(`
            SELECT * FROM webhook_logs 
            WHERE webhook_id = ? 
            ORDER BY created_at DESC 
            LIMIT ?
        `).all(webhookId, limit) as WebhookLog[];
    }

    // Obter histórico completo com paginação
    getHistory(limit: number = 100, offset: number = 0): WebhookLog[] {
        return db.prepare(`
            SELECT wl.*, w.url as webhook_url
            FROM webhook_logs wl
            JOIN webhooks w ON wl.webhook_id = w.id
            ORDER BY wl.created_at DESC
            LIMIT ? OFFSET ?
        `).all(limit, offset) as WebhookLog[];
    }

    // Disparar evento para todos os webhooks
    async notifyAll(event: string, payload: any): Promise<void> {
        const webhooks = this.list() as any[];
        logger.info(this.serviceName, `Disparando evento "${event}" para ${webhooks.length} webhooks`);

        const fullPayload = {
            event,
            timestamp: new Date().toISOString(),
            data: payload
        };

        const promises = webhooks.map(async (webhook) => {
            // Verificar se a lotérica está habilitada para este webhook
            const lotericaSlug = payload.loterica;

            if (lotericaSlug && !this.isLotericaEnabled(webhook.id, lotericaSlug)) {
                logger.debug(this.serviceName, `Webhook ${webhook.url} ignorado (lotérica ${lotericaSlug} desativada)`);
                return;
            }

            try {
                const response = await axios.post(webhook.url, fullPayload, {
                    timeout: 10000,
                    headers: {
                        'Content-Type': 'application/json',
                        'User-Agent': 'JogoDoBicho-API/1.0',
                        'X-Webhook-Event': event
                    }
                });

                // Log de sucesso
                this.logWebhookDelivery(
                    webhook.id,
                    event,
                    fullPayload,
                    'success',
                    response.status,
                    JSON.stringify(response.data)
                );

                logger.success(this.serviceName, `Webhook enviado com sucesso: ${webhook.url} (HTTP ${response.status})`);
            } catch (err: any) {
                const errorMessage = err.message || 'Erro desconhecido';
                const statusCode = err.response?.status;

                // Log de erro
                this.logWebhookDelivery(
                    webhook.id,
                    event,
                    fullPayload,
                    'error',
                    statusCode,
                    err.response?.data ? JSON.stringify(err.response.data) : undefined,
                    errorMessage
                );

                logger.error(this.serviceName, `Falha no webhook ${webhook.url}: ${errorMessage}${statusCode ? ` (HTTP ${statusCode})` : ''}`);
            }
        });

        await Promise.allSettled(promises);
        logger.info(this.serviceName, `Disparo de webhooks finalizado para evento "${event}"`);
    }

    // Disparar teste para um webhook específico
    async testWebhook(id: string): Promise<any> {
        const webhook = this.getById(id);
        if (!webhook) throw new Error('Webhook não encontrado');

        const event = 'teste_conexao';
        const fullPayload = {
            event,
            timestamp: new Date().toISOString(),
            data: {
                mensagem: "Isso é um teste de funcionamento do webhook.",
                api_version: "1.0",
                projeto: "Jogo do Bicho API"
            }
        };

        try {
            const response = await axios.post(webhook.url, fullPayload, {
                timeout: 10000,
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'JogoDoBicho-API/1.0',
                    'X-Webhook-Event': event
                }
            });

            this.logWebhookDelivery(
                webhook.id,
                event,
                fullPayload,
                'success',
                response.status,
                JSON.stringify(response.data)
            );

            return {
                status: 'success',
                http_code: response.status,
                response: response.data
            };
        } catch (err: any) {
            const statusCode = err.response?.status;
            const errorMessage = err.message || 'Erro desconhecido';

            this.logWebhookDelivery(
                webhook.id,
                event,
                fullPayload,
                'error',
                statusCode,
                err.response?.data ? JSON.stringify(err.response.data) : undefined,
                errorMessage
            );

            throw {
                status: 'error',
                http_code: statusCode,
                message: errorMessage
            };
        }
    }

    // Limpar logs antigos (manter últimos X dias)
    cleanupOldLogs(daysToKeep: number = 30): void {
        const stmt = db.prepare(`
            DELETE FROM webhook_logs 
            WHERE created_at < datetime('now', '-${daysToKeep} days')
        `);
        const result = stmt.run();
        logger.info(this.serviceName, `Limpeza de logs: ${result.changes} registros removidos`);
    }
}
