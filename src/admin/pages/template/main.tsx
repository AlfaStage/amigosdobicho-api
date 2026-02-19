import React from 'react'
import ReactDOM from 'react-dom/client'
import TemplatePage from './TemplatePage'
import '../../styles/globals.css'
import { Providers } from '../../components/Providers'

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <Providers>
            <TemplatePage />
        </Providers>
    </React.StrictMode>,
)
