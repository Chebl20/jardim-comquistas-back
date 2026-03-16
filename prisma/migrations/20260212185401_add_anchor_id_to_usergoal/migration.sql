/*
  Warnings:

  - Added the required column `anchorId` to the `UserGoal` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "UserGoal" ADD COLUMN     "anchorId" TEXT NOT NULL;
