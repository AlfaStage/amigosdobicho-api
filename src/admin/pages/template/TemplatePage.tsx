import { useQuery, useMutation } from '@tanstack/react-query'
import axios from 'axios'
import { useState, useEffect } from 'react'
import { AdminLayout } from '../../components/AdminLayout'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/card'
import { Button } from '../../components/ui/button'
import { Layout, Save, Eye, Palette, Type, Maximize, Minus, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'

const fetchConfig = async () => {
    const key = localStorage.getItem('admin_api_key')
    const { data } = await axios.get(`/admin/api/templates/current?key=${key}`)
    return data
}

export default function TemplatePage() {
    const [config, setConfig] = useState<any>(null)
    const [previewUrl, setPreviewUrl] = useState('')

    const { data: initialConfig, isLoading } = useQuery({
        queryKey: ['template-config'],
        queryFn: fetchConfig
    })

    useEffect(() => {
        if (initialConfig) setConfig(initialConfig)
    }, [initialConfig])

    const saveMutation = useMutation({
        mutationFn: async (newConfig: any) => {
            const key = localStorage.getItem('admin_api_key')
            return axios.post(`/admin/api/templates/save?key=${key}`, newConfig)
        },
        onSuccess: () => alert('Template salvo com sucesso!')
    })

    const updateField = (path: string, value: any) => {
        const newConfig = { ...config }
        const keys = path.split('.')
        let current = newConfig
        for (let i = 0; i < keys.length - 1; i++) {
            current = current[keys[i]]
        }
        current[keys[keys.length - 1]] = value
        setConfig(newConfig)
    }

    const refreshPreview = () => {
        const key = localStorage.getItem('admin_api_key')
        setPreviewUrl(`/admin/api/templates/preview?key=${key}&t=${Date.now()}`)
    }

    if (isLoading || !config) return <AdminLayout title="Designer">Loading...</AdminLayout>

    return (
        <AdminLayout
            title="Design de Resultado"
            description="Motor de Renderização Brutalista (Satori + HTML)"
        >
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-10">
                {/* Editor Side */}
                <div className="space-y-8">
                    <Card>
                        <CardHeader className="bg-black text-white p-4">
                            <CardTitle className="flex items-center gap-2 uppercase">
                                <Palette size={18} /> Cores e Estilos
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="p-6 space-y-6">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black uppercase">Fundo Principal</label>
                                    <div className="flex gap-2">
                                        <input
                                            type="color"
                                            value={config.colors.background}
                                            onChange={(e) => updateField('colors.background', e.target.value)}
                                            className="w-12 h-12 border-2 border-black cursor-pointer"
                                        />
                                        <input
                                            type="text"
                                            value={config.colors.background}
                                            onChange={(e) => updateField('colors.background', e.target.value)}
                                            className="flex-1 font-mono border-2 border-black px-2 uppercase text-sm"
                                        />
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black uppercase">Destaque (Accent)</label>
                                    <div className="flex gap-2">
                                        <input
                                            type="color"
                                            value={config.colors.accent}
                                            onChange={(e) => updateField('colors.accent', e.target.value)}
                                            className="w-12 h-12 border-2 border-black cursor-pointer"
                                        />
                                        <input
                                            type="text"
                                            value={config.colors.accent}
                                            onChange={(e) => updateField('colors.accent', e.target.value)}
                                            className="flex-1 font-mono border-2 border-black px-2 uppercase text-sm"
                                        />
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <label className="text-[10px] font-black uppercase">Raio das Bordas: {config.styles.borderRadius}px</label>
                                <input
                                    type="range" min="0" max="40" step="1"
                                    value={config.styles.borderRadius}
                                    onChange={(e) => updateField('styles.borderRadius', e.target.value)}
                                    className="w-full accent-black"
                                />
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader className="bg-black text-white p-4">
                            <CardTitle className="flex items-center gap-2 uppercase">
                                <Type size={18} /> Tipografia
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="p-6 space-y-4">
                            <div className="space-y-2">
                                <label className="text-[10px] font-black uppercase">Título das Tabelas</label>
                                <input
                                    type="text"
                                    value={config.fonts.titleSize}
                                    onChange={(e) => updateField('fonts.titleSize', e.target.value)}
                                    className="w-full border-2 border-black p-2 font-bold"
                                    placeholder="ex: 24px"
                                />
                            </div>
                        </CardContent>
                    </Card>

                    <div className="sticky bottom-4 flex gap-4">
                        <Button variant="primary" className="flex-1" onClick={() => saveMutation.mutate(config)} disabled={saveMutation.isPending}>
                            <Save className="mr-2 h-5 w-5" />
                            Salvar Alterações
                        </Button>
                        <Button variant="secondary" className="flex-1" onClick={refreshPreview}>
                            <Eye className="mr-2 h-5 w-5" />
                            Gerar Preview
                        </Button>
                    </div>
                </div>

                {/* Preview Side */}
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <h3 className="font-black uppercase text-sm tracking-widest">Visualização ao Vivo</h3>
                        <div className="flex gap-1">
                            <div className="w-3 h-3 bg-red-500 border border-black rounded-full" />
                            <div className="w-3 h-3 bg-yellow-400 border border-black rounded-full" />
                            <div className="w-3 h-3 bg-green-500 border border-black rounded-full" />
                        </div>
                    </div>

                    <div className="border-8 border-black bg-zinc-800 shadow-brutal-lg min-h-[600px] flex items-center justify-center relative overflow-hidden">
                        {previewUrl ? (
                            <img src={previewUrl} alt="Preview" className="max-w-full shadow-2xl" />
                        ) : (
                            <div className="text-zinc-500 font-black uppercase text-center animate-pulse">
                                Clique em "Gerar Preview"<br />para renderizar
                            </div>
                        )}
                        <div className="absolute inset-0 pointer-events-none border-[20px] border-black/10" />
                    </div>

                    <div className="bg-black p-4 text-[#00E676] font-mono text-xs border-4 border-black">
                        {`// LOGS DE RENDERIZAÇÃO\n`}
                        {`[INFO] Engine: Satori HTML-to-SVG\n`}
                        {`[INFO] Template: Default v2.0\n`}
                        {`[OK] Estilos processados com sucesso.`}
                    </div>
                </div>
            </div>
        </AdminLayout>
    )
}
