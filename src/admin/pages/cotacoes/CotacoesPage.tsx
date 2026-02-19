import { useQuery, useMutation } from '@tanstack/react-query'
import axios from 'axios'
import { AdminLayout } from '../../components/AdminLayout'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/card'
import { Button } from '../../components/ui/button'
import { RefreshCcw, TrendingUp } from 'lucide-react'
import { cn } from '@/lib/utils'

const fetchCotacoes = async () => {
    const key = localStorage.getItem('admin_api_key')
    const { data } = await axios.get(`/v1/cotacao?key=${key}`)
    return data && data.data ? data.data : []
}

export default function CotacoesPage() {
    const { data: cotacoes, isLoading, refetch } = useQuery({
        queryKey: ['cotacoes'],
        queryFn: fetchCotacoes
    })

    const syncMutation = useMutation({
        mutationFn: async () => {
            const key = localStorage.getItem('admin_api_key')
            return axios.post(`/v1/cotacao/sync?key=${key}`)
        },
        onSuccess: () => {
            refetch()
            alert('Cotações sincronizadas com sucesso!')
        },
        onError: () => {
            alert('Erro ao sincronizar cotações')
        }
    })

    return (
        <AdminLayout
            title="Cotações"
            description="Tabela de Premiação Brutalista (Scraping Ativo)"
        >
            <div className="flex gap-4 mb-10">
                <Button
                    variant="secondary"
                    onClick={() => syncMutation.mutate()}
                    disabled={syncMutation.isPending || isLoading}
                >
                    <RefreshCcw className={cn("mr-2 h-4 w-4", syncMutation.isPending && "animate-spin")} />
                    {syncMutation.isPending ? 'Sincronizando...' : 'Sincronizar Agora'}
                </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {isLoading ? (
                    Array.from({ length: 9 }).map((_, i) => (
                        <Card key={i} className="animate-pulse bg-zinc-200 h-32 border-dashed" />
                    ))
                ) : cotacoes?.map((cot: any) => (
                    <Card key={cot.modalidade} className="group hover:border-[#00E676] transition-all">
                        <CardHeader className="pb-2">
                            <div className="flex justify-between items-start">
                                <CardTitle className="text-xl">{cot.modalidade}</CardTitle>
                                <TrendingUp className="text-muted-foreground group-hover:text-[#00E676]" size={20} />
                            </div>
                        </CardHeader>
                        <CardContent>
                            <div className="bg-black text-[#00E676] text-3xl font-black p-4 text-center border-4 border-black">
                                {cot.valor}
                            </div>
                            <p className="text-[10px] font-bold text-muted-foreground mt-2 uppercase text-right">
                                Atualizado: {new Date(cot.updated_at).toLocaleString('pt-BR')}
                            </p>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {cotacoes?.length === 0 && !isLoading && (
                <Card className="border-dashed border-zinc-300 bg-zinc-50 py-20">
                    <div className="text-center font-black uppercase text-zinc-400">
                        Nenhuma cotação encontrada. Clique em sincronizar.
                    </div>
                </Card>
            )}
        </AdminLayout>
    )
}
