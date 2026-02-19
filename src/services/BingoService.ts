import db from '../db.js';
import { logger } from '../utils/logger.js';
import { WebhookService } from './WebhookService.js';
import { randomUUID } from 'crypto';
import { ImageService } from './ImageService.js';

export class BingoService {
    private webhookService = new WebhookService();
    private imageService = new ImageService();
    private serviceName = 'BingoService';

    constructor() { }

    /**
     * Verifica se houve Bingo (acertos) para um resultado recém-chegado
     */
    async checkBingo(resultadoId: string, data: string, lotericaSlug: string, premios: any[]): Promise<void> {
        // 1. Buscar Palpites do Dia
        const palpiteDia = db.prepare('SELECT id FROM palpites_dia WHERE data = ?').get(data) as { id: string } | undefined;

        if (!palpiteDia) {
            logger.info(this.serviceName, `Nenhum palpite encontrado para ${data}. Pulando verificação de Bingo.`);
            return;
        }

        const palpiteId = palpiteDia.id;

        // 2. Carregar Palpites (Grupos, Milhares, Centenas)
        const gruposApostados = db.prepare('SELECT grupo, bicho FROM palpites_grupos WHERE palpite_id = ?').all(palpiteId) as { grupo: number, bicho: string }[];
        const milharesApostadas = db.prepare('SELECT numero FROM palpites_milhares WHERE palpite_id = ?').all(palpiteId) as { numero: string }[];
        const centenasApostadas = db.prepare('SELECT numero FROM palpites_centenas WHERE palpite_id = ?').all(palpiteId) as { numero: string }[];

        // 3. Verificar Acertos
        const acertos: any[] = [];

        for (const premio of premios) {
            // Verificar Grupo/Bicho
            const grupoMatch = gruposApostados.find(g => g.grupo === premio.grupo);
            if (grupoMatch) {
                acertos.push({
                    tipo: 'Grupo',
                    valor: `${premio.grupo} (${grupoMatch.bicho})`,
                    posicao: premio.posicao,
                    premio: premio.premio // Se tiver info de valor
                });
            }

            // Verificar Milhar
            if (milharesApostadas.some(m => m.numero === premio.milhar)) {
                acertos.push({
                    tipo: 'Milhar',
                    valor: premio.milhar,
                    posicao: premio.posicao
                });
            }

            // Verificar Centena
            const centenaPremio = premio.milhar.slice(-3);
            if (centenasApostadas.some(c => c.numero === centenaPremio)) {
                acertos.push({
                    tipo: 'Centena',
                    valor: centenaPremio,
                    posicao: premio.posicao
                });
            }
        }

        if (acertos.length > 0) {
            logger.success(this.serviceName, `BINGO DETECTADO! ${acertos.length} acertos na loteria ${lotericaSlug}`);

            // 4. Salvar Bingo no Banco (Opcional, se quisermos histórico detalhado de acertos)
            // Por enquanto vamos focar no disparo e geração de imagem

            // 5. Gerar Imagem do Bingo
            const imageUrl = await this.imageService.generateBingoImage(lotericaSlug, data, acertos);
            const htmlUrl = await this.imageService.generateBingoHtml(lotericaSlug, data, acertos);

            // 6. Disparar Webhook
            await this.webhookService.notifyAll('bingo_detected', {
                loterica: lotericaSlug,
                data,
                acertos,
                image_url: imageUrl,
                html_url: htmlUrl
            });
        }
    }
}
