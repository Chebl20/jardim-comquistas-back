🔵 ETAPA 1 — Congelar Tipos (Base Estrutural)

🎯 Objetivo: Travar o contrato interno antes de mexer na lógica.

Arquivos:

src/modules/ia/conversation/flow.types.ts

src/modules/ia/nuclei/nucleus.interface.ts

(O terceiro arquivo não é necessário aqui — manteremos só 2)

O que fazer nessa etapa:

Remover | string de FlowState

Tornar actions obrigatório em FlowResult

Definir Action como union fechada

Garantir que NucleusInput use FlowState

Nada mais.

Não mexer em orchestrator ainda.
Não mexer em núcleos ainda.

Validação da etapa 1:

npm run build deve compilar

Nenhuma mudança comportamental

Apenas erros de tipagem podem surgir (corrigir casts mínimos)

Se isso estiver estável → próxima etapa.

🟣 ETAPA 2 — Endurecer ConversationAIService

🎯 Objetivo: Congelar contrato do LLM.

Arquivos:

src/modules/ia/conversation-ai.service.ts

(opcional se necessário) criar LLMFormatError.ts

O que fazer:

Exigir JSON válido

Validar estrutura:

classification

confidence

suggestedReply

Se inválido → lançar LLMFormatError

Remover TODO fallback:

type

action

response

regex parsing

Não mexer nos núcleos ainda.
Eles ainda estarão usando o formato antigo.

Validação da etapa 2:

Build compila

Testar uma chamada simples ao LLM

Se resposta vier errada → erro controlado

Sistema ainda funciona igual se o LLM responder certo.

Se ok → próxima etapa.

🟢 ETAPA 3 — Simplificar ClarificationNucleus

🎯 Objetivo: Tornar núcleo declarativo.

Arquivos:

src/modules/ia/nuclei/clarification/index.ts

(Apenas 1 arquivo)

O que fazer:

Remover heurísticas locais

Remover fallback de action/type

Mapear apenas:

new_intent → redirect

resto → reply

Capturar LLMFormatError e retornar fallback reply

Não mexer no GoalCreation ainda.

Validação da etapa 3:

Testar fluxo:

IDLE → mensagem comum → reply
IDLE → mensagem de meta → redirect

Se redirect ainda funciona → próximo passo.

🟡 ETAPA 4 — Simplificar GoalCreationNucleus

🎯 Objetivo: Confiar 100% no LLM.

Arquivos:

src/modules/ia/nuclei/goal-creation/index.ts

(Apenas 1 arquivo)

O que fazer:

Implementar regra pura:

classification === cancel → cancel + reply

finished === true → create_goal + reply

else → continue + reply

Remover:

small_talk check

missing recalculado

validação paralela

qualquer heurística

Capturar LLMFormatError → fallback reply.

Validação da etapa 4:

Testar:

fluxo feliz

fluxo missing

fluxo cancel

Se ainda cria meta corretamente → avançar.

🔴 ETAPA 5 — Tornar Orchestrator Determinístico

🎯 Objetivo: Centralizar side effects.

Arquivos:

src/modules/ia/conversation/conversation-orchestrator.service.ts

(Apenas 1 arquivo)

O que fazer:

Implementar loop max 3

Recarregar sessão a cada iteração

Executar actions[] sequencialmente

Só entender actions

Persistência apenas em create_goal

Redirect reexecuta no mesmo request

Validação da etapa 5:

Testar:

redirect no mesmo request

create_goal resetando sessão

cancel resetando sessão

erro de actions inválido gerando fallback

Se está estável → próximo passo.

🟠 ETAPA 6 — Limpeza de Módulo

🎯 Objetivo: Remover arquitetura paralela.

Arquivos:

src/modules/ia/ai.module.ts

src/modules/ia/intent-router.service.ts

src/modules/ia/rules.service.ts

O que fazer:

Remover IntentRouter do módulo

Remover RulesService do fluxo

Remover ASK_INFO

Garantir que só o Orchestrator coordena

Validação da etapa 6:

Build compila

Fluxo conversacional ainda funciona

Nenhuma dependência quebrada

🟤 ETAPA 7 — Tipagem Forte no Domínio

🎯 Objetivo: Fortalecer contrato de criação de meta.

Arquivos:

src/modules/goals/user-goal.service.ts

Ajustes mínimos onde chamado

O que fazer:

Definir tipo explícito para payload

Remover any

Garantir que Orchestrator passa { userId, worldId }

Validação da etapa 7:

Criação de meta funcionando

Tipos estritos compilando

⚫ ETAPA 8 — Limpeza Final

Arquivos:

Remover núcleos mortos

Remover utilitários antigos

Remover date-extraction se não usado

Remover smalltalk separado

(Em múltiplos commits pequenos)

📊 Estrutura das Etapas Resumida
Etapa	Arquivos	Risco	Impacto
1	2 arquivos	Baixo	Só tipos
2	1–2 arquivos	Baixo	LLM contrato
3	1 arquivo	Baixo	Clarification
4	1 arquivo	Médio	GoalCreation
5	1 arquivo	Médio	Orchestrator
6	3 arquivos	Médio	Limpeza estrutural
7	2 arquivos	Baixo	Tipagem
8	vários	Baixo	Remoção