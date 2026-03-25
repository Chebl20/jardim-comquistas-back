-- CreateTable
CREATE TABLE "Goal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "conquestType" TEXT NOT NULL,
    "goalKind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "plantedTreeId" TEXT,
    "reminderSlotsToday" JSONB,
    "lastReminderSentAt" TIMESTAMP(3),
    "reminderCount" INTEGER NOT NULL DEFAULT 0,
    "dailyStatus" TEXT,
    "silenceUntil" TIMESTAMP(3),
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Goal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoalSchedule" (
    "id" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "timeZone" TEXT NOT NULL DEFAULT 'UTC',
    "dtStart" TIMESTAMP(3) NOT NULL,
    "dtEnd" TIMESTAMP(3),
    "rrule" TEXT,
    "seriesEndDate" TIMESTAMP(3),
    "extra" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoalSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoalOccurrenceException" (
    "id" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "originalOccurrenceStart" TIMESTAMP(3) NOT NULL,
    "isCancelled" BOOLEAN NOT NULL DEFAULT false,
    "titleOverride" TEXT,
    "startOverride" TIMESTAMP(3),
    "endOverride" TIMESTAMP(3),
    "payloadOverride" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoalOccurrenceException_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoalReminder" (
    "id" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "minutesBefore" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoalReminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Goal_plantedTreeId_key" ON "Goal"("plantedTreeId");

-- CreateIndex
CREATE INDEX "Goal_userId_createdAt_idx" ON "Goal"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "GoalSchedule_goalId_key" ON "GoalSchedule"("goalId");

-- CreateIndex
CREATE UNIQUE INDEX "GoalOccurrenceException_scheduleId_originalOccurrenceStart_key" ON "GoalOccurrenceException"("scheduleId", "originalOccurrenceStart");

-- AddForeignKey
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_plantedTreeId_fkey" FOREIGN KEY ("plantedTreeId") REFERENCES "PlantedTree"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoalSchedule" ADD CONSTRAINT "GoalSchedule_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoalOccurrenceException" ADD CONSTRAINT "GoalOccurrenceException_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoalOccurrenceException" ADD CONSTRAINT "GoalOccurrenceException_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "GoalSchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoalReminder" ADD CONSTRAINT "GoalReminder_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
