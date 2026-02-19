export class NumerologyService {
    private table: Record<string, number> = {
        'a': 1, 'j': 1, 's': 1,
        'b': 2, 'k': 2, 't': 2,
        'c': 3, 'l': 3, 'u': 3,
        'd': 4, 'm': 4, 'v': 4,
        'e': 5, 'n': 5, 'w': 5,
        'f': 6, 'o': 6, 'x': 6,
        'g': 7, 'p': 7, 'y': 7,
        'h': 8, 'q': 8, 'z': 8,
        'i': 9, 'r': 9
    };

    calculate(name: string): any {
        const cleanName = name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z]/g, '');
        let sum = 0;
        const details = [];

        for (const char of cleanName) {
            const val = this.table[char] || 0;
            sum += val;
            details.push(`${char}=${val}`);
        }

        const luckyNumber = this.reduceToSingleDigit(sum);
        const suggestions = this.generateSuggestions(luckyNumber, sum);

        return {
            input: name,
            cleanInput: cleanName,
            sum,
            luckyNumber,
            details: details.join(', '),
            meaning: this.getMeaning(luckyNumber),
            sugestoes: suggestions
        };
    }

    private reduceToSingleDigit(num: number): number {
        while (num > 9) {
            num = num.toString().split('').reduce((acc, curr) => acc + parseInt(curr), 0);
        }
        return num;
    }

    private getMeaning(num: number): string {
        const meanings: Record<number, string> = {
            1: "Liderança, independência, originalidade.",
            2: "Cooperação, diplomacia, paciência.",
            3: "Comunicação, criatividade, otimismo.",
            4: "Organização, trabalho duro, estabilidade.",
            5: "Liberdade, aventura, mudanças.",
            6: "Responsabilidade, amor, harmonia.",
            7: "Análise, introspecção, sabedoria.",
            8: "Poder, sucesso material, eficiência.",
            9: "Humanitarismo, compaixão, generosidade."
        };
        return meanings[num] || "Número mestre ou indefinido.";
    }

    private generateSuggestions(luckyNumber: number, sum: number): {
        dezenas: string[];
        centenas: string[];
        milhares: string[];
        grupo: { numero: number; bicho: string };
    } {
        // Gerar dezenas baseadas no número da sorte (4 dezenas do grupo)
        const baseGrupo = Math.ceil(luckyNumber / 4) || 1;
        const grupoFinal = ((luckyNumber - 1) % 25) + 1;

        // Os bichos do jogo
        const bichos = ['Avestruz', 'Águia', 'Burro', 'Borboleta', 'Cachorro', 'Cabra', 'Carneiro', 'Camelo', 'Cobra', 'Coelho', 'Cavalo', 'Elefante', 'Galo', 'Gato', 'Jacaré', 'Leão', 'Macaco', 'Porco', 'Pavão', 'Peru', 'Touro', 'Tigre', 'Urso', 'Veado', 'Vaca'];

        // Dezenas do grupo baseado no número da sorte
        const grupoBase = luckyNumber <= 25 ? luckyNumber : ((luckyNumber - 1) % 25) + 1;
        const startDezena = (grupoBase - 1) * 4 + 1;
        const dezenas = [
            String(startDezena % 100).padStart(2, '0'),
            String((startDezena + 1) % 100).padStart(2, '0'),
            String((startDezena + 2) % 100).padStart(2, '0'),
            String((startDezena + 3) % 100).padStart(2, '0')
        ];

        // Centenas baseadas na soma + variações
        const centenas = [
            String(sum % 1000).padStart(3, '0'),
            String((sum + luckyNumber) % 1000).padStart(3, '0'),
            String((luckyNumber * 100 + sum % 100) % 1000).padStart(3, '0')
        ];

        // Milhares baseados na combinação
        const milhares = [
            String(sum).padStart(4, '0').slice(-4),
            String(luckyNumber * 1000 + sum % 1000).padStart(4, '0').slice(-4),
            String(((sum % 100) * 100) + luckyNumber).padStart(4, '0')
        ];

        return {
            dezenas,
            centenas,
            milhares,
            grupo: {
                numero: grupoBase,
                bicho: bichos[grupoBase - 1] || 'Avestruz'
            }
        };
    }
}
