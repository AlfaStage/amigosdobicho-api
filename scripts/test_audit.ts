import { MarketingAuditService } from '../src/services/MarketingAuditService.js';

// Roda auditoria para Fevereiro de 2026 (mes=1, base 0)
MarketingAuditService.runAudit(1, 2026).catch(console.error);
