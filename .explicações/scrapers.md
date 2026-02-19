# Scrapers de Dados

O sistema utiliza uma arquitetura de scrapers multi-fonte para garantir alta disponibilidade e redundância dos dados.

## Base
- **ScraperBase**: Classe abstrata que implementa retry infinito, backoff exponencial e fallback para navegador (Puppeteer) após 5 falhas consecutivas via Axios.

## Fontes
- **OjogodobichoScraper**: Fonte primária para resultados "Deu no Poste" (Rio).
- **GigaBichoScraper**: Fonte secundária com ampla cobertura de lotéricas estaduais.
- **ResultadoFacilScraper**: Fonte terciária de redundância.
- **HoroscopoScraper**: Coleta previsões e números da sorte por signo.

## Resiliência
- Se uma requisição HTTP simples (Axios) falhar repetidamente, o sistema inicia automaticamente uma instância do **BrowserScraper** (Puppeteer) para navegar no site como um usuário real, contornando bloqueios de bot básicos.
