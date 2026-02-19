import React from 'react'
import ReactDOM from 'react-dom/client'
import StatusPage from './StatusPage'
import '../../styles/globals.css'
import { Providers } from '../../components/Providers'

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <Providers>
            <StatusPage />
        </Providers>
    </React.StrictMode>,
)
