import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
    plugins: [
        react(),
        tailwindcss(),
    ],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
    base: '/admin/', // Base path for assets
    build: {
        outDir: 'dist-admin',
        emptyOutDir: true,
        rollupOptions: {
            input: {
                status: path.resolve(__dirname, 'src/admin/pages/status/index.html'),
                webhooks: path.resolve(__dirname, 'src/admin/pages/webhooks/index.html'),
                proxies: path.resolve(__dirname, 'src/admin/pages/proxies/index.html'),
                template: path.resolve(__dirname, 'src/admin/pages/template/index.html'),
                cotacoes: path.resolve(__dirname, 'src/admin/pages/cotacoes/index.html'),
            },
        },
    },
});
