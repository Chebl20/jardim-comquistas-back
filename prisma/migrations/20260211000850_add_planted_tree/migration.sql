/*
  Warnings:

  - You are about to drop the `Goal` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
DROP TABLE "Goal";

-- CreateTable
CREATE TABLE "TreeCatalog" (
    "id" TEXT NOT NULL,
    "family" TEXT NOT NULL,
    "stages" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TreeCatalog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlantedTree" (
    "id" TEXT NOT NULL,
    "worldId" TEXT NOT NULL,
    "anchorId" TEXT NOT NULL,
    "treeCatalogId" TEXT NOT NULL,
    "actualStage" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlantedTree_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GrowthEvent" (
    "id" TEXT NOT NULL,
    "plantedTreeId" TEXT NOT NULL,
    "stage" INTEGER NOT NULL,
    "progressIndex" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GrowthEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TreeCatalog_family_key" ON "TreeCatalog"("family");

-- AddForeignKey
ALTER TABLE "PlantedTree" ADD CONSTRAINT "PlantedTree_treeCatalogId_fkey" FOREIGN KEY ("treeCatalogId") REFERENCES "TreeCatalog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrowthEvent" ADD CONSTRAINT "GrowthEvent_plantedTreeId_fkey" FOREIGN KEY ("plantedTreeId") REFERENCES "PlantedTree"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
