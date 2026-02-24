Documentação detalhada do módulo `src/modules/ia`

Este documento descreve, arquivo a arquivo, o conteúdo e o comportamento do diretório `src/modules/ia`. O objetivo é fornecer referência completa para desenvolvedores — conteúdo, papéis, e pontos importantes do código (contratos, efeitos colaterais, D.I., e interações com sessão/DB/LLM).

Observação: as explicações abaixo referenciam a implementação atual no workspace (feita durante as últimas mudanças). Onde for útil, indico linhas ou trechos comportamentais e a justificativa arquitetural.

----------------------------------------------------------------
Sumário dos arquivos cobertos
- ai.module.ts
- conversation-ai.service.ts
- intent-router.service.ts
- rules.service.ts
- messages.ts
- ask-info.util.ts
- conversation/
  - conversation-orchestrator.service.ts
  - flow.types.ts
- nuclei/
  - nucleus.interface.ts
  - base.nucleus.ts
  - index.ts
  - clarification/
    - index.ts
    - prompt.ts
  - goal-creation/
    - index.ts
    - prompt.ts

----------------------------------------------------------------
**1) `ai.module.ts`**
- Propósito: registrar providers relacionados à camada de IA do sistema (nuclei, orchestrator, serviços LLM, intent-router, rules).
- Pontos importantes:
  - Exporta `ConversationOrchestratorService` e `IntentRouter` para outros módulos que precisem roteamento de intenções ou execução de fluxos.
  - Deve declarar todos os núcleos (`ClarificationNucleus`, `GoalCreationNucleus`) e serviços usados por eles (ex: `ConversationAIService`, `RulesService`, `IntentRouter`).
  - Contribuição para DI: mudanças de nomes/providers afetam injection em `Telegram` e outros módulos.

----------------------------------------------------------------
**2) `conversation-ai.service.ts`**
- Propósito: wrapper/cliente para a chamada ao LLM (OpenAI ou outro). Fornece `analyze(payload, prompt)` usado pelos núcleos.
- API esperada pelo resto do módulo:
  - `analyze({ currentState, payload, userMessage }, systemPrompt?)` → retorna um objeto livre do LLM, contendo campos como `classification`, `action`, `extracted`, `suggestedReply`, `finished`, `confidence`.
- Observações:
  - É ponto central: núcleos confiam nele para padronizar prompts e retorno.
  - Não altera sessão; é função puramente transacional.

----------------------------------------------------------------
**3) `intent-router.service.ts`**
- Propósito: lógica para mapear intents/ações de alto nível e possivelmente roteá-las para handlers externos. No estado atual, pode ser usado por outros módulos para registrar handlers.
- Pontos:
  - Deve permanecer simples; arquiteturalmente o Orchestrator executa actions — o IntentRouter pode ajudar a decouplar mapeamentos.

----------------------------------------------------------------
**4) `rules.service.ts`**
- Propósito: conjunto de regras/validações reutilizáveis (p.ex. validações simples de payload). Usado pelos núcleos apenas para validações locais quando necessário, mas arquitetura atual elimina heurísticas locais, então seu uso deve ser reduzido.

----------------------------------------------------------------
**5) `messages.ts`**
- Propósito: constantes de mensagens, templates e textos padrão usados por núcleos e orquestrador.

----------------------------------------------------------------
**6) `ask-info.util.ts`**
- Utilitário: helpers para perguntar informações ao usuário ou montar tokens de tempo, normalização de horários, etc. Após as mudanças arquiteturais, preferir que o LLM sugira as mensagens; utilitários devem ser apenas helpers técnicos.

----------------------------------------------------------------
Pasta `conversation`

**7) `flow.types.ts`**
- Tipos centrais do fluxo.
- Conteúdo e significado atual:
  - `export type FlowState = 'IDLE' | 'GOAL_CREATION' | 'CLARIFICATION' | string;` — estados da máquina. O `| string` permite estados customizados/experimentais.
  - `export type Action =
      | { type: 'reply'; text: string }
      | { type: 'continue'; payload?: Record<string, any> }
      | { type: 'redirect'; to: FlowState; payload?: Record<string, any> }
      | { type: 'create_goal'; payload: Record<string, any> }
      | { type: 'cancel' };
    `
    - `reply`: mensagem a ser enviada ao usuário (o último `reply` vence, agregador do orquestrador pega o texto).
    - `continue`: merge do `payload` com `session.payload` (não persiste, mantém estado atual).
    - `redirect`: muda o estado da sessão para `to` e opcionalmente carrega `payload` (a implementação do orchestrator agora re-executa o novo núcleo na mesma chamada).
    - `create_goal`: ação de persistência; orquestrador chama `userGoalService.createUserGoalWithTree` com payload + `userId` + `worldId`.
    - `cancel`: finaliza/reseta sessão para `IDLE`.
  - `export type FlowResult = { actions?: Action[]; suggestedReply?: string; [k: string]: any }` — resultado canônico que o orquestrador consome. Arquitetura atual exige `actions[]` sempre que possível.

Observações arquiteturais:
- O Orchestrator foi alterado para aceitar apenas `actions[]` como contrato primário; `suggestedReply` é fallback
- Sempre prefira que núcleos retornem `actions[]`; evitar retornos soltos com `confidence`/`finished` fora do formato.

----------------------------------------------------------------
**8) `conversation-orchestrator.service.ts`**
- Propósito: executor determinístico do sistema. Responsável por:
  - Instanciar o núcleo apropriado conforme `session.state`.
  - Recarregar `session.payload` antes de cada iteração do loop (garantir que `continue` e `redirect` sejam imediatamente visíveis ao próximo núcleo).
  - Executar actions ordenadamente (via `execActionsSequentially` → `applyAction`).
  - Tratar `redirect` executando o novo núcleo na mesma chamada (loop controlado, max 3 iterações).
  - Persistir apenas quando houver `create_goal` action.
  - Nunca interpretar texto do usuário — decisão é feita por actions declarativas.

- Comportamento por trechos (linha por linha, pontos críticos):
  - Leitura inicial de `session` e do `user` (user é buscado uma vez antes do loop). `worldId` é calculado a partir do `user.currentWorldId` e passado imutavelmente durante a requisição.
  - Loop controlado: antes de cada iteração recarrega `session` (`freshPayload`) e constrói `iterInput` com `meta` vindo da sessão atualizada. Isso garante que um `continue` na iteração N seja lido por iteração N+1.
  - Chamada do núcleo: `const result: FlowResult = await nucleus.analyze(iterInput)` — o núcleo deve retornar `actions[]`.
  - Se `actions` ausentes: fallback determinístico que retorna `suggestedReply` sem alterar sessão.
  - `execActionsSequentially` retorna `{ reply, redirectedTo }` — o orquestrador usa `redirectedTo` para decidir se deve re-executar outro núcleo.
  - `applyAction` efeitos:
    - `continue`: merge no `session.payload` sem alterar `state`.
    - `redirect`: grava novo `state` e `payload` na sessão.
    - `create_goal`: chama `userGoalService.createUserGoalWithTree(...)` e reseta sessão para `IDLE`.
    - `cancel`: reseta sessão para `IDLE`.
    - `reply`: sem efeito direto — apenas contribui para o `reply` final.

- Observações de robustez:
  - Loop limitado (máx 3) para evitar loops infinitos.
  - Orquestrador agora é determinístico: só executa ações explícitas; não faz heurísticas textuais.

----------------------------------------------------------------
Pasta `nuclei`

**9) `nucleus.interface.ts`**
- Define `NucleusInput` e o contrato de retorno. Padrão atual esperado:
  - `NucleusInput`: { userId: string; currentSession: FlowState; text: string; meta?: Record<string, any> }
  - `analyze(input: NucleusInput): Promise<FlowResult>` — todos os núcleos devem respeitar essa assinatura.
- Importante: removeram-se retornos `any` para garantir determinismo.

**10) `base.nucleus.ts`**
- Classe/abstração base (se houver) com utilitários comuns a todos os núcleos (helpers para construir prompts, acessar LLM). Deve ser pequena e não conter lógica de fluxo.

**11) `index.ts` (barrel)**
- Exporta apenas os núcleos ativos: `clarification` e `goal-creation`.
- Mantém o módulo limpo para evitar carregar núcleos removidos.

----------------------------------------------------------------
Núcleo `clarification`

**12) `clarification/prompt.ts`**
- Contém o prompt do LLM que instruirá o modelo a classificar a entrada: `classification` (ex: `small_talk`, `new_intent`, `invalid_input`), extrair `extracted` (payload + missing) e sugerir `suggestedReply`.
- Importante: prompt deve instruir o modelo a nunca responder direto quando `classification === 'new_intent'`, apenas preencher `intent` e `extracted`.

**13) `clarification/index.ts`** (explicação detalhada)
- Assinatura: `async analyze(input: NucleusInput): Promise<FlowResult>`.
- Fluxo:
  1. Prepara `systemPromptWithContext` incorporando `CLARIFICATION_PROMPT` e `input.currentSession` + `meta` (session payload).
  2. Chama `this.llm.analyze({ currentState, payload, userMessage }, prompt)`.
  3. Normaliza o retorno do LLM para um `safeResult` com: `confidence`, `suggestedReply`, `classification`, `intent`, `extracted`.
  4. Regras:
     - Se `classification === 'new_intent'` e `intent` ausente → retorna ações seguras com `reply` explicando falha (não faz guessing).
     - Se `classification === 'new_intent'` e `intent` presente → EMITE SOMENTE `redirect` para `intent` (p.ex. `GOAL_CREATION`) com `payload: safeResult.extracted || {}` (preserva `missing`). NÃO adiciona `reply`.
     - Caso contrário (`classification` não-new_intent), emite `reply` com `suggestedReply`.
  5. Em erros do LLM: retorna `actions: [{ type: 'reply', text: Fallback }]`.
- Observações linha-a-linha:
  - Uso de `classification` como campo canônico; se modelo retornar `type`, o núcleo registra erro (não faz fallback silencioso) — força o prompt a ser consistente.
  - `safeResult.extracted` é propagado inteiro no `redirect` para preservar estrutura `{ payload, missing }`.

----------------------------------------------------------------
Núcleo `goal-creation`

**14) `goal-creation/prompt.ts`**
- Prompt especifica contrato esperado: sempre retornar JSON com `action: "CREATE_GOAL"` (quando apropriado), `extracted: { payload, missing }`, `confidence`, `suggestedReply`, `finished`.
- Importante: o prompt instrui o modelo a ser o único responsável por decidir `finished`.

**15) `goal-creation/index.ts`** (explicação detalhada)
- Assinatura: `async analyze(input: NucleusInput): Promise<FlowResult>` (contrato estrito).
- Fluxo:
  1. Monta `payloadForLLM` a partir de `input.meta` (inclui `recentMessages`).
  2. Chama `this.llm.analyze({ currentState, payload, userMessage }, systemPromptWithContext)`.
  3. Normaliza a saída do LLM para `modelOut` com o contrato fixo:
     - `classification?: string`
     - `action?: string`
     - `finished?: boolean`
     - `extracted?: { payload, missing }`
     - `suggestedReply?: string`
     - `confidence: number`
     Observações: não fallback para `type` — se `type` aparecer, o núcleo loga aviso e ignora `type`.
  4. Regras de mapping:
     - `classification === 'small_talk'` → `actions: [{ type: 'reply', text: suggestedReply }]`.
     - `classification === 'new_intent' && action !== 'CREATE_GOAL'` → `actions: [{ type: 'redirect', to: 'CLARIFICATION', payload: extracted || {} }]`.
     - `action === 'CANCEL' || classification === 'cancel'` → `actions: [{ type: 'cancel' }, { type: 'reply', text: suggestedReply }]`.
     - Se `finished === true` → `actions: [{ type: 'create_goal', payload: extracted.payload }, { type: 'reply', text: suggestedReply }]`.
     - Caso contrário → `actions: [{ type: 'continue', payload: extracted.payload }, { type: 'reply', text: suggestedReply }]`.
  5. Em erro no LLM → retorne `actions` com `reply` (fallback), nunca objeto solto.
- Observações importantes:
  - O núcleo NÃO calcula `missing` localmente; confia no `extracted` do LLM.
  - O núcleo NÃO monta a frase de confirmação (ex.: "Você quer criar a meta X às Y?") — usa `suggestedReply` do LLM.
  - Contrato determinístico: sempre retorna `actions[]` em casos operacionais.

----------------------------------------------------------------
Pontos arquiteturais e recomendações finais
- Contrato único: todos os núcleos devem retornar `FlowResult` com `actions[]` quando aplicável.
- O Orchestrator é o único executor de efeitos colaterais (persistência, atualização de sessão).
- Não ter heurísticas locais: toda decisão semântica (quando persistir, quando terminar o fluxo) vem do LLM via `finished` e `action`.
- Redirecionamento in-call: Orchestrator reexecuta o núcleo destino imediatamente após um `redirect` (loop controlado), garantindo comportamento transacional no request atual.
- Tipagem: preferir tipar `payload` e `extracted` com interfaces concretas (ex.: `GoalPayload`) e remover `any`/casts remanescentes.

Como usar este documento
- Para cada dúvida sobre comportamento de runtime, consulte primeiro `conversation-orchestrator.service.ts` (executor) e em seguida o núcleo que originou a ação (campo `origin` nas respostas ajuda nisso).
- Para modificar prompts, edite `nuclei/*/prompt.ts` e ajuste testes de integração.

----------------------------------------------------------------
Status desta documentação
- Gerado automaticamente com base no estado atual do workspace `src/modules/ia`.
- Se você quiser que eu gere uma versão ainda mais precisa com trechos de código comentados linha-a-linha (inserindo comentários próximos ao código original), posso gerar arquivos markdown por arquivo com blocos de código + anotações.

Quer que eu:
- a) rode `npm run start:dev` e execute testes de mensagens reais (simulação), ou
- b) gere arquivos `docs/ia/*.md` com blocos de código anotados linha-a-linha?

Fim do documento.
