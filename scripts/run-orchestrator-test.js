// Script de teste rápido para o orchestrator
// Uso: npm run build && node scripts/run-orchestrator-test.js

const { NestFactory } = require('@nestjs/core');

async function run() {
  try {
    // importa o AppModule compilado
    const { AppModule } = require('../dist/app.module');
    const app = await NestFactory.createApplicationContext(AppModule, { logger: false });

    // importa AiModule e o service compilado
    const aiModule = require('../dist/modules/ia/ai.module');
    const orchestratorModule = require('../dist/modules/ia/conversation/conversation-orchestrator.service');
    const ConversationOrchestratorService = orchestratorModule.ConversationOrchestratorService || orchestratorModule.default;

    const orchestrator = app.get(ConversationOrchestratorService);
    if (!orchestrator) {
      console.error('Não foi possível obter ConversationOrchestratorService do contexto Nest.');
      await app.close();
      process.exit(1);
    }

    const userId = 'test-user-1';

    console.log('--- Teste 1: IDLE, mensagem não-intent ---');
    const res1 = await orchestrator.handle({ currentState: 'IDLE', payload: { user: { id: userId, name: 'Tester' } }, userMessage: 'Olá, tudo bem?', userId });
    console.log('Resposta:', res1);

    console.log('\n--- Teste 2: IDLE -> Clarification sinaliza new_intent CREATE_GOAL (simulado) ---');
    // Simulação: em ambiente real o Clarification viria do LLM. Aqui enviamos uma mensagem com intenção clara.
    const res2 = await orchestrator.handle({ currentState: 'IDLE', payload: { user: { id: userId, name: 'Tester' } }, userMessage: 'Quero criar uma meta para correr às 18:00', userId });
    console.log('Resposta:', res2);

    console.log('\n--- Teste 3: GOAL_CREATION state (continuação) ---');
    const res3 = await orchestrator.handle({ currentState: 'GOAL_CREATION', payload: { user: { id: userId, name: 'Tester' }, title: 'Correr' }, userMessage: '18:00', userId });
    console.log('Resposta:', res3);

    await app.close();
    process.exit(0);
  } catch (e) {
    console.error('Erro no teste do orchestrator:', e);
    process.exit(1);
  }
}

run();
