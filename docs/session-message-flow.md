# Fluxo de Mensagens, Interpretação de IA e Respostas (Documento Completo)

Última atualização: 19 de fevereiro de 2026

Este documento descreve, em detalhe, todos os caminhos possíveis desde o recebimento de uma mensagem via Telegram até a interpretação pela IA e a resposta final ao usuário. Inclui decisões da camada de sessão, classificadores leves, máquina de estados de criação de metas, fallbacks e limites. Destina-se a ser uma especificação operacional completa para desenvolvedores e QA.

Arquivos principais relacionados:

- [src/modules/telegram/telegram.service.ts](src/modules/telegram/telegram.service.ts)
- [src/modules/ia/openIa/ai.service.ts](src/modules/ia/openIa/ai.service.ts)
- [src/modules/shared/conversation-session.service.ts](src/modules/shared/conversation-session.service.ts)
- [src/modules/shared/rate-limiter.service.ts](src/modules/shared/rate-limiter.service.ts)
- [src/modules/ia/intent-router.service.ts](src/modules/ia/intent-router.service.ts)
- [src/modules/reminder/reminder.service.ts](src/modules/reminder/reminder.service.ts)

Sumário (alto nível):

- Recepção da mensagem
- Validações e rate limiter
- Verificação de sessão persistida (ConversationSession)
- Pré-classificador de sessão (IA leve): CONTINUE / CANCEL / NEW_INTENT
- Máquina de estados da sessão: ASK_TITLE, ASK_TIME, ASK_CONQUEST, CONFIRM
- Classificador dentro do estado (RETRY / CANCEL / NEW_INTENT)
- ASK_INFO flows iniciados pela IA quando NÃO há sessão
- Encaminhamento de ações para `IntentRouter`
- Fallbacks e limites (outOfContextCount, timeouts, validação Ajv, retry de chamadas OpenAI)
- O que a IA faz vs o que a máquina controla

---

1) Recepção da mensagem

- Origem: Telegram via [node-telegram-bot-api] (handler em [src/modules/telegram/telegram.service.ts](src/modules/telegram/telegram.service.ts)).
- Primeiro passo:
  - Verifica se `msg.text` é string; se não, responde pedindo texto.
  - Mapeia `chatId` → `user` via [UserLinkService] (se não houver vínculo, tenta tratar códigos de vinculação ou pede ao usuário o código).

2) Rate limiter

- Serviço: [src/modules/shared/rate-limiter.service.ts](src/modules/shared/rate-limiter.service.ts).
- Comportamento atual:
  - Calcula `limit = Number(process.env.RATE_LIMIT_MESSAGES_PER_MINUTE || 5)` e janela de 60s.
  - Tenta usar Redis (`rate:tg:<userId>:<window>`) e incrementa contador; caso não tenha Redis, usa fallback in-memory.
  - Importante: a lógica foi alterada para NÃO bloquear o usuário. Se exceder, apenas registra no log e continua o processamento.

3) Contexto e metas atuais

- O `TelegramService` lê metas ativas do usuário (`prisma.userGoal.findMany`) e monta um `goalsContext` (resumo) que é passado ao interpretador da IA como contexto auxiliar.

4) Verificação de sessão persistida (ConversationSession)

- Serviço: [src/modules/shared/conversation-session.service.ts](src/modules/shared/conversation-session.service.ts).
- Cada sessão é única por `userId` (upsert) e contém: `state`, `payload` (JSON), `expiresAt`, timestamps.
- Estados utilizados: `ASK_TITLE`, `ASK_TIME`, `ASK_CONQUEST`, `CONFIRM`.
- Quando existe uma sessão ativa, o servidor aplica um **pré-filtro** antes de executar a lógica da máquina de estados.

5) Pré-classificador de sessão (AI leve)

- Implementado no `AiService` como `classifySessionMessage(message, chatId, { state, payload })`.
- Objetivo: classificar a intenção do usuário quando existe uma sessão ativa, retornando apenas uma das três opções:
  - `CONTINUE` — a mensagem parece continuar o preenchimento pedido pela sessão;
  - `CANCEL` — o usuário claramente quer cancelar a sessão/criação;
  - `NEW_INTENT` — o usuário parece iniciar uma nova intenção independente da sessão.
- Fluxo quando há sessão:
  1. Se `classifySessionMessage` → `CANCEL`: encerra sessão imediatamente e responde "Criação cancelada.".
  2. Se → `NEW_INTENT`: incrementa `payload.outOfContextCount`, salva; se >= 3 a sessão é encerrada com mensagem de reinício: "Parece que mudamos de assunto 😅 Vamos começar de novo. O que você quer fazer?"; caso contrário encerra sessão e reprocessa a mensagem como nova intenção chamando `ai.interpret(...)` e encaminhando eventual `action` ao `IntentRouter`.
  3. Se → `CONTINUE`: reseta `payload.outOfContextCount = 0` e permite que a máquina de estado processe a mensagem.

6) Máquina de estados (quando `CONTINUE` ou não havia sessão)

- Estados e comportamento (implementado em [src/modules/telegram/telegram.service.ts](src/modules/telegram/telegram.service.ts)):

- `ASK_TITLE`:
  - Aceita qualquer texto como título: grava em `payload.title`.
  - Se `payload` já tem `reminderTime`/`time` e `conquestType` → vai para `CONFIRM` e pergunta por confirmação.
  - Se falta `time` → vai para `ASK_TIME` e pergunta horário.
  - Se falta `conquestType` → vai para `ASK_CONQUEST`.

- `ASK_TIME`:
  - Validação determinística: tenta casar regex `HH:MM`.
  - Se parse ok → salva `payload.reminderTime`, zera `outOfContextCount` e vai para `ASK_CONQUEST`.
  - Se parse falha → chama `AiService.classifyStateResponse(message, 'ASK_TIME', ...)`, que pode retornar:
    - `RETRY` (default caso AI falhe ou ache que é tentativa mal formatada): pergunta novamente o formato "Não entendi o horário. Envie no formato HH:MM..." e reseta `outOfContextCount`.
    - `CANCEL`: encerra sessão e responde "Criação cancelada.".
    - `NEW_INTENT`: trata como nova intenção (incrementa `outOfContextCount`; se >=3 fecha sessão com mensagem de reinício; senão encerra sessão e reprocessa via `ai.interpret`).

- `ASK_CONQUEST`:
  - Tenta casar resposta com opções `CONQUEST_TYPES` (comparação direta ou por índice numérico). Se ok → grava `payload.conquestType` e vai para `CONFIRM`.
  - Se falha → chama `classifyStateResponse(..., 'ASK_CONQUEST', ...)` e segue lógica análoga a `ASK_TIME` (RETRY/CANCEL/NEW_INTENT).

- `CONFIRM`:
  - Se resposta afirmativa (`sim`, `s`, `yes`, `1`) → monta `action: CREATE_GOAL` com `payload` e encaminha para `IntentRouter`, apaga sessão e envia confirmação ao usuário.
  - Se resposta negativa (`cancelar`, `n`, `no`) → apaga sessão e confirma cancelamento.
  - Caso ambíguo → chama `classifyStateResponse(..., 'CONFIRM', ...)` e trata `CANCEL/NEW_INTENT` conforme descrito; se `RETRY` manda o prompt de confirmação genérico.

7) AI-initiated ASK_INFO (quando NÃO há sessão)

- Fluxo padrão inicial (sem sessão): o `AiService.interpret(message...)` pode retornar:
  - `{ say: string }` — mensagem a ser enviada ao usuário (texto livre)
  - `{ action: { intent: 'ASK_INFO', data: { missing: 'title'|'time'|'conquestType', question?, options? } } }` — solicita campo faltante
  - `{ action: { intent: 'CREATE_GOAL', data: {...} } }` — ação pronta para criar meta

- Quando `interpret` retorna `ASK_INFO`:
  - Se `action.data` já contém o campo faltante (`missing`) preenchido, o servidor converte para `CREATE_GOAL` e encaminha ao `IntentRouter`.
  - Caso contrário o servidor cria uma `ConversationSession` com estado apropriado (ex.: `ASK_TIME` se `missing` conter 'time') e mensagem ao usuário com a pergunta e opções.

8) Encaminhamento de ações e `IntentRouter`

- Qualquer `action` resultante (seja por sessão confirmada ou por `interpret`) é entregue ao `IntentRouter` via `intentRouter.route({ ...action, reply: (m)=>sendReply(chatId,m,'intent-router') })`.
- `IntentRouter` é a peça que contém as regras de negócio para intents (`CREATE_GOAL`, `MARK_DONE`, etc.). A IA NUNCA decide estados da sessão — ela só fornece intents/ações ou classificações.

9) Validações, schemas Ajv e reparos

- O `AiService` carrega schemas Ajv para intents (ex.: `intent:CREATE_GOAL`, `intent:ASK_INFO`, `intent:MARK_DONE`). Quando a IA retorna JSON, o serviço tenta validá-lo e, se falhar, tenta reparos simples (e.g., gerar `question` para ASK_INFO a partir do `missing`).
- Se a validação falhar irrecuperavelmente, o interpretador responde com um `say` pedindo reformulação.

10) Fallbacks e robustez

- Chamada `openAIChatCreate(...)` possui retries e timeout (configuráveis via env var). Erros transitórios (timeout/429) são retentados com backoff.
- Logs de auditoria são gravados (função `logAiAudit`) com prompt e resposta bruta e também com parsed quando aplicável.
- `ConversationSession` tem TTL (config `CONVERSATION_SESSION_TTL_MIN`) e `cleanupExpired()` para remoção periódica.
- `outOfContextCount` (armazenado no `payload`) protege contra loops: quando atinge 3, encerra sessão automaticamente e pergunta ao usuário para reiniciar.

11) Reminders (comportamento relevante)

- Lógica de envio de lembretes foi feita determinística e atômica (ver [src/modules/reminder/reminder.service.ts](src/modules/reminder/reminder.service.ts)). O sistema marca a meta como enviada com `updateMany` atômico antes de tentar enviar via Telegram, evitando duplicações.

12) O que a IA consegue fazer (capabilidades)

- Classificar intenções iniciais e gerar ações estruturadas: criar metas pontuais, gerar ASK_INFO quando faltam campos.
- Gerar mensagens livres (`say`) para responder ao usuário.
- Classificar mensagens dentro de sessão (`classifySessionMessage`) como `CONTINUE|CANCEL|NEW_INTENT`.
- Classificar respostas inválidas dentro de um estado (`classifyStateResponse`) como `RETRY|CANCEL|NEW_INTENT`.
- Gerar texto de lembrete motivacional curto.

13) O que a IA NÃO deve fazer (limites e garantias)

- A IA NÃO decide transições internas da máquina de estados (por projeto). Ela apenas CLASSIFICA.
- A IA não deve, por si só, executar `CREATE_GOAL` sem validação/consentimento da máquina; mesmo quando retorna dados completos, o servidor valida e enriquece o action antes de encaminhar.
- As classificações da IA são heurísticas — podem errar. Por isso, a aplicação contém proteções (p.ex. `outOfContextCount`, confirmações manuais, validação Ajv).
- A IA pode falhar (timeout, resposta malformada, custo). O sistema aplica retries, mensagens de fallback e respostas amigáveis quando a IA não consegue parsear o JSON.

14) Caminhos possíveis (exemplos concretos)

- Caso A — Usuário envia: "me lembra de estudar daqui a 5 min"
  - `AiService.trySimpleRules` captura padrão e retorna `CREATE_GOAL` pronto ou `ASK_INFO` pedindo título.
  - Se `CREATE_GOAL` retornado e validado → `IntentRouter` cria meta e o bot confirma.

- Caso B — Usuário inicia fluxo guiado (IA retorna `ASK_INFO`→session)
  1. IA: `ASK_INFO missing: title` → servidor cria `ConversationSession` `ASK_TITLE` e pergunta "Sobre o que você quer ser lembrado?".
  2. Usuário responde "correr" → pré-classificador `classifySessionMessage` → provavelmente `CONTINUE` → máquina aceita como `title` e pede horário (`ASK_TIME`).
  3. Usuário responde "depois" (ambíguo) → `ASK_TIME` regex falha → chama `classifyStateResponse('depois')` → IA pode responder `NEW_INTENT` ou `RETRY`. Se `RETRY`, o sistema pede o formato novamente; se `NEW_INTENT`, encerra sessão e reprocessa.

- Caso C — Usuário muda de ideia durante sessão
  - Enquanto estiver em `ASK_TIME`, usuário escreve "na verdade quero criar uma tarefa diferente" → `classifySessionMessage` retorna `NEW_INTENT` → sessão é encerrada e a nova intenção é interpretada e processada.

- Caso D — Usuário insiste em respostas fora de contexto 3x
  - `outOfContextCount` chega a 3 → sessão é encerrada automaticamente e o bot envia "Parece que mudamos de assunto... Vamos começar de novo.".

15) Erros comuns e soluções

- IA responde JSON inválido: `AiService` tenta extrair JSON embutido, validar via Ajv, e em último caso responde `say` pedindo reformulação.
- Migrações de banco: o `ConversationSession` é persistido em Postgres (ver `prisma/schema.prisma` e migrations) — se a tabela faltar, a criação de sessão falhará e será necessário aplicar migrations.
- Rate limiter sem Redis: reiniciar servidor limpa o contador in-memory; script `scripts/reset-rate-limit.js` remove chaves Redis.

16) Observabilidade e métricas recomendadas

- Contadores sugeridos (por usuário e global):
  - `messages_received`
  - `session_created`
  - `session_deleted` (com razão: confirm/cancel/expired/outOfContext)
  - `ai_classify_continuations`, `ai_classify_new_intent`, `ai_classify_cancel`
  - `ai_classify_state_retry`, `ai_classify_state_new_intent`, `ai_classify_state_cancel`
  - `reminder_sent_success`, `reminder_send_failures`

17) Recomendações de melhora

- Ajustar prompts dos classificadores para serem mais conservadores (reduzir falsos positivos de NEW_INTENT).
- Adicionar um modo “safe” para `classifyStateResponse` que em caso de dúvida prefere `RETRY` em vez de encerrar sessão.
- Registrar amostras de interações classificadas como `NEW_INTENT` para treinar/ajustar heurística/prompt.
- Expor endpoint administrativo para inspecionar e resetar `outOfContextCount` por sessão em caso de false positives.

---

Se quiser, eu posso:

- Gerar um diagrama de estados (SVG) com todos os caminhos.
- Produzir exemplos JSON com perguntas e respostas da IA para cada cenário.
- Adicionar métricas/telemetria mínimas dentro do código.

Arquivo: [docs/session-message-flow.md](docs/session-message-flow.md)

*** FIM ***
