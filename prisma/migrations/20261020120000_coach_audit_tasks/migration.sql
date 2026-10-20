-- CreateTable
CREATE TABLE "UserCoachProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "preferredTone" TEXT NOT NULL DEFAULT 'friendly',
    "quietHoursStart" TEXT,
    "quietHoursEnd" TEXT,
    "conversationSummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserCoachProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationTurn" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "flowState" TEXT,
    "nucleus" TEXT,
    "text" TEXT,
    "textHash" TEXT,
    "actions" JSONB,
    "goalId" TEXT,
    "reminderId" TEXT,
    "llmModel" TEXT,
    "confidence" DOUBLE PRECISION,
    "externalMsgId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "ConversationTurn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoachTask" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_USER',
    "title" TEXT NOT NULL,
    "payload" JSONB,
    "goalId" TEXT,
    "dueAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoachTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserCoachProfile_userId_key" ON "UserCoachProfile"("userId");

-- CreateIndex
CREATE INDEX "ConversationTurn_userId_createdAt_idx" ON "ConversationTurn"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ConversationTurn_externalMsgId_idx" ON "ConversationTurn"("externalMsgId");

-- CreateIndex
CREATE INDEX "ConversationTurn_expiresAt_idx" ON "ConversationTurn"("expiresAt");

-- CreateIndex
CREATE INDEX "CoachTask_userId_status_idx" ON "CoachTask"("userId", "status");

-- CreateIndex
CREATE INDEX "CoachTask_dueAt_idx" ON "CoachTask"("dueAt");

-- AddForeignKey
ALTER TABLE "UserCoachProfile" ADD CONSTRAINT "UserCoachProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationTurn" ADD CONSTRAINT "ConversationTurn_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachTask" ADD CONSTRAINT "CoachTask_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
