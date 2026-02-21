export interface Loterica {
    slug: string;
    nome: string;
    estado: string;
    horarios: {
        horario: string;
        dias: number[];
    }[];
}

const TODOS_OS_DIAS = [0, 1, 2, 3, 4, 5, 6];
const SEG_A_SAB = [1, 2, 3, 4, 5, 6];
const PTN_DIAS = [1, 2, 4, 5]; // Segunda, Terça, Quinta, Sexta
const QUA_SAB = [3, 6]; // Quarta e Sábado

export const LOTERICAS: Loterica[] = [
    {
        slug: 'lbr-df', nome: 'LBR', estado: 'DF', horarios: [
            { horario: '10:00:00', dias: TODOS_OS_DIAS },
            { horario: '12:40:00', dias: TODOS_OS_DIAS },
            { horario: '15:00:00', dias: TODOS_OS_DIAS },
            { horario: '17:00:00', dias: TODOS_OS_DIAS },
            { horario: '19:00:00', dias: [0, 1, 2, 4, 5] },
        ]
    },
    {
        slug: 'alvorada-mg', nome: 'Alvorada', estado: 'MG', horarios: [
            { horario: '12:00:00', dias: SEG_A_SAB },
        ]
    },
    {
        slug: 'minas-dia', nome: 'Minas Dia', estado: 'MG', horarios: [
            { horario: '15:00:00', dias: SEG_A_SAB },
        ]
    },
    {
        slug: 'minas-noite', nome: 'Minas Noite', estado: 'MG', horarios: [
            { horario: '19:00:00', dias: PTN_DIAS },
        ]
    },
    {
        slug: 'lotep-pb', nome: 'Lotep', estado: 'PB', horarios: [
            { horario: '10:45:00', dias: TODOS_OS_DIAS },
            { horario: '12:45:00', dias: TODOS_OS_DIAS },
            { horario: '15:45:00', dias: TODOS_OS_DIAS },
            { horario: '18:00:00', dias: SEG_A_SAB },
        ]
    },
    {
        slug: 'ptm-rio', nome: 'PTM', estado: 'RJ', horarios: [
            { horario: '11:20:00', dias: TODOS_OS_DIAS },
        ]
    },
    {
        slug: 'pt-rio', nome: 'PT', estado: 'RJ', horarios: [
            { horario: '14:20:00', dias: TODOS_OS_DIAS },
            { horario: '16:00:00', dias: QUA_SAB },
        ]
    },
    {
        slug: 'ptn-rio', nome: 'PTN', estado: 'RJ', horarios: [
            { horario: '18:20:00', dias: PTN_DIAS },
        ]
    },
    {
        slug: 'bandeirantes-sp', nome: 'Bandeirantes', estado: 'SP', horarios: [
            { horario: '15:30:00', dias: TODOS_OS_DIAS },
        ]
    },
    {
        slug: 'look-goias', nome: 'Look', estado: 'GO', horarios: [
            { horario: '07:20:00', dias: TODOS_OS_DIAS },
            { horario: '11:20:00', dias: TODOS_OS_DIAS },
            { horario: '14:20:00', dias: TODOS_OS_DIAS },
            { horario: '16:20:00', dias: TODOS_OS_DIAS },
            { horario: '18:20:00', dias: TODOS_OS_DIAS },
        ]
    },
    {
        slug: 'nacional', nome: 'Nacional', estado: 'NA', horarios: [
            { horario: '02:00:00', dias: TODOS_OS_DIAS },
            { horario: '08:00:00', dias: TODOS_OS_DIAS },
            { horario: '10:00:00', dias: TODOS_OS_DIAS },
            { horario: '12:00:00', dias: TODOS_OS_DIAS },
            { horario: '15:00:00', dias: TODOS_OS_DIAS },
            { horario: '17:00:00', dias: TODOS_OS_DIAS },
            { horario: '19:00:00', dias: TODOS_OS_DIAS },
            { horario: '22:00:00', dias: TODOS_OS_DIAS },
        ]
    },
    {
        slug: 'federal', nome: 'Federal', estado: 'NA', horarios: [
            { horario: '19:00:00', dias: QUA_SAB },
        ]
    },
    {
        slug: 'ba-ba', nome: 'BA', estado: 'BA', horarios: [
            { horario: '10:20:00', dias: TODOS_OS_DIAS },
            { horario: '12:20:00', dias: TODOS_OS_DIAS },
            { horario: '15:20:00', dias: TODOS_OS_DIAS },
            { horario: '19:20:00', dias: PTN_DIAS },
        ]
    },
];

export const ESTADOS_API: string[] = ['DF', 'BA', 'GO', 'MG', 'PB', 'RJ', 'SP', 'NA'];
