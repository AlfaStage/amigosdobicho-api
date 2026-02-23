import axios from 'axios';
import crypto from 'crypto';
import { getDb, saveDatabase } from '../database/schema.js';
import { log } from '../utils/Logger.js';

const MAX_CONSECUTIVE_FAILURES = 5;

/**
 * Dispatches webhooks for an event, respecting per-lottery filters.
 * Auto-disables webhooks after N consecutive failures.
 */
export async function notifyAll(event: string, payload: any): Promise<void> {
    const db = getDb();
    const lotericaSlug = payload?.loterica || null;

    const webhookRows = db.exec(
        'SELECT id, url, consecutive_failures FROM webhooks WHERE active = 1'
    );
    if (!webhookRows.length || !webhookRows[0].values.length) return;

    const promises = webhookRows[0].values.map(async (row: any) => {
        const [id, url, failures] = row as [string, string, number];

        // Check lottery filter
        if (lotericaSlug) {
            const filterRows = db.exec(
                'SELECT enabled FROM webhook_lotericas WHERE webhook_id = ? AND loterica_slug = ?',
                [id, lotericaSlug]
            );
            if (filterRows.length && filterRows[0].values.length) {
                const enabled = filterRows[0].values[0][0] as number;
                if (!enabled) return; // muted for this lottery
            }
        }

        try {
            const response = await axios.post(url, {
                event,
                ...payload,
                timestamp: new Date().toISOString(),
            }, {
                timeout: 10000,
                headers: { 'X-Webhook-Event': event, 'Content-Type': 'application/json' },
            });

            logDelivery(id, event, 'success', response.status, JSON.stringify(response.data)?.slice(0, 500));
            log.info('WEBHOOK', `Evento ${event} enviado para ${url}`, { status: response.status });

            // Reset failure counter on success
            if (failures > 0) {
                db.run('UPDATE webhooks SET consecutive_failures = 0 WHERE id = ?', [id]);
            }
        } catch (err: any) {
            const statusCode = err.response?.status || null;
            const errorMsg = err.message || 'Unknown error';

            logDelivery(id, event, 'error', statusCode, null, errorMsg);
            log.error('WEBHOOK', `Falha ao enviar ${event} para ${url}`, err, { status: statusCode });

            // Increment failures and auto-disable
            const newFailures = failures + 1;
            if (newFailures >= MAX_CONSECUTIVE_FAILURES) {
                db.run('UPDATE webhooks SET active = 0, consecutive_failures = ? WHERE id = ?', [newFailures, id]);
                log.warn('WEBHOOK', `Auto-desabilitado webhook ${id} após ${newFailures} falhas consecutivas`);
            } else {
                db.run('UPDATE webhooks SET consecutive_failures = ? WHERE id = ?', [newFailures, id]);
            }
        }
    });

    await Promise.allSettled(promises);
    saveDatabase();
}

function logDelivery(webhookId: string, event: string, status: string, statusCode: number | null, responseBody?: string | null, errorMessage?: string): void {
    const db = getDb();
    db.run(
        `INSERT INTO webhook_logs (id, webhook_id, event, status, status_code, response_body, error_message)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [crypto.randomUUID(), webhookId, event, status, statusCode, responseBody || null, errorMessage || null]
    );
}

// ============ CRUD ============

export function getWebhooks(): any[] {
    const db = getDb();
    const rows = db.exec(
        'SELECT id, url, active, consecutive_failures, created_at FROM webhooks ORDER BY created_at DESC'
    );
    if (!rows.length) return [];

    return rows[0].values.map((r: any) => {
        const id = r[0] as string;
        const lotRows = db.exec(
            'SELECT loterica_slug, enabled FROM webhook_lotericas WHERE webhook_id = ?', [id]
        );
        const lotericas = lotRows.length ? lotRows[0].values.map((l: any) => ({
            loterica_slug: l[0], enabled: l[1]
        })) : [];

        return {
            id: r[0], url: r[1], active: r[2], consecutive_failures: r[3],
            created_at: r[4], lotericas
        };
    });
}

export function createWebhook(url: string): string {
    const db = getDb();
    const id = crypto.randomUUID();
    db.run('INSERT INTO webhooks (id, url) VALUES (?, ?)', [id, url]);
    saveDatabase();
    return id;
}

export function deleteWebhook(id: string): void {
    const db = getDb();
    db.run('DELETE FROM webhooks WHERE id = ?', [id]);
    saveDatabase();
}

export function toggleWebhookLoterica(webhookId: string, lotericaSlug: string, enabled: boolean): void {
    const db = getDb();
    db.run(
        `INSERT INTO webhook_lotericas (id, webhook_id, loterica_slug, enabled)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(webhook_id, loterica_slug) DO UPDATE SET enabled = ?`,
        [crypto.randomUUID(), webhookId, lotericaSlug, enabled ? 1 : 0, enabled ? 1 : 0]
    );
    saveDatabase();
}

export function reactivateWebhook(id: string): void {
    const db = getDb();
    db.run('UPDATE webhooks SET active = 1, consecutive_failures = 0 WHERE id = ?', [id]);
    saveDatabase();
}

export function getWebhookLogs(webhookId: string, limit: number = 50): any[] {
    const db = getDb();
    const rows = db.exec(
        'SELECT id, event, status, status_code, response_body, error_message, created_at FROM webhook_logs WHERE webhook_id = ? ORDER BY created_at DESC LIMIT ?',
        [webhookId, limit]
    );
    if (!rows.length) return [];
    return rows[0].values.map((r: any) => ({
        id: r[0], event: r[1], status: r[2], status_code: r[3],
        response_body: r[4], error_message: r[5], created_at: r[6]
    }));
}

/**
 * Sends a test webhook (fake "connectivity test" event).
 */
export async function testWebhook(id: string): Promise<{ success: boolean; statusCode?: number; error?: string }> {
    const db = getDb();
    const rows = db.exec('SELECT url FROM webhooks WHERE id = ?', [id]);
    if (!rows.length || !rows[0].values.length) return { success: false, error: 'Webhook not found' };

    const url = rows[0].values[0][0] as string;
    try {
        const res = await axios.post(url, {
            event: 'test.conectividade',
            message: 'Teste de conectividade do Amigos do Bicho',
            timestamp: new Date().toISOString(),
        }, {
            timeout: 10000,
            headers: { 'X-Webhook-Event': 'test.conectividade' },
        });
        logDelivery(id, 'test.conectividade', 'success', res.status, 'Test OK');
        saveDatabase();
        return { success: true, statusCode: res.status };
    } catch (err: any) {
        const code = err.response?.status;
        logDelivery(id, 'test.conectividade', 'error', code, null, err.message);
        saveDatabase();
        return { success: false, statusCode: code, error: err.message };
    }
}
