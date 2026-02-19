import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs/promises';
import path from 'path';
import { logger } from '../utils/logger.js';

export class ContentScraper {
    private serviceName = 'ContentScraper';

    async execute() {
        logger.info(this.serviceName, 'Raspando conteúdo estático (História/Regras)...');
        try {
            const url = 'https://www.ojogodobicho.com/historia.htm';
            const { data: html } = await axios.get(url, { responseType: 'arraybuffer' });

            const decoder = new TextDecoder('iso-8859-1');
            const textHtml = decoder.decode(html);
            const $ = cheerio.load(textHtml);

            // Extrair conteúdo relevante
            // O site usa headers e parágrafos. Vamos tentar pegar o main content.
            // Estratégia: Pegar todos os <p> após o primeiro h1

            let content = '# Como Jogar / História\n\n';

            $('p').each((i, el) => {
                const text = $(el).text().trim();
                // Filtra menu e footer
                if (text.length > 30 && !text.includes('Copyright')) {
                    content += `${text}\n\n`;
                }
            });

            const outputPath = path.resolve('src/data/historia.md');
            await fs.mkdir(path.dirname(outputPath), { recursive: true });
            await fs.writeFile(outputPath, content, 'utf-8');
            logger.success(this.serviceName, 'Conteúdo salvo em src/data/historia.md');

        } catch (error: any) {
            logger.error(this.serviceName, 'Erro ao raspar conteúdo:', error.message);
        }
    }
}
