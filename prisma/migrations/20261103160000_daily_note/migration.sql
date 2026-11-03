-- CreateTable
CREATE TABLE "DailyNote" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "civilDate" TEXT NOT NULL,
    "reflection" TEXT NOT NULL,
    "care" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DailyNote_userId_civilDate_key" ON "DailyNote"("userId", "civilDate");

-- CreateIndex
CREATE INDEX "DailyNote_userId_civilDate_idx" ON "DailyNote"("userId", "civilDate");

-- AddForeignKey
ALTER TABLE "DailyNote" ADD CONSTRAINT "DailyNote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
