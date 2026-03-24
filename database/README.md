# Sistema de Metas - Schema Completo

## 📋 Visão Geral

Este schema suporta os 5 cenários críticos de uso:

1. ✅ Consultas por granularidade de metas (diária, semanal, mensal)
2. ✅ Alteração de recorrência de metas (todas as ocorrências futuras)
3. ✅ Alteração de horários em dia específico (override pontual)
4. ✅ Transferência de metas entre dias (pontual e permanente)
5. ✅ Suporte completo para metas pontuais e contínuas

## 🗂️ Estrutura das Tabelas

### Tabelas Principais

| Tabela | Propósito | Chave Primária |
|--------|-----------|----------------|
| `goal_definition` | Catálogo de definições de metas (SKU) | `id` |
| `goal_schedule` | Programação de horários por definição | `id` |
| `user_goal` | Instância de meta por usuário | `id` |
| `user_goal_instance` | Materialização de ocorrências por período | `id` |
| `user_goal_instance_log` | Histórico de ações por instância | `id` |

### Campos de Override em `user_goal_instance`

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `override_times` | `TIME[]` | Override de horários para esta instância específica |
| `override_days_of_week` | `SMALLINT[]` | Override de dias da semana |
| `override_period_start` | `DATE` | Override da data (para transferências) |
| `is_overridden` | `BOOLEAN` | Flag indicando se há override aplicado |

## 🚀 Queries de Exemplo

### 1. Buscar metas do dia

```sql
SELECT 
    instance_id,
    user_goal_id,
    effective_date,
    title,
    description,
    goal_type,
    conquest_type,
    status,
    effective_times,
    primary_time,
    planted_tree_id,
    actual_stage,
    family,
    tree_type
FROM v_user_goals_daily
WHERE user_id = $1
  AND effective_date = CURRENT_DATE
ORDER BY primary_time NULLS LAST;
```

### 2. Buscar metas da semana

```sql
SELECT 
    instance_id,
    user_goal_id,
    effective_date,
    title,
    status,
    effective_times
FROM v_user_goals_daily
WHERE user_id = $1
  AND effective_date >= date_trunc('week', CURRENT_DATE)
  AND effective_date < date_trunc('week', CURRENT_DATE) + INTERVAL '1 week'
ORDER BY effective_date, effective_times;
```

### 3. Alterar horário apenas no dia 19 (override pontual)

```sql
-- Usando função auxiliar
SELECT override_goal_instance_times(
    '550e8400-e29b-41d4-a716-446655440000'::uuid,
    ARRAY['10:00'::time, '14:00'::time]
);

-- Ou diretamente
UPDATE user_goal_instance
SET override_times = ARRAY['10:00'::time, '14:00'::time],
    is_overridden = TRUE,
    updated_at = now()
WHERE id = '550e8400-e29b-41d4-a716-446655440000'::uuid;
```

### 4. Transferir meta do dia 19 para 20 (pontual)

```sql
-- Usando função auxiliar
SELECT transfer_goal_instance(
    '550e8400-e29b-41d4-a716-446655440000'::uuid,
    '2026-03-20'::date
);

-- Ou diretamente
UPDATE user_goal_instance
SET override_period_start = '2026-03-20'::date,
    is_overridden = TRUE,
    updated_at = now()
WHERE id = '550e8400-e29b-41d4-a716-446655440000'::uuid
  AND period_start = '2026-03-19'::date;
```

### 5. Alterar recorrência futura (todas as ocorrências)

```sql
-- Muda de segunda/quarta para quarta/sexta
UPDATE goal_schedule
SET days_of_week = ARRAY[3,5],  -- Quarta (3) e Sexta (5)
    updated_at = now()
WHERE goal_definition_id = '550e8400-e29b-41d4-a716-446655440000'::uuid;

-- Job diário gerará novas instâncias com o novo schedule
```

### 6. Marcar meta como feita

```sql
-- Usando função auxiliar
SELECT mark_goal_instance_done(
    '550e8400-e29b-41d4-a716-446655440000'::uuid
);

-- Ou diretamente (trigger atualiza completion_count)
INSERT INTO user_goal_instance_log (
    user_goal_instance_id,
    action,
    old_status,
    new_status
) VALUES (
    '550e8400-e29b-41d4-a716-446655440000'::uuid,
    'MARK_DONE',
    'PENDING',
    'DONE'
);
```

### 7. Resumo semanal por conquista

```sql
SELECT 
    conquest_type,
    week_start,
    total_instances,
    completed,
    pending,
    skipped,
    completion_rate
FROM v_user_goals_weekly_summary
WHERE user_id = $1
  AND week_start >= date_trunc('week', CURRENT_DATE)
ORDER BY week_start DESC, conquest_type;
```

### 8. Resumo mensal por conquista

```sql
SELECT 
    conquest_type,
    month_start,
    total_instances,
    completed,
    pending,
    skipped,
    completion_rate
FROM v_user_goals_monthly_summary
WHERE user_id = $1
  AND month_start >= date_trunc('month', CURRENT_DATE) - INTERVAL '3 months'
ORDER BY month_start DESC, conquest_type;
```

## 📊 Views Disponíveis

### `v_user_goals_daily`

View para metas do dia com datas efetivas (considerando overrides).

**Colunas principais:**
- `effective_date`: Data efetiva (considera `override_period_start`)
- `effective_times`: Horários efetivos (considera `override_times`)
- `primary_time`: Primeiro horário da lista
- `status`: Status atual da instância
- `completion_count`: Quantas vezes foi completada

### `v_user_goals_weekly_summary`

View para resumo semanal agregado por conquista.

**Colunas principais:**
- `week_start`: Início da semana
- `total_instances`: Total de instâncias
- `completed`: Instâncias completadas
- `pending`: Instâncias pendentes
- `skipped`: Instâncias puladas
- `completion_rate`: Taxa de conclusão (%)

### `v_user_goals_monthly_summary`

View para resumo mensal agregado por conquista.

**Colunas principais:**
- `month_start`: Início do mês
- `total_instances`: Total de instâncias
- `completed`: Instâncias completadas
- `pending`: Instâncias pendentes
- `skipped`: Instâncias puladas
- `completion_rate`: Taxa de conclusão (%)

## 🎯 Funções Auxiliares

### `transfer_goal_instance(instance_id, target_date)`

Transfere uma instância de meta para outra data.

**Parâmetros:**
- `instance_id`: UUID da instância a ser transferida
- `target_date`: Data alvo (DATE)

**Retorno:** UUID da instância transferida

**Exemplo:**
```sql
SELECT transfer_goal_instance(
    '550e8400-e29b-41d4-a716-446655440000'::uuid,
    '2026-03-20'::date
);
```

### `override_goal_instance_times(instance_id, times)`

Override de horários em uma instância específica.

**Parâmetros:**
- `instance_id`: UUID da instância
- `times`: Array de horários (TIME[])

**Retorno:** UUID da instância atualizada

**Exemplo:**
```sql
SELECT override_goal_instance_times(
    '550e8400-e29b-41d4-a716-446655440000'::uuid,
    ARRAY['10:00'::time, '14:00'::time]
);
```

### `mark_goal_instance_done(instance_id)`

Marca uma instância como feita.

**Parâmetros:**
- `instance_id`: UUID da instância

**Retorno:** UUID da instância marcada

**Exemplo:**
```sql
SELECT mark_goal_instance_done(
    '550e8400-e29b-41d4-a716-446655440000'::uuid
);
```

## 📈 Índices Otimizados

### Índices em `goal_definition`

| Nome | Colunas | Propósito |
|------|---------|-----------|
| `idx_goal_definition_type_conquest` | `goal_type, conquest_type, is_active` | Busca por tipo e conquista |
| `idx_goal_definition_title` | `title` (WHERE is_active) | Busca por título |

### Índices em `goal_schedule`

| Nome | Colunas | Propósito |
|------|---------|-----------|
| `idx_goal_schedule_definition` | `goal_definition_id` | Busca schedules de uma definição |
| `idx_goal_schedule_validity` | `start_date, end_date` | Busca por período de vigência |

### Índices em `user_goal`

| Nome | Colunas | Propósito |
|------|---------|-----------|
| `idx_user_goal_user` | `user_id, is_active` | Busca metas de um usuário |
| `idx_user_goal_definition` | `goal_definition_id` | Busca metas por definição |
| `idx_user_goal_tree` | `planted_tree_id` | Busca por árvore plantada |

### Índices em `user_goal_instance`

| Nome | Colunas | Propósito |
|------|---------|-----------|
| `idx_instance_unique_override` | `user_goal_id, period_start` (com override) | Evita duplicatas |
| `idx_instance_user_date_status` | `user_goal_id, period_start, status` | Consultas por usuário + data |
| `idx_instance_pending_daily` | `period_start, period_type, status` (WHERE PENDING) | Busca instâncias pendentes |
| `idx_instance_overridden` | `is_overridden` (WHERE TRUE) | Busca instâncias com override |

### Índices em `user_goal_instance_log`

| Nome | Colunas | Propósito |
|------|---------|-----------|
| `idx_instance_log_instance` | `user_goal_instance_id, timestamp DESC` | Busca logs de uma instância |
| `idx_instance_log_action` | `action, timestamp DESC` | Busca logs por ação |

## 🔧 Triggers Automáticos

### `trg_instance_completion`

Trigger que atualiza `completion_count` e `status` automaticamente quando uma instância é marcada como feita.

**Comportamento:**
- Ao inserir log com action='MARK_DONE': incrementa `completion_count`, seta `status='DONE'`
- Ao atualizar log de 'MARK_DONE' para outro: decrementa `completion_count`, seta `status='PENDING'`

## 🎨 Enums Disponíveis

### `GoalType`
- `PONTUAL`: Meta com fim definido
- `CONTINUA`: Meta recorrente indefinida

### `ConquestType`
- `CORPO`
- `MENTE`
- `FAMILIA`
- `TRABALHO`
- `SOCIAL`
- `FINANCEIRO`
- `ESPIRITUAL`
- `HOBBY_LAZER`

### `Granularity`
- `DAILY`: Diária
- `WEEKLY`: Semanal
- `MONTHLY`: Mensal

### `InstanceStatus`
- `PENDING`: Pendente
- `DONE`: Feita
- `SKIPPED`: Pulada
- `MISSED`: Perdida

### `PeriodType`
- `DAILY`: Diária
- `WEEKLY`: Semanal
- `MONTHLY`: Mensal

### `InstanceLogAction`
- `MARK_DONE`: Marcar como feita
- `SKIP`: Pular
- `UNSKIP`: Desfazer skip
- `SNOOZE`: Adiar
- `TRANSFER`: Transferir para outra data
- `OVERRIDE_TIME`: Override de horários

## 🔄 Job Diário de Geração de Instâncias

Pseudocódigo do job diário:

```sql
-- Para cada user_goal ativa
FOR ug IN (SELECT * FROM user_goal WHERE is_active = TRUE) LOOP
    -- Buscar schedules da definição
    FOR gs IN (SELECT * FROM goal_schedule WHERE goal_definition_id = ug.goal_definition_id) LOOP
        -- Verificar se deve gerar instância hoje
        IF gs.granularity = 'DAILY' THEN
            -- Gerar instância diária
            INSERT INTO user_goal_instance (
                user_goal_id,
                period_start,
                period_type,
                period_key,
                total_schedules
            ) VALUES (
                ug.id,
                CURRENT_DATE,
                'DAILY',
                to_char(CURRENT_DATE, 'YYYY-MM-DD'),
                array_length(gs.times, 1)
            ) ON CONFLICT DO NOTHING;
        
        ELSIF gs.granularity = 'WEEKLY' THEN
            -- Verificar se hoje está nos dias da semana
            IF EXTRACT(DOW FROM CURRENT_DATE) = ANY(gs.days_of_week) THEN
                INSERT INTO user_goal_instance (...) VALUES (...) ON CONFLICT DO NOTHING;
            END IF;
        
        ELSIF gs.granularity = 'MONTHLY' THEN
            -- Verificar se hoje é o dia do mês
            IF EXTRACT(DAY FROM CURRENT_DATE) = gs.day_of_month THEN
                INSERT INTO user_goal_instance (...) VALUES (...) ON CONFLICT DO NOTHING;
            END IF;
        END IF;
    END LOOP;
END LOOP;
```

## 📝 Exemplos de Uso com Prisma

### Criar uma nova definição de meta

```typescript
const goalDefinition = await prisma.goalDefinition.create({
  data: {
    title: 'Exercícios físicos',
    description: '30 minutos de exercícios diários',
    goalType: 'CONTINUA',
    conquestType: 'CORPO',
    icon: 'dumbbell',
    accentColor: '#FF5733',
    schedules: {
      create: {
        granularity: 'WEEKLY',
        daysOfWeek: [1, 3, 5], // Segunda, Quarta, Sexta
        times: ['08:00', '18:00'],
        startDate: new Date('2026-03-20'),
      }
    }
  }
});
```

### Criar instância de meta para usuário

```typescript
const userGoal = await prisma.userGoal.create({
  data: {
    userId: 'user-uuid',
    goalDefinitionId: goalDefinition.id,
    plantedTreeId: 'tree-uuid',
    anchorId: 'anchor-uuid',
  }
});
```

### Buscar metas do dia

```typescript
const dailyGoals = await prisma.$queryRaw`
  SELECT 
    instance_id,
    user_goal_id,
    effective_date,
    title,
    status,
    effective_times
  FROM v_user_goals_daily
  WHERE user_id = ${userId}
    AND effective_date = CURRENT_DATE
  ORDER BY primary_time NULLS LAST
`;
```

### Override de horários em uma instância

```typescript
await prisma.$queryRaw`
  SELECT override_goal_instance_times(
    ${instanceId}::uuid,
    ARRAY['10:00'::time, '14:00'::time]
  )
`;
```

### Transferir meta para outra data

```typescript
await prisma.$queryRaw`
  SELECT transfer_goal_instance(
    ${instanceId}::uuid,
    ${targetDate}::date
  )
`;
```

### Marcar meta como feita

```typescript
await prisma.$queryRaw`
  SELECT mark_goal_instance_done(${instanceId}::uuid)
`;
```

## 🚦 Migração do Schema Antigo

### Passo 1: Criar novas tabelas

```bash
psql -d database -f database/schema.sql
```

### Passo 2: Migrar dados existentes

```sql
-- Migrar UserGoal para goal_definition
INSERT INTO goal_definition (id, title, description, goal_type, conquest_type)
SELECT
    planted_tree_id,
    title,
    description,
    goal_type::goal_type_enum,
    conquest_type::conquest_type_enum
FROM "UserGoal";

-- Migrar scheduleConfig para goal_schedule
INSERT INTO goal_schedule (goal_definition_id, granularity, times, start_date, end_date, duration_days)
SELECT
    planted_tree_id,
    CASE
        WHEN scheduleConfig->>'type' = 'daily' THEN 'DAILY'
        WHEN scheduleConfig->>'type' = 'weekly' THEN 'WEEKLY'
        WHEN scheduleConfig->>'type' = 'once' THEN 'MONTHLY'
        ELSE 'DAILY'
    END::granularity_enum,
    (scheduleConfig->>'times')::TIME[],
    COALESCE((scheduleConfig->>'at')::DATE, CURRENT_DATE),
    CASE
        WHEN goal_type = 'PONTUAL' AND scheduleConfig->>'durationDays' IS NOT NULL
            THEN CURRENT_DATE + (scheduleConfig->>'durationDays')::INT * INTERVAL '1 day'
        WHEN goal_type = 'PONTUAL'
            THEN CURRENT_DATE + INTERVAL '1 month'
        ELSE NULL
    END,
    (scheduleConfig->>'durationDays')::INT
FROM "UserGoal";

-- Criar user_goal para cada UserGoal existente
INSERT INTO user_goal (id, user_id, goal_definition_id, planted_tree_id, anchor_id)
SELECT
    id,
    userId,
    planted_tree_id,
    planted_tree_id,
    anchorId
FROM "UserGoal";
```

### Passo 3: Backfill de instâncias

```sql
-- Gerar instâncias para os últimos 90 dias
-- (executar job diário retroativo)
```

### Passo 4: Atualizar Prisma schema

```bash
npx prisma db push
```

### Passo 5: Validar e remover tabelas antigas

```sql
-- Após validação completa
DROP TABLE "UserGoal";
```

## 📚 Referências

- Documentação completa em `database/schema.sql`
- Schema Prisma em `database/schema.prisma`
- Views e funções em `database/schema.sql` (seções 7 e 9)
