-- Default de fuso para novos usuários (São Luís / Maranhão)
ALTER TABLE "User" ALTER COLUMN "timezone" SET DEFAULT 'America/Fortaleza';

-- Legado: UTC no Prisma era “não configurado”
UPDATE "User" SET "timezone" = 'America/Fortaleza' WHERE "timezone" = 'UTC';
