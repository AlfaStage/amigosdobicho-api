import React from 'react'
import ReactDOM from 'react-dom/client'
import WebhooksPage from './WebhooksPage'
import '../../styles/globals.css'
import { Providers } from '../../components/Providers'

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <Providers>
            <WebhooksPage />
        </Providers>
    </React.StrictMode>,
)
