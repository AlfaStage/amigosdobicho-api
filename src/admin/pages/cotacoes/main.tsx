import React from 'react'
import ReactDOM from 'react-dom/client'
import CotacoesPage from './CotacoesPage'
import '../../styles/globals.css'
import { Providers } from '../../components/Providers'

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <Providers>
            <CotacoesPage />
        </Providers>
    </React.StrictMode>,
)
