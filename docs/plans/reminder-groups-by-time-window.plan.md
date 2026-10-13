# Lembretes em grupos — o que o código faz

Documento alinhado ao código (não à proposta antiga de agrupar operacionais por janela de 60 min na policy).

## Operacional

- Cada meta é avaliada sozinha (`SEND_OPERATIONAL` + `slotKey` datado).
- No mesmo tick, se `toSend.length >= 2`, o service manda **um** batch (`composeBatch` + um `delivery.send`).
- A env `REMINDER_GROUP_WINDOW_MINUTES` só entra em `clusterGoalsIntoGroups` no service (follow-up/last-chance de grupo), **não** na policy de operacional.

## Follow-up e last-chance

- Só no dia civil da última operacional (`lastOperationalOnCivilDate`).
- Só se não houver outro slot due hoje (`nextDueSlot` tem prioridade).
- Grupo: espera `REMINDER_GROUP_FOLLOW_UP_MINUTES` / `REMINDER_GROUP_LAST_CHANCE_MINUTES` após o último operacional do grupo; fan-out **sem** `slotKey` (não grava horário fantasma em `slotsToday`).

## Fora deste doc

Agrupar operacionais por janela de tempo como produto novo fica para depois do core verde. Ver `docs/superpowers/specs/2026-09-04-reminder-occurrence-contract.md`.
