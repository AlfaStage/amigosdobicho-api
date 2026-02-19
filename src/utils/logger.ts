const formatTimestamp = (): string => {
    const now = new Date();
    return now.toLocaleString('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });
};

export const logger = {
    info: (service: string, message: string, ...args: any[]) => {
        console.log(`[${formatTimestamp()}] [${service}] ${message}`, ...args);
    },
    
    error: (service: string, message: string, ...args: any[]) => {
        console.error(`[${formatTimestamp()}] [${service}] ERROR: ${message}`, ...args);
    },
    
    warn: (service: string, message: string, ...args: any[]) => {
        console.warn(`[${formatTimestamp()}] [${service}] WARN: ${message}`, ...args);
    },
    
    debug: (service: string, message: string, ...args: any[]) => {
        if (process.env.DEBUG === 'true') {
            console.log(`[${formatTimestamp()}] [${service}] DEBUG: ${message}`, ...args);
        }
    },
    
    success: (service: string, message: string, ...args: any[]) => {
        console.log(`[${formatTimestamp()}] [${service}] ✓ ${message}`, ...args);
    }
};
