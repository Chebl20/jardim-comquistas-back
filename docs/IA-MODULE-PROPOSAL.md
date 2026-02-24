Proposta de implementação e plano detalhado — módulo `src/modules/ia`

Objetivo
--------
Reduzir o sistema para um fluxo conversacional maduro e determinístico, focado em:
- `ConversationSessionService`
- `ClarificationNucleus`
- `GoalCreationNucleus`
- `ConversationAIService`
- `UserGoalService.createUserGoalWithTree`

Remover/decoplar tudo o que faz heurística ou roteamento paralelo (IntentRouter, RulesService, lógica de reminders, utilitários ASK_INFO, etc.). Congelar um contrato único do LLM e garantir que o Orchestrator seja o executor determinístico.

Plano de trabalho (ordem segura)
-------------------------------
1) Congelar o contrato do LLM (definir schema único e exigir-o no `ConversationAIService`).
2) Simplificar `ConversationAIService`: não fazer "correções" no retorno do LLM — exigir JSON válido e propagar erro.
3) Atualizar `flow.types.ts` para estados fixos e tipagem estrita.
4) Simplificar `ClarificationNucleus` (apenas classification → redirect/reply; nunca heurística local; redirect preserva `extracted` completo).
5) Simplificar `GoalCreationNucleus` (usar apenas `finished` e `classification === 'cancel'` → create/ cancel/ continue; confiar 100% no `extracted`).
6) Atualizar `ConversationOrchestratorService` para ser determinístico (já alterado parcialmente):
   - Recarregar sessão antes de cada iteração;
   - Executar actions em ordem;
   - Se action `redirect`, reexecutar destino NO MESMO REQUEST (máx 3 iterações);
   - Persistir apenas em `create_goal` action;
   - Somente entender `actions[]` — qualquer outro formato do núcleo causa erro controlado e reply fallback;
7) Remover `IntentRouter`, `RulesService` e demais serviços do fluxo conversacional (desacoplar do `ai.module.ts`).
8) Ajustar tipos e remover `any`/casts (ex: `createUserGoalWithTree` payload types).
9) Rodar testes manuais/integração e abrir PR.

Contrato LLM (definição rígida)
-------------------------------
O LLM deve retornar estritamente um objeto JSON com esta forma (exatamente essas chaves, tipagem esperada):
{
  classification: string, // ex: 'small_talk' | 'new_intent' | 'continue' | 'cancel'
  confidence: number, // 0..1
  extracted?: {
    payload?: Record<string, any>,
    missing?: string[]
  },
  suggestedReply: string,
  finished?: boolean // true se fluxo concluído
}

Regras:
- NÃO aceitar `type` como fallback;
- NÃO aceitar `action`/`action.intent` como campo semântica principal;
- Se o LLM retornar algo fora desse formato → `ConversationAIService` lança um erro do tipo `LLMFormatError`. Cada núcleo deve capturar esse erro e transformar em um `FlowResult` de fallback: `actions: [{ type: 'reply', text: 'Desculpe — não entendi sua resposta. Pode tentar novamente?' }]`. NÃO deixar esse erro subir até o Orchestrator.

Alterações por arquivo (conteúdo esperado após mudança)
-----------------------------------------------------
Nota: abaixo há um resumo do que cada arquivo deve conter. Inclui snippets/propostas de implementação essenciais.

1) `src/modules/ia/conversation/flow.types.ts`
- Conteúdo proposto (tipos fixos):
export type FlowState = 'IDLE' | 'CLARIFICATION' | 'GOAL_CREATION';

export type Action =
  | { type: 'reply'; text: string }
  | { type: 'continue'; payload?: Record<string, any> }
  | { type: 'redirect'; to: FlowState; payload?: { payload?: Record<string, any>; missing?: string[] } }
  | { type: 'create_goal'; payload: Record<string, any> }
  | { type: 'cancel' };

export type FlowResult = { actions: Action[]; suggestedReply?: string; nucleus?: string };

Rationale: eliminar `| string` em `FlowState` e tornar `actions` obrigatório (orquestrador só processa actions). `redirect.payload` preserva todo `extracted`.

2) `src/modules/ia/conversation/conversation-orchestrator.service.ts`
- Objetivo: executor determinístico. Principais trechos:
  - Ler `session` e `user` UMA vez antes do loop.
  - Loop controlado (max 3). Em cada iteração:
    - Recarregar a sessão (`freshSession`) para obter payload atualizado.
    - Construir `iterInput` com `meta` = `freshSession.payload` + `user` + `worldId` + `serverTime`.
    - Chamar `const result = await nucleus.analyze(iterInput)`.
    - Validar: se `!Array.isArray(result.actions)` → log e retornar `{ kind:'direct', say: result.suggestedReply || '...' }` (failing fast).
    - Executar ações em ordem: `execActionsSequentially` retorna `{ reply, redirectedTo }`.
    - Se `redirectedTo` diferente, set `currentState = redirectedTo` e continuar loop.
    - Caso contrário, retornar reply final.
  - `applyAction`:
    - `continue` → merge payload na sessão
    - `redirect` → set state + payload
    - `create_goal` → chamar `userGoalService.createUserGoalWithTree` e set session IDLE
    - `cancel` → set session IDLE
    - `reply` → no-op (agregado)

Snippets importantes (pseudo):
const maxIter = 3;
let cur = state;
let finalReply = '';
for (let i=0;i<maxIter;i++){
  const fresh = await this.sessionService.getSession(userId);
  const iterInput = {...};
  const result = await flows[cur].analyze(iterInput);
  if (!Array.isArray(result.actions)) return fallback;
  const {reply, redirectedTo} = await execActionsSequentially(..., worldIdNow);
  if (reply) finalReply = reply;
  if (redirectedTo && redirectedTo !== cur) { cur = redirectedTo; continue; }
  return { kind:'direct', say: finalReply };
}
return errorTooManyRedirects;

3) `src/modules/ia/conversation-ai.service.ts`
- Simplificação: exigir que a chamada ao LLM retorne JSON válido conforme contrato; não tentar adivinhar/moldar resposta.
- API: `async analyze(input: { currentState, payload, userMessage }, systemPrompt?: string): Promise<any>` → se parse JSON falhar ou formato inválido, lançar erro custom `LLMFormatError`.
- O prompt é responsável por formatar corretamente a saída como JSON. `ConversationAIService` deve não conter heurísticas de fallback.

4) `src/modules/ia/nuclei/nucleus.interface.ts`
- Assinatura estrita:
export interface NucleusInput { userId: string; currentSession: FlowState; text: string; meta?: Record<string, any> }
export interface FlowResult { actions: Action[]; suggestedReply?: string; nucleus?: string }

5) `src/modules/ia/nuclei/clarification/index.ts` (proposta)
- Deve aceitar o LLM output (no formato fixo) e mapear para `actions[]` com regras simples:
  - if classification === 'new_intent' and intent present → return { actions:[{ type:'redirect', to: TARGET_STATE, payload: extracted }], nucleus:'clarification' }
  - else → return { actions:[{ type:'reply', text: suggestedReply }], nucleus:'clarification' }
- Não fazer heurísticas locais. Não gerar reply junto com redirect.

Exemplo (esqueleto):
async analyze(input: NucleusInput): Promise<FlowResult> {
  const llmRes = await this.llm.analyze(...);
  if (!isValidLLMFormat(llmRes)) return { actions:[{type:'reply', text: 'Desculpe...' }], nucleus:'clarification' };
  if (llmRes.classification === 'new_intent') return { actions:[{ type:'redirect', to:'GOAL_CREATION', payload: llmRes.extracted || {} }], nucleus:'clarification' };
  return { actions:[{ type:'reply', text: llmRes.suggestedReply }], nucleus:'clarification' };
}

6) `src/modules/ia/nuclei/goal-creation/index.ts` (proposta)
- Deve confiar 100% no LLM:
  - if classification === 'cancel' → actions: [{type:'cancel'},{type:'reply', text: suggestedReply}]
  - else if finished === true → actions: [{type:'create_goal', payload: extracted.payload},{type:'reply', text: suggestedReply}]
  - else → actions: [{type:'continue', payload: extracted.payload},{type:'reply', text: suggestedReply}]
- Não recalcular `missing`; não gerar confirmação heurística.
- Assinatura: `async analyze(input: NucleusInput): Promise<FlowResult>`

7) `src/modules/ia/ai.module.ts`
- Remover `IntentRouter`, `RulesService`, `ask-info` providers da lista de providers exportados pelo módulo — deixá-los desacoplados se forem necessários em outras partes não conversacionais.
- Exportar somente `ConversationOrchestratorService` e núcleos necessários.

8) `src/modules/goals/user-goal.service.ts`
- Manter como domínio (não tocar lógica conversacional aqui). Apenas garantir tipos fortes no contrato chamado pelo Orchestrator (`createUserGoalWithTree(payload: GoalPayload & {userId, worldId}): Promise<UserGoal>`).

9) Limpesa final
- Remover arquivos/núcleos não usados do fluxo conversacional (date-extraction, smalltalk, interpreter, intent processing extras) — mover para um branch separado se quiser preserved history.

Testes e rollout
-----------------
- Comandos para validação local:
  1) npm run build
  2) npm run start:dev
  3) Enviar mensagens manuais ou rodar um script de integração que simula mensagens de usuário em sequência para validar: IDLE → Clarification → redirect → GoalCreation → create_goal
- Testes a executar:
  - Criação feliz: usuário fornece todos os campos e confirma no LLM -> ver `createUserGoalWithTree` chamado e sessão resetada.
  - Missing: LLM retorna missing -> `continue` action com payload e reply; sessão atualizada.
  - Cancel: LLM retorna classification cancel -> action cancel + reply; sessão resetada.
  - Redirect: Clarification retorna new_intent -> Orchestrator faz redirect e executa GoalCreation dentro da mesma request (ver logs de loop).

Arquivo gerado
--------------
Criei este arquivo `docs/IA-MODULE-PROPOSAL.md` com o plano, trechos e recomendações. Quer que eu também:
- Aplique as mudanças automaticamente nos arquivos do repositório (patches), OU
- Gere um PR com as mudanças sugeridas para você revisar, OU
- Apenas gere arquivos `.md` com blocos de código completos para copiar/colar (per-arquivo)?

Próximo passo sugerido
----------------------
1) Confirmar se quer que eu aplique automaticamente os patches (faço em etapas pequenas e apresento diffs), OU aplicar localmente manualmente seguindo o documento.
2) Após aplicar, rodar `npm run build` e `npm run start:dev` e eu executo testes de fluxo.

Fim do plano.
