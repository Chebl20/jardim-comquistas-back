// Inspeciona resposta bruta do LLM para o prompt de Clarification e compara com ClarificationNucleus.analyze
// Uso: node scripts/inspect-llm-clarification.js

const { NestFactory } = require('@nestjs/core');

async function run() {
  try {
    const { AppModule } = require('../dist/app.module');
    const app = await NestFactory.createApplicationContext(AppModule, { logger: false });

    const ConversationOrchestrator = require('../dist/modules/ia/conversation/conversation-orchestrator.service');
    const ClarificationModule = require('../dist/modules/ia/nuclei/clarification/index');
    const ClarificationPrompt = require('../dist/modules/ia/nuclei/clarification/prompt');
    const ConversationAI = require('../dist/modules/ia/conversation-ai.service');

    const clarification = app.get(ClarificationModule.ClarificationNucleus || ClarificationModule.default);
    const aiService = app.get(ConversationAI.ConversationAIService || ConversationAI.default);

    const PROMPT = ClarificationPrompt.PROMPT || ClarificationPrompt.default || ClarificationPrompt;

    const userMessage = 'quero criar uma meta';
    const systemPrompt = `${PROMPT}\n\nEstado atual da máquina: IDLE\nPayload atual: {}`;

    console.log('=== Chamando OpenAI diretamente (raw) ===');
    const OpenAI = require('openai').default || require('openai');
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
    const completion = await client.chat.completions.create({ model, temperature: 0, messages: [ { role: 'system', content: systemPrompt }, { role: 'user', content: `Mensagem do usuário: ${userMessage}` } ] });
    const raw = completion.choices?.[0]?.message?.content ?? completion;
    console.log('Raw LLM content:');
    console.log(String(raw));

    try {
      const parsed = typeof raw === 'object' ? raw : JSON.parse(String(raw));
      console.log('\nParsed JSON from LLM:');
      console.log(parsed);
    } catch (e) {
      console.log('\nNão foi possível parsear o JSON bruto do LLM.');
    }

    console.log('\n=== Chamando ClarificationNucleus.analyze (processado) ===');
    const clarRes = await clarification.analyze({ userId: 'test', currentSession: 'IDLE', text: userMessage, meta: {} });
    console.log(clarRes);

    await app.close();
    process.exit(0);
  } catch (e) {
    console.error('Erro ao inspecionar LLM:', e);
    process.exit(1);
  }
}

run();
