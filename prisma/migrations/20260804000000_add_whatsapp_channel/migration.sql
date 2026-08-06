-- AlterTable
ALTER TABLE "User" ADD COLUMN "whatsappId" TEXT;
ALTER TABLE "User" ADD COLUMN "preferredChannel" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_whatsappId_key" ON "User"("whatsappId");
