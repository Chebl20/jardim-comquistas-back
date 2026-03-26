-- Migration: normalize_goal_reminders
-- Idempotente: usa IF NOT EXISTS / verifica colunas antes de alterar

DO $$
BEGIN

  -- ========== GOAL table: remover colunas legadas ==========

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='Goal' AND column_name='reminderTime') THEN
    ALTER TABLE "Goal" DROP COLUMN "reminderTime";
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='Goal' AND column_name='scheduleConfig') THEN
    ALTER TABLE "Goal" DROP COLUMN "scheduleConfig";
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='Goal' AND column_name='reminderSlotsToday') THEN
    ALTER TABLE "Goal" DROP COLUMN "reminderSlotsToday";
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='Goal' AND column_name='lastReminderSentAt') THEN
    ALTER TABLE "Goal" DROP COLUMN "lastReminderSentAt";
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='Goal' AND column_name='reminderCount') THEN
    ALTER TABLE "Goal" DROP COLUMN "reminderCount";
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='Goal' AND column_name='dailyStatus') THEN
    ALTER TABLE "Goal" DROP COLUMN "dailyStatus";
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='Goal' AND column_name='silenceUntil') THEN
    ALTER TABLE "Goal" DROP COLUMN "silenceUntil";
  END IF;

  -- ========== GOAL_SCHEDULE table: adicionar novos campos ==========

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='GoalSchedule' AND column_name='at') THEN
    ALTER TABLE "GoalSchedule" ADD COLUMN "at" TIMESTAMP(3);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='GoalSchedule' AND column_name='times') THEN
    ALTER TABLE "GoalSchedule" ADD COLUMN "times" JSONB;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='GoalSchedule' AND column_name='daysOfWeek') THEN
    ALTER TABLE "GoalSchedule" ADD COLUMN "daysOfWeek" JSONB;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='GoalSchedule' AND column_name='durationDays') THEN
    ALTER TABLE "GoalSchedule" ADD COLUMN "durationDays" INTEGER;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='GoalSchedule' AND column_name='timeZone') THEN
    ALTER TABLE "GoalSchedule" ADD COLUMN "timeZone" TEXT NOT NULL DEFAULT 'UTC';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='GoalSchedule' AND column_name='seriesEndDate') THEN
    ALTER TABLE "GoalSchedule" DROP COLUMN "seriesEndDate";
  END IF;

  -- ========== GOAL_REMINDER table: adicionar colunas de dispatch ==========

  -- Garantir que a tabela existe (pode ter sido criada com estrutura mínima)
  CREATE TABLE IF NOT EXISTS "GoalReminder" (
    "id" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "minutesBefore" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GoalReminder_pkey" PRIMARY KEY ("id")
  );

  -- Garantir unique index em goalId
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname='public' AND tablename='GoalReminder' AND indexname='GoalReminder_goalId_key'
  ) THEN
    CREATE UNIQUE INDEX "GoalReminder_goalId_key" ON "GoalReminder"("goalId");
  END IF;

  -- Garantir FK Goal (cascata)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_schema='public' AND table_name='GoalReminder' AND constraint_name='GoalReminder_goalId_fkey'
  ) THEN
    ALTER TABLE "GoalReminder" ADD CONSTRAINT "GoalReminder_goalId_fkey"
      FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  -- Adicionar colunas de estado de dispatch
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='GoalReminder' AND column_name='dailyStatus') THEN
    ALTER TABLE "GoalReminder" ADD COLUMN "dailyStatus" TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='GoalReminder' AND column_name='slotsToday') THEN
    ALTER TABLE "GoalReminder" ADD COLUMN "slotsToday" JSONB;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='GoalReminder' AND column_name='lastSentAt') THEN
    ALTER TABLE "GoalReminder" ADD COLUMN "lastSentAt" TIMESTAMP(3);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='GoalReminder' AND column_name='sentCount') THEN
    ALTER TABLE "GoalReminder" ADD COLUMN "sentCount" INTEGER NOT NULL DEFAULT 0;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='GoalReminder' AND column_name='silenceUntil') THEN
    ALTER TABLE "GoalReminder" ADD COLUMN "silenceUntil" TIMESTAMP(3);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='GoalReminder' AND column_name='updatedAt') THEN
    ALTER TABLE "GoalReminder" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
  END IF;

END $$;
