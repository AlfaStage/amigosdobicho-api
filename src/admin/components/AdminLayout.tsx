import { ReactNode, useEffect, useState } from 'react'
import { Sidebar } from './Sidebar'

interface AdminLayoutProps {
    children: ReactNode
    title: string
    description?: string
}

export function AdminLayout({ children, title, description }: AdminLayoutProps) {
    const [isAuth, setIsAuth] = useState(false)

    useEffect(() => {
        // Verificar API Key na URL ou LocalStorage
        const urlParams = new URLSearchParams(window.location.search)
        const key = urlParams.get('key') || localStorage.getItem('admin_api_key')

        if (key) {
            localStorage.setItem('admin_api_key', key)
            setIsAuth(true)
        } else {
            const promptKey = prompt('Por favor, insira sua API KEY:')
            if (promptKey) {
                localStorage.setItem('admin_api_key', promptKey)
                setIsAuth(true)
            } else {
                window.location.href = '/'
            }
        }
    }, [])

    if (!isAuth) return <div className="p-10 font-black">Autenticando...</div>

    return (
        <div className="min-h-screen bg-[#F0F0F0] text-black font-sans selection:bg-[#00E676] selection:text-black">
            <Sidebar />
            <main className="ml-64 p-10 max-w-7xl mx-auto">
                <header className="mb-10 border-b-8 border-black pb-8">
                    <h1 className="text-6xl font-black uppercase tracking-tighter leading-none mb-4">
                        {title}
                    </h1>
                    {description && (
                        <p className="text-xl font-bold text-muted-foreground bg-black text-white inline-block px-4 py-1 uppercase tracking-tight">
                            {description}
                        </p>
                    )}
                </header>
                {children}
            </main>
        </div>
    )
}
