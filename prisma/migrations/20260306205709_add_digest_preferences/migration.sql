-- AlterTable
ALTER TABLE "User" ADD COLUMN     "digestEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "digestTime" TEXT;
