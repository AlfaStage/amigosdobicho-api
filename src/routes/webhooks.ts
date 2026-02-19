import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { WebhookService } from '../services/WebhookService.js';
import { LOTERIAS } from '../config/loterias.js';

export async function webhooksRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  const service = new WebhookService();

  // Registrar novo webhook
  server.post('/', {
    schema: {
      summary: '📝 Registrar Novo Webhook',
      description: `
Registra um novo URL para receber notificações em tempo real quando novos resultados forem sincronizados.

### Como Funciona:
Quando um novo resultado for sincronizado, a API fará um POST automaticamente para todas as URLs registradas configuradas para receber notificações daquela lotérica específica.

### Payload Enviado:
\`\`\`json
{
  "event": "novo_resultado",
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "data": "2026-02-04",
    "horario": "16:20",
    "loterica": "PT Rio / Deu no Poste",
    "premios": [
      { "posicao": 1, "milhar": "1234", "grupo": 9, "bicho": "Cobra" },
      { "posicao": 2, "milhar": "5678", "grupo": 20, "bicho": "Peru" }
    ]
  },
  "timestamp": "2026-02-04T16:20:05.000Z"
}
\`\`\`

### Exemplo de Requisição:
\`\`\`bash
curl -X POST "http://localhost:3002/v1/webhooks" \\
  -H "x-api-key: SUA_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "url": "https://n8n.meudominio.com/webhook/jogo-do-bicho"
  }'
\`\`\`

### Exemplo de Resposta (201 Created):
\`\`\`json
{
  "message": "Webhook registrado com sucesso",
  "id": "550e8400-e29b-41d4-a716-446655440000"
}
\`\`\`

### Fluxo Completo:
1. Registre um webhook usando este endpoint
2. Configure quais lotéricas devem disparar notificações (use PUT /webhooks/{id}/lotericas)
3. A API enviará POST automaticamente quando houver novos resultados
4. Monitore o histórico de disparos em GET /webhooks/{id}/history

### Segurança:
- Recomendamos usar HTTPS nas URLs
- Implemente verificação do payload no seu endpoint
- Mantenha logs dos eventos recebidos para auditoria
            `,
      tags: ['🪝 Webhooks'],
      body: z.object({
        url: z.string().url().describe('URL HTTPS de destino que receberá as notificações POST')
      }),
      response: {
        201: z.object({
          message: z.string().describe('Mensagem de sucesso'),
          id: z.string().uuid().describe('ID único do webhook criado')
        }).describe('Webhook registrado com sucesso'),
        400: z.object({
          error: z.string(),
          message: z.string()
        }).describe('URL inválida ou malformada')
      }
    }
  }, async (req, reply) => {
    const { url } = req.body;
    const id = await service.register(url);
    return reply.status(201).send({ message: 'Webhook registrado com sucesso', id });
  });

  // Listar webhooks
  server.get('/', {
    schema: {
      summary: '📋 Listar Webhooks',
      description: `
Retorna a lista de todos os webhooks registrados no sistema.

### Exemplo de Requisição:
\`\`\`bash
curl -X GET "http://localhost:3002/v1/webhooks" \\
  -H "x-api-key: SUA_API_KEY"
\`\`\`

### Exemplo de Resposta (200 OK):
\`\`\`json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "url": "https://n8n.meudominio.com/webhook/jogo-do-bicho",
    "created_at": "2026-02-04T10:30:00.000Z"
  },
  {
    "id": "660f9511-f30c-52e5-b827-557766551111",
    "url": "https://meuapp.com/api/webhooks/resultados",
    "created_at": "2026-02-03T15:45:00.000Z"
  }
]
\`\`\`

### Notas:
- Esta rota retorna apenas informações básicas de cada webhook
- Para ver a configuração completa (incluindo lotéricas habilitadas), use GET /webhooks/{id}
            `,
      tags: ['🪝 Webhooks'],
      response: {
        200: z.array(z.object({
          id: z.string().uuid().describe('ID único do webhook'),
          url: z.string().url().describe('URL registrada para callback'),
          created_at: z.string().describe('Data e hora de criação (ISO 8601)')
        })).describe('Lista de webhooks registrados')
      }
    }
  }, async () => {
    return service.list() as any[];
  });

  // Listar webhooks com configuração completa (para admin)
  server.get('/with-config', {
    schema: {
      summary: '⚙️ Listar Webhooks com Configuração Completa',
      description: `
Retorna todos os webhooks com suas configurações de lotéricas.

Útil para visualização administrativa do estado completo dos webhooks.

### Exemplo de Requisição:
\`\`\`bash
curl -X GET "http://localhost:3002/v1/webhooks/with-config" \\
  -H "x-api-key: SUA_API_KEY"
\`\`\`

### Exemplo de Resposta (200 OK):
\`\`\`json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "url": "https://n8n.meudominio.com/webhook/jogo-do-bicho",
    "created_at": "2026-02-04T10:30:00.000Z",
    "lotericas": [
      { "slug": "pt-rio", "nome": "PT Rio / Deu no Poste", "enabled": true },
      { "slug": "look-goias", "nome": "LOOK Goiás", "enabled": true },
      { "slug": "federal", "nome": "Federal", "enabled": false }
    ]
  }
]
\`\`\`
            `,
      tags: ['🪝 Webhooks'],
      response: {
        200: z.array(z.object({
          id: z.string().uuid(),
          url: z.string().url(),
          created_at: z.string(),
          lotericas: z.array(z.object({
            slug: z.string().describe('Slug da lotérica'),
            nome: z.string().describe('Nome da lotérica'),
            enabled: z.boolean().describe('Se está habilitada para este webhook')
          }))
        })).describe('Lista completa de webhooks com configurações')
      }
    }
  }, async () => {
    return service.listWithConfig();
  });

  // Obter detalhes de um webhook específico
  server.get('/:id', {
    schema: {
      summary: '🔍 Obter Webhook Específico',
      description: `
Obtém detalhes completos de um webhook específico, incluindo sua configuração de lotéricas.

### Exemplo de Requisição:
\`\`\`bash
curl -X GET "http://localhost:3002/v1/webhooks/550e8400-e29b-41d4-a716-446655440000" \\
  -H "x-api-key: SUA_API_KEY"
\`\`\`

### Exemplo de Resposta (200 OK):
\`\`\`json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "url": "https://n8n.meudominio.com/webhook/jogo-do-bicho",
  "created_at": "2026-02-04T10:30:00.000Z",
  "lotericas": [
    { "slug": "pt-rio", "nome": "PT Rio / Deu no Poste", "enabled": true },
    { "slug": "look-goias", "nome": "LOOK Goiás", "enabled": true },
    { "slug": "federal", "nome": "Federal", "enabled": false },
    { "slug": "maluca", "nome": "Maluca", "enabled": false }
  ]
}
\`\`\`

### Exemplo de Resposta (404 Not Found):
\`\`\`json
{
  "error": "Webhook não encontrado"
}
\`\`\`
            `,
      tags: ['🪝 Webhooks'],
      params: z.object({
        id: z.string().uuid().describe('ID do webhook (UUID)')
      }),
      response: {
        200: z.object({
          id: z.string().uuid(),
          url: z.string().url(),
          created_at: z.string(),
          lotericas: z.array(z.object({
            slug: z.string(),
            nome: z.string(),
            enabled: z.boolean()
          }))
        }).describe('Detalhes completos do webhook'),
        404: z.object({
          error: z.string().describe('Mensagem de erro')
        }).describe('Webhook não encontrado')
      }
    }
  }, async (req, reply) => {
    const { id } = req.params;
    const webhook = service.getById(id);

    if (!webhook) {
      return reply.status(404).send({ error: 'Webhook não encontrado' });
    }

    const lotericas = service.getWebhookLotericas(id);

    return {
      ...webhook,
      lotericas
    };
  });

  // Atualizar configuração de lotéricas de um webhook
  server.put('/:id/lotericas', {
    schema: {
      summary: '✏️ Configurar Lotéricas do Webhook',
      description: `
Define quais lotéricas irão disparar notificações para este webhook.

Apenas as lotéricas incluídas no array receberão notificações quando houverem novos resultados.

### Exemplo de Requisição:
\`\`\`bash
curl -X PUT "http://localhost:3002/v1/webhooks/550e8400-e29b-41d4-a716-446655440000/lotericas" \\
  -H "x-api-key: SUA_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "lotericas": ["pt-rio", "look-goias"]
  }'
\`\`\`

### Exemplo de Resposta (200 OK):
\`\`\`json
{
  "message": "Configuração atualizada com sucesso"
}
\`\`\`

### Exemplo de Resposta (404 Not Found):
\`\`\`json
{
  "error": "Webhook não encontrado"
}
\`\`\`

### Lotéricas Disponíveis:
- \`pt-rio\` - PT Rio / Deu no Poste
- \`look-goias\` - LOOK Goiás
- \`federal\` - Federal
- \`maluca\` - Maluca
- \`lotece\` - Lotece (Ceará)
- \`ceara\` - Ceará
            `,
      tags: ['🪝 Webhooks'],
      params: z.object({
        id: z.string().uuid().describe('ID do webhook (UUID)')
      }),
      body: z.object({
        lotericas: z.array(z.string()).describe('Array de slugs de lotéricas que devem disparar notificações para este webhook')
      }),
      response: {
        200: z.object({
          message: z.string().describe('Confirmação de sucesso')
        }).describe('Configuração atualizada'),
        404: z.object({
          error: z.string()
        }).describe('Webhook não encontrado')
      }
    }
  }, async (req, reply) => {
    const { id } = req.params;
    const { lotericas } = req.body;

    const webhook = service.getById(id);
    if (!webhook) {
      return reply.status(404).send({ error: 'Webhook não encontrado' });
    }

    service.setWebhookLotericas(id, lotericas);
    return { message: 'Configuração atualizada com sucesso' };
  });

  // Obter histórico de disparos de um webhook
  server.get('/:id/history', {
    schema: {
      summary: '📜 Histórico de Disparos do Webhook',
      description: `
Retorna o histórico de todos os disparos (tentativas de envio) de um webhook específico.

Útil para monitorar se as notificações estão sendo entregues com sucesso.

### Exemplo de Requisição:
\`\`\`bash
# Últimos 50 disparos (padrão)
curl -X GET "http://localhost:3002/v1/webhooks/550e8400-e29b-41d4-a716-446655440000/history" \\
  -H "x-api-key: SUA_API_KEY"

# Limitar a 10 registros
curl -X GET "http://localhost:3002/v1/webhooks/550e8400-e29b-41d4-a716-446655440000/history?limit=10" \\
  -H "x-api-key: SUA_API_KEY"
\`\`\`

### Exemplo de Resposta (200 OK):
\`\`\`json
[
  {
    "id": "770a0622-g40d-63f6-c938-668877662222",
    "webhook_id": "550e8400-e29b-41d4-a716-446655440000",
    "event": "novo_resultado",
    "status": "success",
    "status_code": 200,
    "error_message": null,
    "created_at": "2026-02-04T16:20:05.000Z"
  },
  {
    "id": "880b1733-h51e-74g7-d049-779988773333",
    "webhook_id": "550e8400-e29b-41d4-a716-446655440000",
    "event": "novo_resultado",
    "status": "error",
    "status_code": 500,
    "error_message": "Connection timeout",
    "created_at": "2026-02-04T14:00:12.000Z"
  }
]
\`\`\`

### Campos de Status:
- \`success\` - Webhook entregue com sucesso (2xx)
- \`error\` - Falha na entrega (4xx, 5xx ou exceção)
            `,
      tags: ['🪝 Webhooks'],
      params: z.object({
        id: z.string().uuid().describe('ID do webhook (UUID)')
      }),
      querystring: z.object({
        limit: z.string().optional().describe('Número máximo de registros a retornar (padrão: 50, máx: 500)')
      }),
      response: {
        200: z.array(z.object({
          id: z.string().uuid().describe('ID único do log de disparo'),
          webhook_id: z.string().uuid().describe('ID do webhook'),
          event: z.string().describe('Tipo do evento (ex: novo_resultado)'),
          status: z.enum(['success', 'error']).describe('Status da entrega'),
          status_code: z.number().optional().describe('Código HTTP da resposta (quando sucesso)'),
          error_message: z.string().optional().describe('Mensagem de erro (quando falha)'),
          created_at: z.string().describe('Data/hora do disparo')
        })).describe('Histórico de disparos ordenado por data (mais recente primeiro)'),
        404: z.object({
          error: z.string()
        }).describe('Webhook não encontrado')
      }
    }
  }, async (req, reply) => {
    const { id } = req.params;
    const limit = parseInt(req.query.limit || '50');

    const webhook = service.getById(id);
    if (!webhook) {
      return reply.status(404).send({ error: 'Webhook não encontrado' });
    }

    const history = service.getWebhookHistory(id, limit);
    return history.map(log => ({
      ...log,
      payload: undefined // Não retornar o payload completo para não poluir a resposta
    }));
  });

  // Testar um webhook
  server.post('/:id/test', {
    schema: {
      summary: '🧪 Testar Webhook',
      description: `
Envia uma notificação de teste para o webhook especificado para verificar a conectividade.

### Exemplo de Requisição:
\`\`\`bash
curl -X POST "http://localhost:3002/v1/webhooks/550e8400-e29b-41d4-a716-446655440000/test" \\
  -H "x-api-key: SUA_API_KEY"
\`\`\`
            `,
      tags: ['🪝 Webhooks'],
      params: z.object({
        id: z.string().uuid().describe('ID do webhook a ser testado')
      }),
      response: {
        200: z.object({
          status: z.string(),
          http_code: z.number(),
          response: z.any()
        }).describe('Teste realizado com sucesso'),
        400: z.any(),
        404: z.object({ error: z.string() }),
        500: z.any()
      }
    }
  }, async (req, reply) => {
    const { id } = req.params;
    try {
      const result = await service.testWebhook(id);
      return result;
    } catch (err: any) {
      if (err.message === 'Webhook não encontrado') {
        return reply.status(404).send({ error: err.message });
      }
      return reply.status(500).send(err);
    }
  });

  // Obter histórico geral de todos os webhooks
  server.get('/history/all', {
    schema: {
      summary: '📊 Histórico Geral de Webhooks',
      description: `
Retorna o histórico de disparos de **todos** os webhooks registrados no sistema.

Útil para monitoramento geral e dashboards administrativos.

### Exemplo de Requisição:
\`\`\`bash
# Primeiros 100 registros
curl -X GET "http://localhost:3002/v1/webhooks/history/all" \\
  -H "x-api-key: SUA_API_KEY"

# Paginação
curl -X GET "http://localhost:3002/v1/webhooks/history/all?limit=50&offset=50" \\
  -H "x-api-key: SUA_API_KEY"
\`\`\`

### Exemplo de Resposta (200 OK):
\`\`\`json
[
  {
    "id": "770a0622-g40d-63f6-c938-668877662222",
    "webhook_id": "550e8400-e29b-41d4-a716-446655440000",
    "webhook_url": "https://n8n.meudominio.com/webhook/jogo-do-bicho",
    "event": "novo_resultado",
    "status": "success",
    "status_code": 200,
    "error_message": null,
    "created_at": "2026-02-04T16:20:05.000Z"
  }
]
\`\`\`

### Paginação:
Use os parâmetros \`limit\` e \`offset\` para navegar pelos resultados:
- \`limit\`: Quantidade de registros por página
- \`offset\`: Quantos registros pular (começar do zero)

### Exemplo de Paginação:
\`\`\`bash
# Página 1: offset=0, limit=100
# Página 2: offset=100, limit=100
# Página 3: offset=200, limit=100
\`\`\`
            `,
      tags: ['🪝 Webhooks'],
      querystring: z.object({
        limit: z.string().optional().describe('Quantidade de registros (padrão: 100)'),
        offset: z.string().optional().describe('Offset para paginação (padrão: 0)')
      }),
      response: {
        200: z.array(z.object({
          id: z.string().uuid().describe('ID do log'),
          webhook_id: z.string().uuid().describe('ID do webhook'),
          webhook_url: z.string().describe('URL do webhook'),
          event: z.string().describe('Tipo do evento'),
          status: z.enum(['success', 'error']).describe('Status'),
          status_code: z.number().optional().describe('Código HTTP'),
          error_message: z.string().optional().describe('Erro, se houver'),
          created_at: z.string().describe('Data/hora')
        })).describe('Histórico completo de todos os webhooks')
      }
    }
  }, async (req) => {
    const limit = parseInt(req.query.limit || '100');
    const offset = parseInt(req.query.offset || '0');

    const history = service.getHistory(limit, offset);
    return history.map(log => ({
      id: log.id,
      webhook_id: log.webhook_id,
      webhook_url: (log as any).webhook_url,
      event: log.event,
      status: log.status,
      status_code: log.status_code,
      error_message: log.error_message,
      created_at: log.created_at
    }));
  });

  // Listar todas as lotéricas disponíveis
  server.get('/lotericas/available', {
    schema: {
      summary: '🏪 Listar Lotéricas Disponíveis para Webhooks',
      description: `
Retorna todas as lotéricas disponíveis que podem ser configuradas em webhooks.

Inclui informações sobre horários de sorteio quando disponível.

### Exemplo de Requisição:
\`\`\`bash
curl -X GET "http://localhost:3002/v1/webhooks/lotericas/available" \\
  -H "x-api-key: SUA_API_KEY"
\`\`\`

### Exemplo de Resposta (200 OK):
\`\`\`json
[
  {
    "slug": "pt-rio",
    "nome": "PT Rio / Deu no Poste",
    "horarios": ["11:00", "14:00", "16:00", "18:00", "21:00"]
  },
  {
    "slug": "look-goias",
    "nome": "LOOK Goiás",
    "horarios": ["11:20", "14:00", "16:00", "18:00", "21:00"]
  },
  {
    "slug": "federal",
    "nome": "Federal",
    "horarios": ["19:00"]
  }
]
\`\`\`

### Uso:
Use este endpoint para construir interfaces de configuração de webhooks, permitindo que usuários selecionem quais lotéricas desejam monitorar.
            `,
      tags: ['🪝 Webhooks'],
      response: {
        200: z.array(z.object({
          slug: z.string().describe('Slug único da lotérica'),
          nome: z.string().describe('Nome completo da lotérica'),
          horarios: z.array(z.string()).optional().describe('Horários de sorteio (HH:MM)')
        })).describe('Lista de lotéricas disponíveis para configuração')
      }
    }
  }, async () => {
    return LOTERIAS.map(l => ({
      slug: l.slug,
      nome: l.nome,
      horarios: l.horarios
    }));
  });

  // Remover webhook
  server.delete('/:id', {
    schema: {
      summary: '🗑️ Remover Webhook',
      description: `
Remove um webhook do sistema pelo seu ID.

⚠️ **Atenção:** Esta ação não pode ser desfeita. O webhook será permanentemente excluído e não receberá mais notificações.

### Exemplo de Requisição:
\`\`\`bash
curl -X DELETE "http://localhost:3002/v1/webhooks/550e8400-e29b-41d4-a716-446655440000" \\
  -H "x-api-key: SUA_API_KEY"
\`\`\`

### Exemplo de Resposta (204 No Content):
Resposta vazia com status 204 indicando sucesso na exclusão.

### Exemplo de Resposta (404 Not Found):
\`\`\`json
{
  "error": "Webhook não encontrado"
}
\`\`\`
            `,
      tags: ['🪝 Webhooks'],
      params: z.object({
        id: z.string().uuid().describe('ID do webhook a ser removido')
      }),
      response: {
        204: z.null().describe('Webhook removido com sucesso (sem corpo na resposta)'),
        404: z.object({
          error: z.string()
        }).describe('Webhook não encontrado')
      }
    }
  }, async (req, reply) => {
    const { id } = req.params;
    service.delete(id);
    return reply.status(204).send(null);
  });
}
