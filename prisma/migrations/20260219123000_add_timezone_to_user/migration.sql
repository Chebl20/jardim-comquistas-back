-- Migration: add timezone to User
-- Adds a non-nullable `timezone` column to the "User" table with default 'UTC'.
-- Ensures existing rows get 'UTC' before enforcing NOT NULL.

BEGIN;

-- 1) Add the column as nullable
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "timezone" TEXT;

-- 2) Set existing NULL values to 'UTC'
UPDATE "User" SET "timezone" = 'UTC' WHERE "timezone" IS NULL;

-- 3) Set default to 'UTC'
ALTER TABLE "User" ALTER COLUMN "timezone" SET DEFAULT 'UTC';

-- 4) Make the column NOT NULL
ALTER TABLE "User" ALTER COLUMN "timezone" SET NOT NULL;

COMMIT;
