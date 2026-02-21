import { getAllLotericas } from '../services/LotericasService.js';

/**
 * Maps chaotic lottery names from external APIs to our canonical slugs.
 * Uses aggressive pattern matching as described in the grimório.
 */
export function mapLotteryToSlug(nome: string, estado?: string): string {
    const n = nome.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    const e = (estado || '').toUpperCase();

    // 1. Direct slug match with DB
    const lotericas = getAllLotericas();
    for (const lot of lotericas) {
        if (n === lot.slug || n === lot.nome.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()) return lot.slug;
    }

    // 2. Historical Heuristics
    if (n.includes('ptm') && (e === 'RJ' || n.includes('rio'))) return 'ptm-rio';
    if (n.includes('ptn') && (e === 'RJ' || n.includes('rio'))) return 'ptn-rio';
    if (n.includes('pt') && (e === 'RJ' || n.includes('rio'))) return 'pt-rio';
    if (n.includes('look') && (e === 'GO' || n.includes('goias') || n.includes('go'))) return 'look-goias';
    if (n.includes('bgt') && (e === 'GO' || n.includes('goias'))) return 'bgt-goias';
    if (n.includes('alvorada') && (e === 'MG' || n.includes('mg'))) return 'alvorada-mg';
    if (n.includes('minas') && n.includes('dia')) return 'minas-dia';
    if (n.includes('minas') && n.includes('noite')) return 'minas-noite';
    if (n.includes('lotep') || n.includes('campina')) return 'lotep-pb';
    if ((n.includes('bahia') || n.includes('ba - ba') || n === 'ba') && !n.includes('maluca')) return 'ba-ba';
    if (n.includes('maluca')) return 'maluca-bahia';
    if (n.includes('lbr') && (e === 'DF' || n.includes('df'))) return 'lbr-df';
    if (n.includes('bandeirante') && (e === 'SP' || n.includes('sp') || n.includes('paulo'))) return 'bandeirantes-sp';
    if (n.includes('nacional') || n.includes('loteria nacional')) return 'nacional';
    if (n.includes('federal')) return 'federal';

    // State-based fallback
    if (e === 'RJ' && n.includes('pt')) return 'pt-rio';
    if (e === 'SP') return 'bandeirantes-sp';
    if (e === 'GO') return 'look-goias';

    // 3. Fallback to Dynamic Slug Generator (Auto-Learning Mode)
    return generateDynamicSlug(nome, estado || 'br');
}

/**
 * Creates an intelligent slug for a new unknown lottery.
 * Ex: "Nova Loteria da Sorte" (CE) -> "da-sorte-ce"
 */
export function generateDynamicSlug(nome: string, estado: string): string {
    let limpo = nome.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s]/g, '').trim();

    // Remove stop-words/palavras genéricas que não ajudam na identificação
    limpo = limpo.replace(/\b(nova|novo|loteria|da|de|do|dos|das)\b/gi, '').replace(/\s+/g, ' ').trim().replace(/\s+/g, '-');

    const uf = estado.toLowerCase().trim();
    if (limpo.endsWith(`-${uf}`)) return limpo;
    return `${limpo}-${uf}`;
}

/**
 * Formats current date as YYYY-MM-DD
 */
export function todayStr(): string {
    const d = new Date();
    return d.toISOString().split('T')[0];
}

/**
 * Formats a date to DD/MM/YYYY for display
 */
export function formatDateBR(dateStr: string): string {
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}/${y}`;
}

/**
 * Sanitizes string: removes accents and normalizes
 */
export function sanitize(str: string): string {
    return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}
