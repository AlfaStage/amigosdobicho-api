import { useState, useEffect } from 'react'
import { LayoutDashboard, Webhook, ShieldAlert, Image, Megaphone, Settings, LogOut } from 'lucide-react'
import { cn } from "@/lib/utils"

const navItems = [
    { name: 'Status', icon: LayoutDashboard, href: '/admin/status' },
    { name: 'Cotas', icon: Megaphone, href: '/admin/cotacoes' },
    { name: 'Webhooks', icon: Webhook, href: '/admin/webhooks' },
    { name: 'Proxies', icon: ShieldAlert, href: '/admin/proxies' },
    { name: 'Designer', icon: Image, href: '/admin/template' },
]

export function Sidebar() {
    const [activePath, setActivePath] = useState('')

    useEffect(() => {
        setActivePath(window.location.pathname)
    }, [])

    const handleLogout = () => {
        localStorage.removeItem('admin_api_key')
        window.location.href = '/'
    }

    return (
        <aside className="w-64 min-h-screen bg-white border-r-4 border-black flex flex-col p-4 fixed left-0 top-0">
            <div className="mb-10 px-2 py-4 border-b-4 border-black">
                <h1 className="text-2xl font-black uppercase tracking-tighter leading-none">
                    AlfaStage <span className="text-sm block font-bold text-muted-foreground mt-1">v2.5.0 Brutal</span>
                </h1>
            </div>

            <nav className="flex-1 space-y-2">
                {navItems.map((item) => (
                    <a
                        key={item.name}
                        href={`${item.href}?key=${localStorage.getItem('admin_api_key') || ''}`}
                        className={cn(
                            "flex items-center gap-3 px-4 py-3 font-black uppercase tracking-tight text-sm border-2 border-transparent transition-all",
                            activePath === item.href
                                ? "bg-black text-white border-black shadow-[4px_4px_0px_0px_rgba(0,230,118,1)]"
                                : "hover:bg-zinc-100 hover:border-black"
                        )}
                    >
                        <item.icon size={18} strokeWidth={3} />
                        {item.name}
                    </a>
                ))}
            </nav>

            <div className="mt-auto border-t-4 border-black pt-4">
                <button
                    onClick={handleLogout}
                    className="w-full flex items-center gap-3 px-4 py-3 font-black uppercase text-sm text-red-600 hover:bg-red-50 transition-all border-2 border-transparent hover:border-black"
                >
                    <LogOut size={18} strokeWidth={3} />
                    Sair
                </button>
            </div>
        </aside>
    )
}
