export const bichosData = [
    { grupo: 1, nome: 'Avestruz', dezenas: ['01', '02', '03', '04'] },
    { grupo: 2, nome: 'Águia', dezenas: ['05', '06', '07', '08'] },
    { grupo: 3, nome: 'Burro', dezenas: ['09', '10', '11', '12'] },
    { grupo: 4, nome: 'Borboleta', dezenas: ['13', '14', '15', '16'] },
    { grupo: 5, nome: 'Cachorro', dezenas: ['17', '18', '19', '20'] },
    { grupo: 6, nome: 'Cabra', dezenas: ['21', '22', '23', '24'] },
    { grupo: 7, nome: 'Carneiro', dezenas: ['25', '26', '27', '28'] },
    { grupo: 8, nome: 'Camelo', dezenas: ['29', '30', '31', '32'] },
    { grupo: 9, nome: 'Cobra', dezenas: ['33', '34', '35', '36'] },
    { grupo: 10, nome: 'Coelho', dezenas: ['37', '38', '39', '40'] },
    { grupo: 11, nome: 'Cavalo', dezenas: ['41', '42', '43', '44'] },
    { grupo: 12, nome: 'Elefante', dezenas: ['45', '46', '47', '48'] },
    { grupo: 13, nome: 'Galo', dezenas: ['49', '50', '51', '52'] },
    { grupo: 14, nome: 'Gato', dezenas: ['53', '54', '55', '56'] },
    { grupo: 15, nome: 'Jacaré', dezenas: ['57', '58', '59', '60'] },
    { grupo: 16, nome: 'Leão', dezenas: ['61', '62', '63', '64'] },
    { grupo: 17, nome: 'Macaco', dezenas: ['65', '66', '67', '68'] },
    { grupo: 18, nome: 'Porco', dezenas: ['69', '70', '71', '72'] },
    { grupo: 19, nome: 'Pavão', dezenas: ['73', '74', '75', '76'] },
    { grupo: 20, nome: 'Peru', dezenas: ['77', '78', '79', '80'] },
    { grupo: 21, nome: 'Touro', dezenas: ['81', '82', '83', '84'] },
    { grupo: 22, nome: 'Tigre', dezenas: ['85', '86', '87', '88'] },
    { grupo: 23, nome: 'Urso', dezenas: ['89', '90', '91', '92'] },
    { grupo: 24, nome: 'Veado', dezenas: ['93', '94', '95', '96'] },
    { grupo: 25, nome: 'Vaca', dezenas: ['97', '98', '99', '00'] }
];

export function getBichoByGrupo(grupo: number) {
    return bichosData.find(b => b.grupo === grupo);
}

export function getBichoByDezena(dezena: string) {
    return bichosData.find(b => b.dezenas.includes(dezena));
}

export function getBichoByNome(nome: string) {
    const nomeNorm = nome.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return bichosData.find(b => {
        const bichoNorm = b.nome.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        return bichoNorm === nomeNorm || bichoNorm.includes(nomeNorm);
    });
}
