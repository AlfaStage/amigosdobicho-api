/**
 * Numerologia Service - Pythagorean Alphabetic Table
 * Converts names into lucky numbers using the ancient reduction method.
 */

const PITAGORICA: Record<string, number> = {
    a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8, i: 9,
    j: 1, k: 2, l: 3, m: 4, n: 5, o: 6, p: 7, q: 8, r: 9,
    s: 1, t: 2, u: 3, v: 4, w: 5, x: 6, y: 7, z: 8,
};

function reduzir(num: number): number {
    while (num > 9) {
        num = String(num).split('').reduce((acc, d) => acc + parseInt(d, 10), 0);
    }
    return num;
}

export interface NumerologiaResult {
    nome: string;
    somaTotal: number;
    numeroDestino: number;
    numerosLucky: number[];
    descricao: string;
}

const DESCRICOES: Record<number, string> = {
    1: 'Liderança e independência. Números fortes para apostas individuais.',
    2: 'Harmonia e parceria. Aposte com amigos para potencializar a sorte.',
    3: 'Criatividade e expressão. Números artísticos trazem boa fortuna.',
    4: 'Estabilidade e ordem. Aposte em sequências lógicas.',
    5: 'Aventura e mudança. Arrisque em números diferentes do habitual.',
    6: 'Amor e família. Números ligados a datas familiares são auspiciosos.',
    7: 'Espiritualidade e mistério. Confie na intuição para escolher.',
    8: 'Poder e abundância. Período forte para apostas maiores.',
    9: 'Sabedoria e conclusão. Encerre ciclos com apostas certeiras.',
};

export function calcularNumerologia(nome: string): NumerologiaResult {
    const limpo = nome
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z]/g, '');

    let somaTotal = 0;
    for (const char of limpo) {
        somaTotal += PITAGORICA[char] || 0;
    }

    const numeroDestino = reduzir(somaTotal);

    // Generate 5 lucky numbers based on the name's numerological signature
    const numerosLucky: number[] = [];
    const seed = somaTotal;
    for (let i = 0; i < 5; i++) {
        const raw = ((seed * (i + 1) * 7 + 13) % 99) + 1;
        numerosLucky.push(raw);
    }

    return {
        nome,
        somaTotal,
        numeroDestino,
        numerosLucky,
        descricao: DESCRICOES[numeroDestino] || '',
    };
}
