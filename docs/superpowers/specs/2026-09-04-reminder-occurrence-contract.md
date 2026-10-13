# Contrato de ocorrência — metas e lembretes

Uma ocorrência é o par `(civilDate no timezone do usuário, HH:MM)`.
A chave canônica é `occKey` = `YYYY-MM-DDTHH:MM` (`makeOccKey`).

## Fonte da verdade

- **Já enviei este slot neste dia civil:** `GoalReminder.slotsToday` datado (`occKey` e/ou `{ date, time }`). Leituras passam por `claimedTimesForCivilDate` (dual-read: legado `{ time }` só conta se `lastSentAt` for o mesmo dia civil).
- **Ciclo aberto / resposta:** `dailyStatus`.
- **Cooldown:** `silenceUntil` apenas. Não substitui ocorrência.
- **Reset à meia-noite:** limpa `silenceUntil` expirado. Não é fonte da verdade. Não apaga `slotsToday` datado. A policy ignora slots de outra data.

O cron da meia-noite roda no relógio do processo (UTC em produção). Isso é aceitável porque a identidade do slot é datada.

## dailyStatus

Valores do **core**:

| Valor | Significado |
| --- | --- |
| `null` | Sem ciclo aberto hoje |
| `WAITING_OPERATIONAL_REPLY` | Operacional enviado; aguarda resposta |
| `WAITING_FOLLOW_UP_REPLY` | Follow-up enviado; aguarda resposta |
| `DONE` | Usuário concluiu (slot); outros slots do mesmo dia ainda podem disparar |
| `SKIPPED` | “Não hoje”; silêncio até fim do dia civil |
| `SNOOZED` | “Depois”; silêncio até `silenceUntil` |
| `DISMISSED` | Parar por vários dias (`silenceUntil`) |
| `MISSED` | Last-chance sem resposta |

Status legado `WAITING_REACTIVATION_REPLY` / `REACTIVATION_COOLDOWN` (se ainda existirem no banco) **não** abrem ciclo na policy: caem no fluxo operacional. Sem send de reativação no cron (Fase 4 cortada).

Não usar: `PENDING`, `SENT`.

## Envio operacional

Enviar a primeira ocorrência de **hoje** com `now >= occ.at` que ainda não está em `claimedTimesForCivilDate` daquele `civilDate`.

- Catch-up: cron atrasado no mesmo dia civil ainda envia uma vez.
- Não envia ocorrência de ontem.
- Sem janela máxima (`REMINDER_MAX_DELAY_SEC` não existe).

## Multi-slot

`08:00` e `18:00` no mesmo dia são independentes. `WAITING_*` ou `DONE` de um slot não bloqueia outro due.

## Claim

1. Policy decide.
2. `claimBatch` em transação (lock otimista: `lastSentAt` + `dailyStatus`, incluindo `null`).
3. Enviar.
4. Se a entrega falhar, `rollback` de todos os itens do batch.

Follow-up / last-chance de grupo **não** levam `slotKey` e **não** gravam horário em `slotsToday` (evita slot fantasma que bloqueie o próximo operacional).

## Respostas (ReminderNucleus)

- Feito → `DONE` + growth event; pontual marca `completed`.
- Depois → `SNOOZED` + `silenceUntil`.
- Não hoje → `SKIPPED` + silêncio até fim do dia civil no TZ do usuário.

## Criação

Goal + GoalSchedule + GoalReminder na mesma transação (`createUserGoalWithTree`). Confirmação no chat usa o TZ do usuário (não `America/Sao_Paulo` fixo).

## Tick concorrente

Dois crons sobrepostos são possíveis. O claim evita duplicata de envio. Lock SETNX/BullMQ fica fora deste contrato (opcional, não aceite do core).

## GoalOccurrenceException

Somente leitura (`isCancelled`). Skip-hoje não escreve exception; usa `SKIPPED` + `silenceUntil`.

## Agrupamento (código atual)

- Follow-up / last-chance podem agrupar metas próximas.
- Operacionais no mesmo tick vão em batch se `toSend.length >= 2`, não pela janela de 60 min da policy.
