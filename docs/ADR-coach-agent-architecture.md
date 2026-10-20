# ADR: Coach agent (núcleos + executor)

## Contexto

O chatbot do Jardim prioriza **execução verificável** no domínio (metas, lembretes, progresso) em vez de automação aberta em sites externos.

## Decisão

- **LLM propõe, executor autoriza**: núcleos retornam `Action[]` tipadas; `ConversationActionExecutorService` persiste efeitos.
- **Memória**: PostgreSQL (`Goal`, `ConversationSession`, `ConversationTurn`, `UserCoachProfile`) é fonte de verdade; resumo rolante no perfil do coach.
- **Continuidade**: `CoachTask` + cron de digest; retomada no orquestrador antes do router genérico.
- **Filas**: `@nestjs/schedule` + `DistributedLockService` (Redis opcional); BullMQ só se volume exigir.

## Consequências

- Paridade WhatsApp/Telegram/App via mesmo orquestrador e `MessagingService`.
- Auditoria e LGPD via `ConversationTurn` com retenção configurável.
- Confirmação explícita de meta quando `confidence < GOAL_CREATE_MIN_CONFIDENCE`.
