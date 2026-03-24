-- ============================================================================
-- Schema Completo do Sistema de Metas com Granularidades
-- ============================================================================
-- Autor: Cascade AI
-- Data: 2026-03-24
-- Descrição: Modelagem otimizada para suportar alterações pontuais,
--            transferências entre dias e override de horários
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. ENUMS
-- ----------------------------------------------------------------------------

-- Tipo de meta: Pontual (com fim definido) ou Contínua (recorrente indefinida)
CREATE TYPE goal_type_enum AS ENUM ('PONTUAL', 'CONTINUA');

-- Categoria de conquista: Corpo, Mente, Família, etc.
CREATE TYPE conquest_type_enum AS ENUM (
    'CORPO',
    'MENTE',
    'FAMILIA',
    'TRABALHO',
    'SOCIAL',
    'FINANCEIRO',
    'ESPIRITUAL',
    'HOBBY_LAZER'
);

-- Granularidade de programação: Diária, Semanal ou Mensal
CREATE TYPE granularity_enum AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');

-- Status de uma instância de meta
CREATE TYPE instance_status_enum AS ENUM ('PENDING', 'DONE', 'SKIPPED', 'MISSED');

-- Tipo de período para instâncias
CREATE TYPE period_type_enum AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');

-- Ações registradas no log de instâncias
CREATE TYPE instance_log_action_enum AS ENUM ('MARK_DONE', 'SKIP', 'UNSKIP', 'SNOOZE', 'TRANSFER', 'OVERRIDE_TIME');

-- ----------------------------------------------------------------------------
-- 2. TABELA: goal_definition (Catálogo / SKU de metas)
-- ----------------------------------------------------------------------------
-- Esta tabela contém a definição "maestra" da meta.
-- Tudo que é fixo e não depende do usuário fica aqui.

CREATE TABLE goal_definition (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    goal_type goal_type_enum NOT NULL,
    conquest_type conquest_type_enum NOT NULL,
    icon VARCHAR(50),
    accent_color VARCHAR(7), -- HEX color: #RRGGBB
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Índice para busca por tipo e conquista
CREATE INDEX idx_goal_definition_type_conquest 
  ON goal_definition (goal_type, conquest_type, is_active);

-- Índice para busca por título
CREATE INDEX idx_goal_definition_title 
  ON goal_definition (title) WHERE is_active = TRUE;

-- ----------------------------------------------------------------------------
-- 3. TABELA: goal_schedule (Programação / Frequência)
-- ----------------------------------------------------------------------------
-- Uma meta pode ter UMA ou MAIS programações.
-- Isso permite que uma meta seja "segunda-quarta às 08:00 E sexta às 18:00".

CREATE TABLE goal_schedule (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    goal_definition_id UUID NOT NULL REFERENCES goal_definition(id) ON DELETE CASCADE,
    granularity granularity_enum NOT NULL,
    days_of_week SMALLINT[] DEFAULT '{}', -- Array de dias (1=Seg..7=Dom). Vazio se DAILY
    day_of_month SMALLINT CHECK (day_of_month BETWEEN 1 AND 31), -- Dia do mês (1-31). NULL se não MONTHLY
    times TIME[] DEFAULT '{}', -- Horários de lembrete (HH:MM)
    start_date DATE NOT NULL DEFAULT CURRENT_DATE,
    end_date DATE, -- Fim da vigência (NULL = indefinido)
    duration_days INT, -- Duração em dias (para PONTUAL com fim)
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Índice para buscar schedules de uma definição
CREATE INDEX idx_goal_schedule_definition 
  ON goal_schedule (goal_definition_id);

-- Índice para busca por período de vigência
CREATE INDEX idx_goal_schedule_validity 
  ON goal_schedule (start_date, end_date) WHERE is_active = TRUE;

-- ----------------------------------------------------------------------------
-- 4. TABELA: user_goal (Instância de uma meta para um usuário)
-- ----------------------------------------------------------------------------
-- Relação simples entre usuário e definição de meta.

CREATE TABLE user_goal (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    goal_definition_id UUID NOT NULL REFERENCES goal_definition(id) ON DELETE CASCADE,
    planted_tree_id UUID NOT NULL,
    anchor_id VARCHAR(255),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Índice para buscar metas de um usuário
CREATE INDEX idx_user_goal_user 
  ON user_goal (user_id, is_active);

-- Índice para buscar metas por definição
CREATE INDEX idx_user_goal_definition 
  ON user_goal (goal_definition_id);

-- Índice para busca por árvore plantada
CREATE INDEX idx_user_goal_tree 
  ON user_goal (planted_tree_id);

-- ----------------------------------------------------------------------------
-- 5. TABELA: user_goal_instance (Ocorrência concreta de uma meta em um período)
-- ----------------------------------------------------------------------------
-- Esta é a tabela mais importante para consultas eficientes.
-- Ela materializa cada ocorrência de uma meta em um período específico.
-- Inclui campos de override para suportar alterações pontuais.

CREATE TABLE user_goal_instance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_goal_id UUID NOT NULL REFERENCES user_goal(id) ON DELETE CASCADE,
    period_start DATE NOT NULL,
    period_type period_type_enum NOT NULL,
    period_key VARCHAR(10) NOT NULL, -- Chave única: '2026-03-23', '2026-W13', '2026-03'
    status instance_status_enum NOT NULL DEFAULT 'PENDING',
    completed_at TIMESTAMPTZ,
    completion_count INT DEFAULT 0,
    total_schedules INT DEFAULT 0,
    
    -- Campos de override para alterações pontuais
    override_times TIME[], -- Override de horários para esta instância específica
    override_days_of_week SMALLINT[], -- Override de dias da semana
    override_period_start DATE, -- Override da data (para transferências)
    is_overridden BOOLEAN DEFAULT FALSE, -- Flag indicando se há override
    
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Unique index considerando overrides
CREATE UNIQUE INDEX idx_instance_unique_override
  ON user_goal_instance (
    CASE WHEN is_overridden AND override_period_start IS NOT NULL 
         THEN override_period_start 
         ELSE period_start 
    END,
    user_goal_id
  );

-- Índice composto para consultas por usuário + data + status
CREATE INDEX idx_instance_user_date_status
  ON user_goal_instance (user_goal_id, period_start, status);

-- Índice para buscar instâncias pendentes por período
CREATE INDEX idx_instance_pending_daily
  ON user_goal_instance (period_start, period_type, status)
  WHERE status = 'PENDING';

-- Índice para instâncias com override
CREATE INDEX idx_instance_overridden
  ON user_goal_instance (is_overridden) WHERE is_overridden = TRUE;

-- ----------------------------------------------------------------------------
-- 6. TABELA: user_goal_instance_log (Histórico de interações)
-- ----------------------------------------------------------------------------

CREATE TABLE user_goal_instance_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_goal_instance_id UUID NOT NULL REFERENCES user_goal_instance(id) ON DELETE CASCADE,
    action instance_log_action_enum NOT NULL,
    old_status instance_status_enum,
    new_status instance_status_enum,
    metadata JSONB, -- Dados adicionais sobre a ação
    timestamp TIMESTAMPTZ DEFAULT now()
);

-- Índice para buscar logs de uma instância
CREATE INDEX idx_instance_log_instance
  ON user_goal_instance_log (user_goal_instance_id, timestamp DESC);

-- Índice para buscar logs por ação
CREATE INDEX idx_instance_log_action
  ON user_goal_instance_log (action, timestamp DESC);

-- ----------------------------------------------------------------------------
-- 7. VIEWS (Views para consultas simplificadas)
-- ----------------------------------------------------------------------------

-- View para metas do dia com datas efetivas (considerando overrides)
CREATE VIEW v_user_goals_daily AS
SELECT
    ugi.id AS instance_id,
    ugi.user_goal_id,
    CASE 
        WHEN ugi.is_overridden AND ugi.override_period_start IS NOT NULL 
        THEN ugi.override_period_start 
        ELSE ugi.period_start 
    END AS effective_date,
    ugi.period_key,
    ugi.status,
    ugi.completion_count,
    ugi.total_schedules,
    ugi.completed_at,
    CASE 
        WHEN ugi.is_overridden AND ugi.override_times IS NOT NULL 
        THEN ugi.override_times 
        ELSE gs.times 
    END AS effective_times,
    --
    ug.user_id,
    gd.title,
    gd.description,
    gd.goal_type,
    gd.conquest_type,
    gd.icon,
    gd.accent_color,
    --
    gs.granularity,
    gs.days_of_week,
    gs.day_of_month,
    --
    pt.id AS planted_tree_id,
    pt.actual_stage,
    tc.family,
    tc.type AS tree_type,
    --
    -- Horário principal (primeiro da lista)
    CASE
        WHEN (
            CASE 
                WHEN ugi.is_overridden AND ugi.override_times IS NOT NULL 
                THEN ugi.override_times 
                ELSE gs.times 
            END
        ) IS NULL THEN NULL
        ELSE (
            SELECT time
            FROM unnest(
                CASE 
                    WHEN ugi.is_overridden AND ugi.override_times IS NOT NULL 
                    THEN ugi.override_times 
                    ELSE gs.times 
                END
            ) WITH ORDINALITY AS t(time, ord)
            WHERE ord = 1
        )
    END AS primary_time
FROM user_goal_instance ugi
JOIN user_goal ug ON ugi.user_goal_id = ug.id
JOIN goal_definition gd ON ug.goal_definition_id = gd.id
JOIN goal_schedule gs ON gs.goal_definition_id = gd.id
JOIN planted_tree pt ON ug.planted_tree_id = pt.id
JOIN tree_catalog tc ON pt.tree_catalog_id = tc.id
WHERE ug.is_active = TRUE
  AND gd.is_active = TRUE;

-- View para resumo semanal por conquista
CREATE VIEW v_user_goals_weekly_summary AS
SELECT
    ug.user_id,
    gd.conquest_type,
    date_trunc('week', ugi.period_start) AS week_start,
    COUNT(*) AS total_instances,
    COUNT(*) FILTER (WHERE ugi.status = 'DONE') AS completed,
    COUNT(*) FILTER (WHERE ugi.status = 'PENDING') AS pending,
    COUNT(*) FILTER (WHERE ugi.status = 'SKIPPED') AS skipped,
    ROUND(
        COUNT(*) FILTER (WHERE ugi.status = 'DONE')::NUMERIC
        / NULLIF(COUNT(*), 0) * 100, 1
    ) AS completion_rate
FROM user_goal_instance ugi
JOIN user_goal ug ON ugi.user_goal_id = ug.id
JOIN goal_definition gd ON ug.goal_definition_id = gd.id
WHERE ug.is_active = TRUE
  AND gd.is_active = TRUE
GROUP BY ug.user_id, gd.conquest_type, date_trunc('week', ugi.period_start);

-- View para resumo mensal por conquista
CREATE VIEW v_user_goals_monthly_summary AS
SELECT
    ug.user_id,
    gd.conquest_type,
    date_trunc('month', ugi.period_start) AS month_start,
    COUNT(*) AS total_instances,
    COUNT(*) FILTER (WHERE ugi.status = 'DONE') AS completed,
    COUNT(*) FILTER (WHERE ugi.status = 'PENDING') AS pending,
    COUNT(*) FILTER (WHERE ugi.status = 'SKIPPED') AS skipped,
    ROUND(
        COUNT(*) FILTER (WHERE ugi.status = 'DONE')::NUMERIC
        / NULLIF(COUNT(*), 0) * 100, 1
    ) AS completion_rate
FROM user_goal_instance ugi
JOIN user_goal ug ON ugi.user_goal_id = ug.id
JOIN goal_definition gd ON ug.goal_definition_id = gd.id
WHERE ug.is_active = TRUE
  AND gd.is_active = TRUE
GROUP BY ug.user_id, gd.conquest_type, date_trunc('month', ugi.period_start);

-- ----------------------------------------------------------------------------
-- 8. TRIGGERS (Triggers para atualização automática)
-- ----------------------------------------------------------------------------

-- Função para atualizar completion_count
CREATE OR REPLACE FUNCTION update_instance_completion()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' AND NEW.action = 'MARK_DONE' THEN
        UPDATE user_goal_instance
        SET completion_count = completion_count + 1,
            status = 'DONE',
            completed_at = NEW.timestamp
        WHERE id = NEW.user_goal_instance_id;

    ELSIF TG_OP = 'UPDATE' AND OLD.action != NEW.action THEN
        IF OLD.action = 'MARK_DONE' THEN
            UPDATE user_goal_instance
            SET completion_count = completion_count - 1,
                status = 'PENDING',
                completed_at = NULL
            WHERE id = NEW.user_goal_instance_id;
        END IF;
        IF NEW.action = 'MARK_DONE' THEN
            UPDATE user_goal_instance
            SET completion_count = completion_count + 1,
                status = 'DONE',
                completed_at = NEW.timestamp
            WHERE id = NEW.user_goal_instance_id;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger para atualizar completion_count
CREATE TRIGGER trg_instance_completion
AFTER INSERT OR UPDATE ON user_goal_instance_log
FOR EACH ROW
WHEN (NEW.action IN ('MARK_DONE', 'UNSKIP'))
EXECUTE FUNCTION update_instance_completion();

-- ----------------------------------------------------------------------------
-- 9. FUNÇÕES AUXILIARES (Functions para operações comuns)
-- ----------------------------------------------------------------------------

-- Função para transferir uma instância de meta para outra data
CREATE OR REPLACE FUNCTION transfer_goal_instance(
    p_instance_id UUID,
    p_target_date DATE
) RETURNS UUID AS $$
DECLARE
    v_instance_id UUID;
BEGIN
    -- Verificar se já existe instância no dia alvo
    SELECT id INTO v_instance_id
    FROM user_goal_instance
    WHERE user_goal_id = (SELECT user_goal_id FROM user_goal_instance WHERE id = p_instance_id)
      AND CASE 
            WHEN is_overridden AND override_period_start IS NOT NULL 
            THEN override_period_start 
            ELSE period_start 
          END = p_target_date;
    
    IF v_instance_id IS NOT NULL THEN
        RAISE EXCEPTION 'Já existe instância de meta no dia %', p_target_date;
    END IF;
    
    -- Atualizar a instância com override
    UPDATE user_goal_instance
    SET override_period_start = p_target_date,
        is_overridden = TRUE,
        updated_at = now()
    WHERE id = p_instance_id;
    
    -- Registrar no log
    INSERT INTO user_goal_instance_log (user_goal_instance_id, action, metadata)
    VALUES (p_instance_id, 'TRANSFER', jsonb_build_object('target_date', p_target_date));
    
    RETURN p_instance_id;
END;
$$ LANGUAGE plpgsql;

-- Função para override de horários em uma instância específica
CREATE OR REPLACE FUNCTION override_goal_instance_times(
    p_instance_id UUID,
    p_times TIME[]
) RETURNS UUID AS $$
BEGIN
    UPDATE user_goal_instance
    SET override_times = p_times,
        is_overridden = TRUE,
        updated_at = now()
    WHERE id = p_instance_id;
    
    -- Registrar no log
    INSERT INTO user_goal_instance_log (user_goal_instance_id, action, metadata)
    VALUES (p_instance_id, 'OVERRIDE_TIME', jsonb_build_object('times', p_times));
    
    RETURN p_instance_id;
END;
$$ LANGUAGE plpgsql;

-- Função para marcar uma instância como feita
CREATE OR REPLACE FUNCTION mark_goal_instance_done(
    p_instance_id UUID
) RETURNS UUID AS $$
DECLARE
    v_current_status instance_status_enum;
BEGIN
    SELECT status INTO v_current_status
    FROM user_goal_instance
    WHERE id = p_instance_id;
    
    IF v_current_status = 'DONE' THEN
        RAISE EXCEPTION 'Instância já está marcada como DONE';
    END IF;
    
    -- Registrar no log
    INSERT INTO user_goal_instance_log (user_goal_instance_id, action, old_status, new_status)
    VALUES (p_instance_id, 'MARK_DONE', v_current_status, 'DONE');
    
    RETURN p_instance_id;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- 10. COMENTÁRIOS (Comments para documentação)
-- ----------------------------------------------------------------------------

COMMENT ON TABLE goal_definition IS 'Catálogo de definições de metas (SKU). Contém tudo que é fixo e compartilhado entre usuários.';
COMMENT ON TABLE goal_schedule IS 'Programação de horários para uma definição de meta. Uma definição pode ter múltiplos schedules.';
COMMENT ON TABLE user_goal IS 'Instância de uma meta para um usuário específico. Relação simples entre usuário e definição.';
COMMENT ON TABLE user_goal_instance IS 'Materialização de ocorrências de metas em períodos específicos. Inclui campos de override para alterações pontuais.';
COMMENT ON TABLE user_goal_instance_log IS 'Histórico de ações realizadas em instâncias de metas. Auditoria completa de interações.';

COMMENT ON COLUMN user_goal_instance.override_times IS 'Override de horários para esta instância específica. Se preenchido, substitui os horários do goal_schedule.';
COMMENT ON COLUMN user_goal_instance.override_period_start IS 'Override da data da instância. Usado para transferências entre dias.';
COMMENT ON COLUMN user_goal_instance.is_overridden IS 'Flag indicando se esta instância tem overrides aplicados.';

-- ============================================================================
-- FIM DO SCHEMA
-- ============================================================================
