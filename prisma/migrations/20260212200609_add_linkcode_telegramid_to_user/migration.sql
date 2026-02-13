/*
  Warnings:

  - A unique constraint covering the columns `[linkCode]` on the table `User` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[telegramId]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "linkCode" TEXT,
ADD COLUMN     "telegramId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_linkCode_key" ON "User"("linkCode");

-- CreateIndex
CREATE UNIQUE INDEX "User_telegramId_key" ON "User"("telegramId");
