-- AlterTable
ALTER TABLE "Goal" ADD COLUMN     "reminderTime" TIMESTAMP(3),
ADD COLUMN     "scheduleConfig" JSONB;
