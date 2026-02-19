(function () {
    // 1. Configurações Globais e Auth
    const urlParams = new URLSearchParams(window.location.search);
    let apiKey = urlParams.get('key') || localStorage.getItem('admin_api_key');
    if (apiKey) localStorage.setItem('admin_api_key', apiKey);
    window.adminApiKey = apiKey;

    // 2. Componentes UI (Layout Engine)
    const UI = {
        toast(message, type = 'success') {
            let container = document.getElementById('admin-toasts');
            if (!container) {
                container = document.createElement('div');
                container.id = 'admin-toasts';
                document.body.appendChild(container);
            }
            const toast = document.createElement('div');
            toast.className = `toast ${type}`;
            const icon = type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️';
            toast.innerHTML = `<i>${icon}</i> <span>${message}</span>`;
            container.appendChild(toast);
            setTimeout(() => {
                toast.style.opacity = '0';
                toast.style.transform = 'translateX(20px)';
                setTimeout(() => toast.remove(), 300);
            }, 3000);
        },

        injectLayout() {
            if (document.getElementById('admin-sidebar')) return;

            // Injetar Sidebar
            const sidebar = document.createElement('div');
            sidebar.id = 'admin-sidebar';
            const currentPath = window.location.pathname;
            const menuItems = [
                { name: 'Status', path: '/admin/status', icon: '📊' },
                { name: 'Cotações', path: '/admin/cotacoes', icon: '🦁' },
                { name: 'Webhooks', path: '/admin/webhooks', icon: '⚓' },
                { name: 'Proxies', path: '/admin/proxies-page', icon: '🛡️' },
                { name: 'Template', path: '/admin/template', icon: '🎨' },
                { name: 'API Docs', path: '/docs', icon: '📚' }
            ];

            let navHtml = '';
            menuItems.forEach(item => {
                const isActive = currentPath.includes(item.path);
                const url = apiKey && !item.path.includes('/docs') ? `${item.path}?key=${apiKey}` : item.path;
                navHtml += `<a href="${url}" class="${isActive ? 'active' : ''}"><i>${item.icon}</i> <span>${item.name}</span></a>`;
            });

            sidebar.innerHTML = `
                <div class="sidebar-header">
                    <h1>JB Admin</h1>
                </div>
                <nav>${navHtml}</nav>
                <div class="sidebar-footer">v2.5.0 • AlfaStage</div>
            `;
            document.body.prepend(sidebar);

            // Adicionar Header na página se não existir
            const main = document.querySelector('main') || document.body;
            if (main && !main.querySelector('.page-header')) {
                // Opcional: injetar header automático baseado no título da página
            }
        }
    };

    window.UI = UI;

    // 3. Utilitários de API
    window.fetchAdmin = async (url, options = {}) => {
        const key = window.adminApiKey;
        const separator = url.includes('?') ? '&' : '?';
        const finalUrl = key ? `${url}${separator}key=${key}` : url;

        try {
            const response = await fetch(finalUrl, options);
            if (response.status === 401) {
                UI.toast('Sessão expirada ou chave inválida', 'error');
                return null;
            }
            return response;
        } catch (error) {
            UI.toast('Erro na conexão com o servidor', 'error');
            throw error;
        }
    };

    // 4. Correção automática de links (Injeção de API Key)
    document.addEventListener('click', (e) => {
        const link = e.target.closest('a');
        if (link && link.href && link.href.startsWith(window.location.origin)) {
            const url = new URL(link.href);
            if (apiKey && !url.searchParams.has('key') && !url.pathname.includes('/docs') && url.pathname.startsWith('/admin')) {
                e.preventDefault();
                url.searchParams.set('key', apiKey);
                window.location.href = url.toString();
            }
        }
    }, true);

    // 5. Init
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', UI.injectLayout);
    } else {
        UI.injectLayout();
    }
})();
