-- CreateTable
CREATE TABLE "UserGoal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "goalType" TEXT NOT NULL,
    "conquestType" TEXT NOT NULL,
    "frequency" INTEGER,
    "reminderTime" TIMESTAMP(3),
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "plantedTreeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserGoal_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "UserGoal" ADD CONSTRAINT "UserGoal_plantedTreeId_fkey" FOREIGN KEY ("plantedTreeId") REFERENCES "PlantedTree"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
