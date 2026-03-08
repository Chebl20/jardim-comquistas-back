# Plano: Lembretes em Grupos por Janela de Tempo (Implementado)

**OBS**: Nunca executar `npm run start:dev` — o usuário gerencia a porta 3000 manualmente.

---

## Resumo da implementação

Metas cujos horários caem numa mesma janela (ex: 1 hora) formam um grupo. Follow-up e last chance são enviados **por grupo**, não por meta individual.

### Variáveis de ambiente

```env
REMINDER_GROUP_WINDOW_MINUTES=60   # metas dentro de 60 min = mesmo grupo
REMINDER_GROUP_FOLLOW_UP_MINUTES=5 # follow-up 5 min após último operacional do grupo
REMINDER_GROUP_LAST_CHANCE_MINUTES=15 # last chance 15 min após follow-up do grupo
```

### Arquivos criados/alterados

- `src/modules/reminder/reminder-group.util.ts` — getScheduledTimeToday, clusterGoalsIntoGroups, filterGoalsForToday
- `src/modules/reminder/reminder-group.util.spec.ts` — testes
- `src/modules/reminder/reminder.types.ts` — ReminderPolicyInput com group opcional
- `src/modules/reminder/reminder-policy.engine.ts` — evaluateGroupFollowUp, evaluateGroupLastChance
- `src/modules/reminder/reminder.service.ts` — orquestração por grupo
- `src/modules/reminder/reminder-policy.engine.spec.ts` — testes de grupo

### Exemplo: Ler 01:14, Beber água 01:15, Jogar bola 01:15

| Horário | Mensagem |
|---------|----------|
| 01:14 | Ler operacional |
| 01:15 | Jogar bola + Beber água operacional (Além disso: Ler) |
| 01:20 | Grupo follow-up (as 3 metas) |
| 01:35 | Grupo last chance (as 3 metas) |

**Total: 4 mensagens** (antes 6)
