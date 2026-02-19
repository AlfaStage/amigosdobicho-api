import { useQuery } from '@tanstack/react-query'
import axios from 'axios'
import { AdminLayout } from '../../components/AdminLayout'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/card'
import { Button } from '../../components/ui/button'
import { RefreshCcw, Activity } from 'lucide-react'
import { cn } from '@/lib/utils'

const fetchStatus = async () => {
    const key = localStorage.getItem('admin_api_key')
    const { data } = await axios.get(`/admin/api/status/summary?key=${key}`)
    return data
}

export default function StatusPage() {
    const { data, isLoading, refetch } = useQuery({
        queryKey: ['status-summary'],
        queryFn: fetchStatus,
        refetchInterval: 30000
    })

    // Fallback para rota admin no backend (a rota no backend parece ser /admin/api/status/summary ou similar)
    // Verificando src/routes/admin.ts para confirmar o endpoint correto da API de status

    return (
        <AdminLayout
            title="Status da Infra"
            description="Monitoramento Brutalista de Scraping & Logs"
        >
            <div className="flex gap-4 mb-10">
                <Button variant="secondary" onClick={() => refetch()} disabled={isLoading}>
                    <RefreshCcw className={cn("mr-2 h-4 w-4", isLoading && "animate-spin")} />
                    Sincronizar Agora
                </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-10">
                <Card className="border-[#00E676]">
                    <CardHeader>
                        <div className="bg-[#00E676] text-black w-fit px-2 py-0.5 font-black text-xs uppercase mb-2">Operacional</div>
                        <CardTitle className="text-6xl">{data?.stats?.total_success || 0}</CardTitle>
                        <CardDescription>Scrapings com sucesso hoje</CardDescription>
                    </CardHeader>
                </Card>

                <Card className="border-[#FF5252]">
                    <CardHeader>
                        <div className="bg-[#FF5252] text-white w-fit px-2 py-0.5 font-black text-xs uppercase mb-2">Falhas</div>
                        <CardTitle className="text-6xl">{data?.stats?.total_errors || 0}</CardTitle>
                        <CardDescription>Erros detectados hoje</CardDescription>
                    </CardHeader>
                </Card>

                <Card className="border-[#FFD600]">
                    <CardHeader>
                        <div className="bg-[#FFD600] text-black w-fit px-2 py-0.5 font-black text-xs uppercase mb-2">Pendentes</div>
                        <CardTitle className="text-6xl">{data?.stats?.total_pending || 0}</CardTitle>
                        <CardDescription>Aguardando cron job</CardDescription>
                    </CardHeader>
                </Card>
            </div>

            <Card>
                <CardHeader className="border-b-4 border-black pb-4">
                    <CardTitle>Logs de Atividade</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                    <div className="overflow-x-auto">
                        <table className="w-full border-collapse">
                            <thead>
                                <tr className="bg-black text-white uppercase text-sm font-black text-left">
                                    <th className="p-4 text-left">Lotérica</th>
                                    <th className="p-4 text-left">Horário</th>
                                    <th className="p-4 text-left">Status</th>
                                    <th className="p-4 text-left">Tentativa</th>
                                </tr>
                            </thead>
                            <tbody className="font-bold divide-y-2 divide-black">
                                {isLoading ? (
                                    <tr><td colSpan={4} className="p-10 text-center animate-pulse">Carregando logs...</td></tr>
                                ) : data?.items?.map((item: any, idx: number) => (
                                    <tr key={idx} className="hover:bg-zinc-50 transition-colors">
                                        <td className="p-4">{item.loterica_nome}</td>
                                        <td className="p-4"><span className="bg-zinc-200 px-2 py-1">{item.horario}</span></td>
                                        <td className="p-4">
                                            <span className={cn(
                                                "px-2 py-1 uppercase text-xs font-black border-2 border-black",
                                                item.status === 'success' ? "bg-[#00E676]" : "bg-[#FF5252] text-white"
                                            )}>
                                                {item.status}
                                            </span>
                                        </td>
                                        <td className="p-4 text-sm font-mono text-muted-foreground">
                                            {new Date(item.updated_at).toLocaleString('pt-BR')}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </CardContent>
            </Card>
        </AdminLayout>
    )
}


