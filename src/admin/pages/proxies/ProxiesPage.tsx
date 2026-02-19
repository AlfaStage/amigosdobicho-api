import { useQuery, useMutation } from '@tanstack/react-query'
import axios from 'axios'
import { AdminLayout } from '../../components/AdminLayout'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card'
import { Button } from '../../components/ui/button'
import { ShieldCheck, ShieldX, RefreshCcw, Plus, Download, Settings } from 'lucide-react'
import { cn } from '@/lib/utils'

const fetchProxies = async () => {
    const key = localStorage.getItem('admin_api_key')
    const { data } = await axios.get(`/proxies?key=${key}`)
    return data || []
}

export default function ProxiesPage() {
    const { data: proxies, isLoading, refetch } = useQuery({
        queryKey: ['proxies'],
        queryFn: fetchProxies
    })

    const testAllMutation = useMutation({
        mutationFn: async () => {
            const key = localStorage.getItem('admin_api_key')
            return axios.post(`/proxies/test?key=${key}`)
        },
        onSuccess: () => {
            refetch()
            alert('Teste em massa iniciado!')
        }
    })

    const collectMutation = useMutation({
        mutationFn: async () => {
            const key = localStorage.getItem('admin_api_key')
            return axios.post(`/proxies/collect?key=${key}`)
        },
        onSuccess: () => {
            refetch()
            alert('Coleta de novos proxies iniciada!')
        }
    })

    const stats = {
        total: proxies?.length || 0,
        online: proxies?.filter((p: any) => p.status === 'online').length || 0,
        offline: proxies?.filter((p: any) => p.status !== 'online').length || 0
    }

    return (
        <AdminLayout
            title="Gestão de Proxies"
            description="Escudo Brutalista contra Bloqueios"
        >
            <div className="flex gap-4 mb-10 overflow-x-auto pb-2">
                <Button variant="outline" onClick={() => collectMutation.mutate()} disabled={collectMutation.isPending}>
                    <Download className="mr-2 h-4 w-4" />
                    Coletar Novos
                </Button>
                <Button variant="secondary" onClick={() => testAllMutation.mutate()} disabled={testAllMutation.isPending}>
                    <ShieldCheck className="mr-2 h-4 w-4" />
                    Testar Todos
                </Button>
                <Button variant="primary">
                    <Plus className="mr-2 h-4 w-4" />
                    Adicionar Proxy
                </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-10">
                <Card className="border-black">
                    <CardHeader>
                        <CardTitle className="text-4xl">{stats.total}</CardTitle>
                        <p className="font-black uppercase text-xs">Total de Proxies</p>
                    </CardHeader>
                </Card>
                <Card className="border-[#00E676]">
                    <CardHeader>
                        <CardTitle className="text-4xl text-[#00E676]">{stats.online}</CardTitle>
                        <p className="font-black uppercase text-xs">Ativos</p>
                    </CardHeader>
                </Card>
                <Card className="border-[#FF5252]">
                    <CardHeader>
                        <CardTitle className="text-4xl text-[#FF5252]">{stats.offline}</CardTitle>
                        <p className="font-black uppercase text-xs">Inativos</p>
                    </CardHeader>
                </Card>
            </div>

            <Card>
                <CardHeader className="bg-black text-white p-4">
                    <div className="flex justify-between items-center">
                        <CardTitle className="text-xl">Endpoints Registrados</CardTitle>
                        <Button variant="ghost" className="text-white hover:bg-zinc-800 border-none px-2 py-1" onClick={() => refetch()}>
                            <RefreshCcw size={16} className={isLoading ? "animate-spin" : ""} />
                        </Button>
                    </div>
                </CardHeader>
                <CardContent className="p-0">
                    <table className="w-full">
                        <thead className="bg-zinc-100 border-b-4 border-black">
                            <tr className="text-left font-black uppercase text-sm">
                                <th className="p-4">Endereço</th>
                                <th className="p-4">Tipo</th>
                                <th className="p-4">Status</th>
                                <th className="p-4">Latência</th>
                                <th className="p-4">Ações</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y-2 divide-black">
                            {proxies?.map((proxy: any) => (
                                <tr key={proxy.id} className="hover:bg-zinc-50">
                                    <td className="p-4 font-mono font-bold">{proxy.host}:{proxy.port}</td>
                                    <td className="p-4 uppercase font-black text-xs">{proxy.protocol}</td>
                                    <td className="p-4">
                                        <div className={cn(
                                            "inline-flex items-center gap-2 px-2 py-1 border-2 border-black font-black uppercase text-[10px]",
                                            proxy.status === 'online' ? "bg-[#00E676]" : "bg-[#FF5252] text-white"
                                        )}>
                                            {proxy.status === 'online' ? <ShieldCheck size={12} /> : <ShieldX size={12} />}
                                            {proxy.status}
                                        </div>
                                    </td>
                                    <td className="p-4 font-bold">{proxy.latency}ms</td>
                                    <td className="p-4">
                                        <Button variant="ghost" className="h-8 w-8 p-0 border-2 border-black">
                                            <Settings size={14} />
                                        </Button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </CardContent>
            </Card>
        </AdminLayout>
    )
}
