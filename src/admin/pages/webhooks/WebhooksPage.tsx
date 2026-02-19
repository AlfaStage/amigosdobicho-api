import { useQuery, useMutation } from '@tanstack/react-query'
import axios from 'axios'
import { useState } from 'react'
import { AdminLayout } from '../../components/AdminLayout'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card'
import { Button } from '../../components/ui/button'
import { Webhook, Trash2, Play, History, Settings2, Plus, Globe, CheckCircle2, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

const fetchWebhooks = async () => {
    const key = localStorage.getItem('admin_api_key')
    const { data } = await axios.get(`/v1/webhooks?key=${key}`)
    return data || []
}

export default function WebhooksPage() {
    const [newUrl, setNewUrl] = useState('')
    const { data: webhooks, isLoading, refetch } = useQuery({
        queryKey: ['webhooks'],
        queryFn: fetchWebhooks
    })

    const addMutation = useMutation({
        mutationFn: async (url: string) => {
            const key = localStorage.getItem('admin_api_key')
            return axios.post(`/v1/webhooks?key=${key}`, { url })
        },
        onSuccess: () => {
            setNewUrl('')
            refetch()
            alert('Webhook adicionado!')
        }
    })

    const deleteMutation = useMutation({
        mutationFn: async (id: string) => {
            const key = localStorage.getItem('admin_api_key')
            return axios.delete(`/v1/webhooks/${id}?key=${key}`)
        },
        onSuccess: () => refetch()
    })

    const testMutation = useMutation({
        mutationFn: async (id: string) => {
            const key = localStorage.getItem('admin_api_key')
            return axios.post(`/v1/webhooks/${id}/test?key=${key}`)
        },
        onSuccess: (res) => alert(`Teste enviado! Status: ${res.data.status_code || 'Enviado'}`)
    })

    return (
        <AdminLayout
            title="Webhooks"
            description="Integração Brutalista em Tempo Real"
        >
            <Card className="mb-10 border-black bg-zinc-50">
                <CardHeader>
                    <CardTitle className="text-xl">Novo Ponto de Extremidade (Endpoint)</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="flex gap-4">
                        <input
                            type="text"
                            value={newUrl}
                            onChange={(e) => setNewUrl(e.target.value)}
                            placeholder="https://sua-api.com/webhook"
                            className="flex-1 bg-white border-4 border-black p-4 font-bold focus:outline-none focus:ring-4 focus:ring-[#00E676]/20 transition-all"
                        />
                        <Button
                            variant="secondary"
                            onClick={() => addMutation.mutate(newUrl)}
                            disabled={!newUrl || addMutation.isPending}
                        >
                            <Plus className="mr-2 h-5 w-5" />
                            Registrar
                        </Button>
                    </div>
                </CardContent>
            </Card>

            <div className="grid grid-cols-1 gap-6">
                {isLoading ? (
                    <div className="p-20 text-center font-black animate-pulse">CARREGANDO WEBHOOKS...</div>
                ) : webhooks?.map((wh: any) => (
                    <Card key={wh.id} className="group hover:-translate-y-1 transition-all">
                        <CardContent className="p-6">
                            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                                <div className="flex items-center gap-4">
                                    <div className="bg-black text-white p-3 border-2 border-black">
                                        <Globe size={24} />
                                    </div>
                                    <div>
                                        <h3 className="text-xl font-black truncate max-w-md">{wh.url}</h3>
                                        <div className="flex gap-2 mt-1">
                                            <span className="bg-zinc-100 px-2 py-0.5 text-[10px] font-black uppercase border border-black">
                                                ID: {wh.id.substring(0, 8)}
                                            </span>
                                            <span className="bg-[#00E676] px-2 py-0.5 text-[10px] font-black uppercase border border-black">
                                                Ativo
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                <div className="flex gap-2 w-full md:w-auto">
                                    <Button variant="outline" className="flex-1 md:flex-none border-2 px-3" title="Testar Agora" onClick={() => testMutation.mutate(wh.id)}>
                                        <Play size={16} fill="currentColor" />
                                    </Button>
                                    <Button variant="outline" className="flex-1 md:flex-none border-2 px-3" title="Histórico">
                                        <History size={16} />
                                    </Button>
                                    <Button variant="outline" className="flex-1 md:flex-none border-2 px-3" title="Configurar Lotericas">
                                        <Settings2 size={16} />
                                    </Button>
                                    <Button
                                        variant="outline"
                                        className="flex-1 md:flex-none border-2 px-3 text-red-600 hover:bg-red-50 border-red-600"
                                        onClick={() => confirm('Excluir?') && deleteMutation.mutate(wh.id)}
                                    >
                                        <Trash2 size={16} />
                                    </Button>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>
        </AdminLayout>
    )
}
