import axios from 'axios';

const BASE_URL = 'http://localhost:3002/v1/webhooks';

async function testWebhooks() {
    console.log('=== Testando APIs de Webhooks ===\n');
    
    try {
        // 1. Listar lotéricas disponíveis
        console.log('1. Listando lotéricas disponíveis...');
        const lotericasRes = await axios.get(`${BASE_URL}/lotericas/available`);
        console.log(`   ✓ Encontradas ${lotericasRes.data.length} lotéricas`);
        console.log(`   Primeiras 3: ${lotericasRes.data.slice(0, 3).map((l: any) => l.slug).join(', ')}\n`);

        // 2. Criar um webhook de teste
        console.log('2. Criando webhook de teste...');
        const testUrl = 'https://webhook.site/unique-id-test';
        const createRes = await axios.post(BASE_URL, { url: testUrl });
        const webhookId = createRes.data.id;
        console.log(`   ✓ Webhook criado com ID: ${webhookId}\n`);

        // 3. Listar webhooks com configuração
        console.log('3. Listando webhooks com configuração...');
        const listRes = await axios.get(`${BASE_URL}/with-config`);
        console.log(`   ✓ Total de webhooks: ${listRes.data.length}`);
        const createdWebhook = listRes.data.find((w: any) => w.id === webhookId);
        if (createdWebhook) {
            const enabledCount = createdWebhook.lotericas.filter((l: any) => l.enabled).length;
            console.log(`   ✓ Webhook tem ${enabledCount} lotéricas ativas por padrão\n`);
        }

        // 4. Obter detalhes do webhook
        console.log('4. Obtendo detalhes do webhook...');
        const detailRes = await axios.get(`${BASE_URL}/${webhookId}`);
        console.log(`   ✓ URL: ${detailRes.data.url}`);
        console.log(`   ✓ Lotéricas configuradas: ${detailRes.data.lotericas.length}\n`);

        // 5. Atualizar configuração de lotéricas (desativar algumas)
        console.log('5. Atualizando configuração de lotéricas...');
        const lotericasToEnable = detailRes.data.lotericas
            .slice(0, 5)
            .map((l: any) => l.slug);
        await axios.put(`${BASE_URL}/${webhookId}/lotericas`, { lotericas: lotericasToEnable });
        
        // Verificar se foi atualizado
        const updatedRes = await axios.get(`${BASE_URL}/${webhookId}`);
        const updatedEnabledCount = updatedRes.data.lotericas.filter((l: any) => l.enabled).length;
        console.log(`   ✓ Configuração atualizada. Agora tem ${updatedEnabledCount} lotéricas ativas\n`);

        // 6. Ver histórico (deve estar vazio)
        console.log('6. Verificando histórico de disparos...');
        const historyRes = await axios.get(`${BASE_URL}/${webhookId}/history`);
        console.log(`   ✓ Histórico retornado: ${historyRes.data.length} registros\n`);

        // 7. Ver histórico geral
        console.log('7. Verificando histórico geral...');
        const allHistoryRes = await axios.get(`${BASE_URL}/history/all?limit=10`);
        console.log(`   ✓ Histórico geral: ${allHistoryRes.data.length} registros\n`);

        // 8. Remover webhook de teste
        console.log('8. Removendo webhook de teste...');
        await axios.delete(`${BASE_URL}/${webhookId}`);
        console.log('   ✓ Webhook removido com sucesso\n');

        console.log('=== ✅ Todos os testes passaram! ===');
        
    } catch (error: any) {
        console.error('❌ Erro durante os testes:', error.message);
        if (error.response) {
            console.error('   Status:', error.response.status);
            console.error('   Data:', error.response.data);
        }
        process.exit(1);
    }
}

testWebhooks();
