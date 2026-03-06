/*
  Warnings:

  - The primary key for the `ConversationSession` table will be changed. If it partially fails, the table could be left without primary key constraint.

*/
-- DropForeignKey
ALTER TABLE "ConversationSession" DROP CONSTRAINT "fk_conversation_user";

-- AlterTable
ALTER TABLE "ConversationSession" DROP CONSTRAINT "ConversationSession_pkey",
ALTER COLUMN "id" SET DATA TYPE TEXT,
ALTER COLUMN "expiresAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updatedAt" DROP DEFAULT,
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3),
ADD CONSTRAINT "ConversationSession_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "UserGoal" ADD COLUMN     "reminderCount" INTEGER NOT NULL DEFAULT 0;

-- AddForeignKey
ALTER TABLE "ConversationSession" ADD CONSTRAINT "ConversationSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
