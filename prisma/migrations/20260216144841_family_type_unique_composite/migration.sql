/*
  Warnings:

  - A unique constraint covering the columns `[family,type]` on the table `TreeCatalog` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "TreeCatalog_family_key";

-- AlterTable
ALTER TABLE "TreeCatalog" ALTER COLUMN "type" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "TreeCatalog_family_type_key" ON "TreeCatalog"("family", "type");
