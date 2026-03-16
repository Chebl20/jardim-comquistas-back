/*
  Warnings:

  - Added the required column `type` to the `TreeCatalog` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "TreeCatalog" ADD COLUMN     "type" TEXT NOT NULL;
