-- CreateTable
CREATE TABLE "WorldConfig" (
    "id" SERIAL NOT NULL,
    "worldId" TEXT NOT NULL,
    "anchors" JSONB NOT NULL,
    "defaultTreeType" TEXT,
    "defaultGrowth" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorldConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorldConfig_worldId_key" ON "WorldConfig"("worldId");
