# Análise de Modelagem de Banco de Dados — Sistema de Metas com Granularidades

## 1. Situação Atual

### 1.1 Estrutura Atual (Prisma Schema)

O modelo central é `UserGoal`:

```prisma
model UserGoal {
  id                   String    @id @default(uuid())
  userId               String
  title                String
  description          String?
  goalType             String    // 'Pontual' | 'Continua'
  conquestType         String    // 'Corpo', 'Mente', etc.
  frequency            Int?      // LEGADO
  reminderTime         DateTime? // LEGADO
  scheduleConfig       Json?     // { type, times, daysOfWeek, durationDays, at }
  reminderSlotsToday   Json?
  lastReminderSentAt   DateTime?
  reminderCount        Int       @default(0)
  dailyStatus          String?   // PENDING | SENT | WAITING | DONE | SKIPPED
  silenceUntil         DateTime?
  completed            Boolean   @default(false)
  plantedTreeId        String
  anchorId             String
  createdAt            DateTime  @default(now())
  updatedAt            DateTime  @updatedAt
}
```

### 1.2 ScheduleConfig Atual

```typescript
type ScheduleConfig =
  | { type: 'once';      at: string }                              // datetime ISO
  | { type: 'daily';     times: string[]; durationDays?: number }  // HH:MM[]
  | { type: 'weekly';    daysOfWeek: number[]; times: string[] };  // 0=Dom..6=Sáb
```

### 1.3 Lacunas Identificadas

| Lacuna | Descrição |
|--------|-----------|
| Sem mensal | `scheduleConfig` não suporta granularidade mensal |
| Sem enum | `goalType` é string livre, sem validação |
| Sem enum | `conquestType` é string livre, sem validação |
| `dailyStatus` plano | Não há granularidade de status por período (diário/semanal/mensal) |
| Sem materialização | Cálculos de "quais metas se aplicam a qual dia" são feitos em runtime — sem cache/pré-cálculo |
| Índices | Não há índice composite para consultas por `userId + date` |
| Sem versionamento | Se `scheduleConfig` mudar, não há histórico de quais日子 foram afetadas |

---

## 2. Modelagem Proposta

### 2.1 Tabelas Principais

#### `goal_definition` — Definição da meta ( SKU )

Esta é a tabela **maestra** da meta. Ela contém tudo que é fixo e não depende do usuário.

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | `UUID` | PK |
| `title` | `VARCHAR(255)` | Nome da meta |
| `description` | `TEXT` | Descrição opcional |
| `goal_type` | `ENUM('PONTUAL', 'CONTINUA')` | Tipo da meta |
| `conquest_type` | `ENUM(...)` | Categoria (Corpo, Mente, etc.) |
| `is_active` | `BOOLEAN` | Soft delete |
| `created_at` | `TIMESTAMPTZ` | |

```sql
CREATE TYPE goal_type_enum AS ENUM ('PONTUAL', 'CONTINUA');
CREATE TYPE conquest_type_enum AS ENUM ('CORPO', 'MENTE', 'FAMILIA', 'TRABALHO', 'SOCIAL', 'FINANCEIRO', 'ESPIRITUAL', 'HOBBY_LAZER');
```

#### `goal_schedule` — Programação / Frequência

Uma meta pode ter **uma ou mais** programações. Isso permite que uma meta seja "segunda-quarta às 08:00 E sexta às 18:00".

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | `UUID` | PK |
| `goal_definition_id` | `UUID` | FK → `goal_definition` |
| `granularity` | `ENUM('DAILY', 'WEEKLY', 'MONTHLY')` | |
| `days_of_week` | `SMALLINT[]` | Array de dias (1=Seg..7=Dom). Vazio se DAILY |
| `day_of_month` | `SMALLINT` | Dia do mês (1-31). NULL se não MONTHLY |
| `times` | `TIME[]` | Horários de lembrete (HH:MM) |
| `start_date` | `DATE` | Início da vigência |
| `end_date` | `DATE` | Fim da vigência (NULL = indefinido) |
| `duration_days` | `INT` | Duração em dias (para PONTUAL com fim) |

**Exemplo de dados:**

```
goal_id=fk, granularity=WEEKLY, days_of_week={1,3,5}, times={'08:00','18:00'}
goal_id=fk, granularity=MONTHLY, day_of_month=15, times={'09:00'}
goal_id=fk, granularity=DAILY, days_of_week={}, times={'07:00'}
```

#### `user_goal` — Instância de uma meta para um usuário

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | `UUID` | PK |
| `user_id` | `UUID` | FK → `user` |
| `goal_definition_id` | `UUID` | FK → `goal_definition` |
| `planted_tree_id` | `UUID` | FK → `planted_tree` |
| `anchor_id` | `UUID` | |
| `is_active` | `BOOLEAN` | Soft delete do usuário |
| `created_at` | `TIMESTAMPTZ` | |
| `updated_at` | `TIMESTAMPTZ` | |

> **Nota:** `title`, `description`, `goal_type`, `conquest_type` sobem para `goal_definition`. `user_goal` vira uma relação simples entre usuário e definição de meta.

#### `user_goal_instance` — Ocorrência concreta de uma meta em um período

**Esta é a tabela mais importante para consultas eficientes.** Ela materializa cada ocorrência de uma meta em um período específico.

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | `UUID` | PK |
| `user_goal_id` | `UUID` | FK → `user_goal` |
| `period_start` | `DATE` | Início do período (dia/semana/mês) |
| `period_type` | `ENUM('DAILY', 'WEEKLY', 'MONTHLY')` | |
| `period_key` | `VARCHAR(10)` | Chave única: '2026-03-23', '2026-W13', '2026-03' |
| `status` | `ENUM('PENDING', 'DONE', 'SKIPPED', 'MISSED')` | |
| `completed_at` | `TIMESTAMPTZ` | Quando foi marcada como feita |
| `completion_count` | `INT` | Quantas vezes foi feita no período (se múltiplos horários) |
| `total_schedules` | `INT` | Total de horários programados neste período |
| `created_at` | `TIMESTAMPTZ` | |

**Índices obrigatórios:**

```sql
CREATE UNIQUE INDEX idx_instance_unique
  ON user_goal_instance (user_goal_id, period_key);

CREATE INDEX idx_instance_user_date
  ON user_goal_instance (user_id, period_start, period_type, status);

CREATE INDEX idx_instance_status
  ON user_goal_instance (status) WHERE status = 'PENDING';
```

#### `user_goal_instance_log` — Histórico de interações

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | `UUID` | PK |
| `user_goal_instance_id` | `UUID` | FK → `user_goal_instance` |
| `action` | `ENUM('MARK_DONE', 'SKIP', 'UNSKIP', 'SNOOZE')` | |
| `timestamp` | `TIMESTAMPTZ` | |

---

### 2.2 Diagrama de Relacionamentos

```
goal_definition (1)
       │
       │ 1:N
       ▼
goal_schedule (N)─────────────── N:1 ────── goal_definition
       │
       │ 1:N (para cada usuário)
       ▼
user_goal (N)─────────────────── N:1 ────── goal_definition
       │                                        ▲
       │ 1:N                                    │
       ▼                                        │
user_goal_instance (N)─────── N:1 ────── user_goal
       │
       │ 1:N
       ▼
user_goal_instance_log (N)
```

**Cardinalidades:**
- `goal_definition` → `goal_schedule`: **1:N** (uma meta pode ter múltiplos horários)
- `goal_definition` → `user_goal`: **1:N** (uma definição é instanciada por muitos usuários)
- `user_goal` → `user_goal_instance`: **1:N** (cada instância do usuário gera ocorrências por período)
- `user_goal_instance` → `user_goal_instance_log`: **1:N** (histórico de ações)

---

## 3. Estratégia: Recorrentes vs Pontuais

### 3.1 Diferenciação no Banco

A diferenciação é feita pelo campo `goal_type` na tabela `goal_definition`:

```sql
goal_type = 'PONTUAL'   -- Tem início e fim definidos
goal_type = 'CONTINUA'  -- Recorre indefinidamente
```

### 3.2 Armazenamento de Frequência

A frequência é armazenada na tabela `goal_schedule`:

| Granularidade | Como armazenar |
|---------------|----------------|
| **DIARIA** | `granularity='DAILY'`, `days_of_week=[]` (vazio), `times=['08:00']` |
| **SEMANAL** | `granularity='WEEKLY'`, `days_of_week={1,3,5}` (Seg, Qua, Sex), `times=['08:00']` |
| **MENSAL** | `granularity='MONTHLY'`, `day_of_month=15`, `times=['09:00']` |

### 3.3 Lógica de Geração de Instâncias

Um job diário (cron) gera os registros em `user_goal_instance`:

```sql
-- Pseudocódigo do job diário
para cada user_goal ativa:
    schedules = goal_schedules do user_goal.goal_definition

    para cada schedule:
        se schedule.granularity == 'DAILY':
            gerar instância HOJE com period_key = current_date

        se schedule.granularity == 'WEEKLY':
            se WEEKDAY(hoje) ∈ schedule.days_of_week:
                gerar instância HOJE

        se schedule.granularity == 'MONTHLY':
            se DAY(hoje) == schedule.day_of_month:
                gerar instância HOJE
```

**Instâncias PONTUAIS** recebem `period_type='MONTHLY'` (o mais amplo) com `end_date` definido em `goal_schedule`.

**Instâncias CONTINUAS** têm `end_date=NULL` e são geradas recursivamente.

---

## 4. Estrutura para Consumo Frontend

### 4.1 View SQL para Consulta Rápida

```sql
CREATE VIEW v_user_goals_daily AS
SELECT
    ugi.id                     AS instance_id,
    ugi.user_goal_id,
    ugi.period_start           AS date,
    ugi.period_key,
    ugi.status,
    ugi.completion_count,
    ugi.total_schedules,
    --
    ug.user_id,
    gd.title,
    gd.description,
    gd.goal_type,
    gd.conquest_type,
    --
    gs.granularity,
    gs.times,
    gs.days_of_week,
    gs.day_of_month,
    --
    pt.id                       AS planted_tree_id,
    pt.actual_stage,
    tc.family,
    tc.type                     AS tree_type,
    --
    CASE
        WHEN gs.times IS NULL THEN NULL
        ELSE (
            SELECT time
            FROM unnest(gs.times) WITH ORDINALITY AS t(time, ord)
            WHERE ord = 1
        )
    END                         AS primary_time
FROM user_goal_instance ugi
JOIN user_goal ug          ON ugi.user_goal_id = ug.id
JOIN goal_definition gd    ON ug.goal_definition_id = gd.id
JOIN goal_schedule gs      ON gs.goal_definition_id = gd.id
JOIN planted_tree pt       ON ug.planted_tree_id = pt.id
JOIN tree_catalog tc       ON pt.tree_catalog_id = tc.id
WHERE ugi.period_start = CURRENT_DATE
  AND ugi.period_type = 'DAILY'
  AND ug.is_active = TRUE
  AND gd.is_active = TRUE;
```

### 4.2 Query para Retornar Metas do Dia

```sql
SELECT
    instance_id,
    user_goal_id,
    title,
    description,
    goal_type,
    conquest_type,
    status,
    completion_count,
    total_schedules,
    primary_time,
    planted_tree_id,
    actual_stage,
    family,
    tree_type,
    --
    -- Conquistas do período (semana/mês) para o resumo
    (
        SELECT json_agg(json_build_object(
            'date', period_start,
            'status', status,
            'count', completion_count
        ))
        FROM user_goal_instance
        WHERE user_goal_id = ugi.user_goal_id
          AND period_start >= date_trunc('week', CURRENT_DATE)
          AND period_type = 'WEEKLY'
    ) AS weekly_progress
FROM v_user_goals_daily
WHERE user_id = $1  -- userId do usuário
ORDER BY primary_time NULLS LAST;
```

### 4.3 Query para Resumo Semanal/Mensal

```sql
-- Resumo semanal para um usuário
SELECT
    gd.conquest_type,
    COUNT(*)                                          AS total_instances,
    COUNT(*) FILTER (WHERE ugi.status = 'DONE')      AS completed,
    COUNT(*) FILTER (WHERE ugi.status = 'PENDING')    AS pending,
    ROUND(
        COUNT(*) FILTER (WHERE ugi.status = 'DONE')::NUMERIC
        / NULLIF(COUNT(*), 0) * 100, 1
    )                                                 AS completion_rate
FROM user_goal_instance ugi
JOIN user_goal ug          ON ugi.user_goal_id = ug.id
JOIN goal_definition gd    ON ug.goal_definition_id = gd.id
WHERE ug.user_id = $1
  AND ugi.period_start >= date_trunc('week', CURRENT_DATE)
  AND ugi.period_start <  date_trunc('week', CURRENT_DATE) + INTERVAL '1 week'
GROUP BY gd.conquest_type;
```

---

## 5. Queries de Exemplo Adicionais

### 5.1 Buscar metas de um usuário para um dia específico

```sql
SELECT *
FROM user_goal_instance ugi
JOIN user_goal ug ON ugi.user_goal_id = ug.id
JOIN goal_definition gd ON ug.goal_definition_id = gd.id
WHERE ug.user_id = $1                          -- :userId
  AND ugi.period_start = $2::date             -- :targetDate
  AND ug.is_active = TRUE
ORDER BY gd.title;
```

### 5.2 Buscar todas as instâncias pendentes de metas contínuas

```sql
SELECT ugi.*, gd.title, gd.goal_type
FROM user_goal_instance ugi
JOIN user_goal ug ON ugi.user_goal_id = ug.id
JOIN goal_definition gd ON ug.goal_definition_id = gd.id
WHERE ug.user_id = $1
  AND ugi.status = 'PENDING'
  AND gd.goal_type = 'CONTINUA'
ORDER BY ugi.period_start;
```

### 5.3 Progresso mensal de um usuário

```sql
SELECT
    date_trunc('month', period_start) AS month,
    COUNT(*)                          AS total,
    COUNT(*) FILTER (WHERE status = 'DONE') AS done,
    COUNT(*) FILTER (WHERE status = 'SKIPPED') AS skipped,
    ROUND(COUNT(*) FILTER (WHERE status = 'DONE')::NUMERIC
          / NULLIF(COUNT(*), 0) * 100, 1) AS rate
FROM user_goal_instance ugi
JOIN user_goal ug ON ugi.user_goal_id = ug.id
WHERE ug.user_id = $1
  AND period_start >= CURRENT_DATE - INTERVAL '3 months'
GROUP BY date_trunc('month', period_start)
ORDER BY month DESC;
```

### 5.4 Verificar se uma meta foi cumprida em todos os dias da semana

```sql
-- Verificar se a meta X foi cumprida em todos os dias úteis da semana atual
SELECT
    ugi.period_start,
    ugi.status
FROM user_goal_instance ugi
JOIN user_goal ug ON ugi.user_goal_id = ug.id
WHERE ug.id = $1                       -- :userGoalId
  AND ugi.period_start >= date_trunc('week', CURRENT_DATE)
  AND ugi.period_start <  date_trunc('week', CURRENT_DATE) + INTERVAL '1 week'
ORDER BY ugi.period_start;
```

---

## 6. Boas Práticas

### 6.1 Normalização vs Performance

| Decisão | Justificativa |
|---------|---------------|
| `goal_definition` separada de `user_goal` | Permite criar um "catálogo" de metas pré-definidas; evita duplicação de título, descrição, tipo |
| `user_goal_instance` materializada | Queries por "metas de hoje" ficam O(1) em vez de O(n × schedules); previne cálculos repetidos |
| `goal_schedule` separada | Uma meta pode ter múltiplos horários; granularidades diferentes (semanal E mensal) |
| Enum no PostgreSQL | Mais performático que VARCHAR; validação no banco |

### 6.2 Índice Composite para Consultas Frequentes

```sql
-- Consultas por usuário + data + status são muito frequentes
CREATE INDEX idx_ugi_user_date_status
    ON user_goal_instance (user_id, period_start, status)
    INCLUDE (user_goal_id);

-- Para dashboards agregados por conquista
CREATE INDEX idx_ugi_user_conquest_period
    ON user_goal_instance (user_id, conquest_type, period_start, status);

-- Para buscar instâncias pendentes por período
CREATE INDEX idx_ugi_pending_daily
    ON user_goal_instance (period_start, period_type, status)
    WHERE status = 'PENDING';
```

### 6.3 Particionamento de Tabela

Se o volume de `user_goal_instance` for muito alto (>10M linhas), particionar por `period_start`:

```sql
CREATE TABLE user_goal_instance (
    ...
)
PARTITION BY RANGE (period_start);

CREATE TABLE user_goal_instance_2026_q1
    PARTITION OF user_goal_instance
    FOR VALUES FROM ('2026-01-01') TO ('2026-04-01');
```

### 6.4 Trigger para Atualizar `completion_count`

```sql
CREATE OR REPLACE FUNCTION update_instance_completion()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' AND NEW.status = 'DONE' THEN
        UPDATE user_goal_instance
        SET completion_count = completion_count + 1
        WHERE id = NEW.user_goal_instance_id;

    ELSIF TG_OP = 'UPDATE' AND OLD.status != NEW.status THEN
        IF OLD.status = 'DONE' THEN
            UPDATE user_goal_instance
            SET completion_count = completion_count - 1
            WHERE id = NEW.user_goal_instance_id;
        END IF;
        IF NEW.status = 'DONE' THEN
            UPDATE user_goal_instance
            SET completion_count = completion_count + 1
            WHERE id = NEW.user_goal_instance_id;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_instance_completion
AFTER INSERT OR UPDATE ON user_goal_instance_log
FOR EACH ROW
WHEN (NEW.action IN ('MARK_DONE', 'UNSKIP'))
EXECUTE FUNCTION update_instance_completion();
```

---

## 7. Possíveis Problemas Futuros e Prevenção

| Problema | Prevenção |
|----------|------------|
| Crescimento excessivo de `user_goal_instance` | Particionamento por data; política de purge de instâncias > 12 meses |
| Jobs concorrentes gerando duplicatas | `INSERT ... ON CONFLICT DO NOTHING` com unique index em `(user_goal_id, period_key)` |
| Mudança de `goal_schedule` não refletida em instâncias existentes | Não alterar instâncias passadas; novas instâncias usam novo schedule |
| Métricas de streaks quebradas se `period_start` for inconsistente | Usar `date_trunc` uniformemente; nunca consultar `reminderTime` diretamente |
|泛化 (supergeneralização) de metas contínuas | `goal_type='CONTINUA'` com granularidade mínima de 1 dia; não permitir contínuo intra-day sem justificativa |
| Fronteiriços (ex: meta mensal no dia 31) | `day_of_month > 28` tratar com lógica de "último dia do mês"; usar função `LAST_DAY(mes)` para verificar |

---

## 8. Evolução a Partir do Schema Atual

### 8.1 Migração do Prisma para o Novo Modelo

**Fase 1 — Adicionar enums e novas tabelas:**

```sql
-- 1. Criar enums
CREATE TYPE goal_type_enum AS ENUM ('PONTUAL', 'CONTINUA');
CREATE TYPE conquest_type_enum AS ENUM ('CORPO', 'MENTE', 'FAMILIA', 'TRABALHO', 'SOCIAL', 'FINANCEIRO', 'ESPIRITUAL', 'HOBBY_LAZER');
CREATE TYPE granularity_enum AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');
CREATE TYPE instance_status_enum AS ('PENDING', 'DONE', 'SKIPPED', 'MISSED');
CREATE TYPE period_type_enum AS ('DAILY', 'WEEKLY', 'MONTHLY');

-- 2. Criar goal_definition (migrar dados do UserGoal atual)
CREATE TABLE goal_definition (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    goal_type goal_type_enum NOT NULL,
    conquest_type conquest_type_enum NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Criar goal_schedule
CREATE TABLE goal_schedule (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    goal_definition_id UUID REFERENCES goal_definition(id),
    granularity granularity_enum NOT NULL,
    days_of_week SMALLINT[] DEFAULT '{}',
    day_of_month SMALLINT CHECK (day_of_month BETWEEN 1 AND 31),
    times TIME[] DEFAULT '{}',
    start_date DATE NOT NULL DEFAULT CURRENT_DATE,
    end_date DATE,
    duration_days INT
);

-- 4. Migrar dados existentes do UserGoal
INSERT INTO goal_definition (id, title, description, goal_type, conquest_type)
SELECT
    planted_tree_id,  -- manter referência
    title,
    description,
    goal_type::goal_type_enum,
    conquest_type::conquest_type_enum
FROM "UserGoal";

-- 5. Popular goal_schedule a partir do scheduleConfig JSON
INSERT INTO goal_schedule (goal_definition_id, granularity, times, start_date, end_date, duration_days)
SELECT
    planted_tree_id,
    CASE
        WHEN scheduleConfig->>'type' = 'daily' THEN 'DAILY'
        WHEN scheduleConfig->>'type' = 'weekly' THEN 'WEEKLY'
        WHEN scheduleConfig->>'type' = 'once' THEN 'MONTHLY'  -- pontuais viram mensal
        ELSE 'DAILY'
    END,
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
```

**Fase 2 — Criar novas tabelas e índices:**

```sql
CREATE TABLE user_goal_instance (...);  -- conforme seção 2.1
CREATE INDEX idx_goal_schedule_definition ON goal_schedule(goal_definition_id);
```

**Fase 3 — Job de backfill:**
Gerar `user_goal_instance` para os últimos 90 dias a partir dos dados migrados.

### 8.2 Campos a Remover (Legacy)

Após validação completa da nova estrutura:
- `frequency` em UserGoal
- `reminderTime` em UserGoal
- `dailyStatus` em UserGoal (substituído por `user_goal_instance.status`)

---

## 9. Resumo das Tabelas

| Tabela | Purpose | Relaciona |
|--------|---------|-----------|
| `goal_definition` | Catálogo / SKU de metas | - |
| `goal_schedule` | Programação (diário/semanal/mensal) | → `goal_definition` |
| `user_goal` | Instância de meta por usuário | → `goal_definition`, → `user` |
| `user_goal_instance` | Ocorrência concreta por período | → `user_goal` |
| `user_goal_instance_log` | Histórico de ações por instância | → `user_goal_instance` |

---

## 10. Próximos Passos (Sem Alteração de Código)

1. Validar esta análise com o time de produto/backend
2. Definir política de retenção de `user_goal_instance` (quantos meses manter)
3. Decidir se `goal_definition` será mutável ou imutável após criação
4. Desenhar a estratégia de job de geração de instâncias (cron? event-driven?)
5. Avaliar se há necessidade de `user_goal_instance` para metas PONTUAIS (ou apenas marcar `completed=True` diretamente)
