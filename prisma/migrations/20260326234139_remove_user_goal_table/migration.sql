/*
  Warnings:

  - You are about to drop the `UserGoal` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "UserGoal" DROP CONSTRAINT "UserGoal_plantedTreeId_fkey";

-- DropForeignKey
ALTER TABLE "UserGoal" DROP CONSTRAINT "UserGoal_userId_fkey";

-- AlterTable
ALTER TABLE "GoalReminder" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "GoalSchedule" ALTER COLUMN "dtStart" DROP NOT NULL;

-- DropTable
DROP TABLE "UserGoal";
