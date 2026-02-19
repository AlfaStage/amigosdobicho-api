import React from 'react'
import ReactDOM from 'react-dom/client'
import ProxiesPage from './ProxiesPage'
import '../../styles/globals.css'
import { Providers } from '../../components/Providers'

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <Providers>
            <ProxiesPage />
        </Providers>
    </React.StrictMode>,
)
