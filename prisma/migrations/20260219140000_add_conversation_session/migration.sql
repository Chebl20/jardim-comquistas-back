-- Migration: add ConversationSession
BEGIN;

-- 1) Create table ConversationSession
-- Ensure pgcrypto extension for gen_random_uuid()
-- Note: removed automatic DB-side uuid default to avoid requiring pgcrypto/superuser.
CREATE TABLE IF NOT EXISTS "ConversationSession" (
  "id" uuid PRIMARY KEY,
  -- Use TEXT for userId to match existing User.id column type (text) in current DB
  "userId" TEXT UNIQUE NOT NULL,
  "state" TEXT NOT NULL,
  "payload" JSONB,
  "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- 2) Foreign key to User
ALTER TABLE "ConversationSession" ADD CONSTRAINT fk_conversation_user FOREIGN KEY ("userId") REFERENCES "User"(id) ON DELETE CASCADE;

COMMIT;
