-- CreateTable
CREATE TABLE "World" (
    "id" TEXT NOT NULL,
    "worldId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "svgPath" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "World_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "World_worldId_key" ON "World"("worldId");

-- AddForeignKey
ALTER TABLE "WorldConfig" ADD CONSTRAINT "WorldConfig_worldId_fkey" FOREIGN KEY ("worldId") REFERENCES "World"("worldId") ON DELETE RESTRICT ON UPDATE CASCADE;
