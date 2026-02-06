# Descrição do banco de dados (resumo)

Este documento descreve o estado atual do esquema de banco do projeto (Prisma + PostgreSQL).

## Conexão
- Variável de ambiente: `DATABASE_URL` (arquivo: `.env`).
- Fonte: `prisma/schema.prisma`.

## Modelos (Prisma)

### `Goal`
- `id` (Int, PK, autoincrement)
- `title` (String, required)
- `year` (Int, required) — adicionada por migration `20260127133517_add_year`
- `description` (String, optional)
- `completed` (Boolean, default false)
- `progress` (Int, default 0)
- `createdAt` (DateTime, default now())
- `updatedAt` (DateTime, @updatedAt)
- `completedAt` (DateTime, optional)

Observações: todos os campos seguem o mapeamento padrão do Prisma para PostgreSQL (ex.: `String` → `TEXT`).

## Migrations aplicadas
- `20260127132455_init` — cria a tabela `Goal` com todos os campos exceto `year`.
  - SQL: cria `id` (SERIAL), `title` TEXT NOT NULL, `description` TEXT, `completed` BOOLEAN DEFAULT false, `progress` INTEGER DEFAULT 0, `createdAt` TIMESTAMP DEFAULT CURRENT_TIMESTAMP, `updatedAt` TIMESTAMP, `completedAt` TIMESTAMP.
- `20260127133517_add_year` — altera tabela `Goal` adicionando a coluna `year INTEGER NOT NULL`.
  - Observação na migration: a coluna `year` foi adicionada como NOT NULL sem valor default — isto exige que a tabela esteja vazia quando a migration foi aplicada, ou que tenha sido possível preencher valores antes da restrição.

## Arquivos relevantes
- Prisma schema: `prisma/schema.prisma`
- Migrations: `prisma/migrations/` (subpastas por timestamp)
- Cliente gerado (Prisma Client): `src/prisma/client.ts`
- Variáveis de ambiente: `.env`

## Como usar / comandos úteis
- Gerar cliente Prisma:

  ```bash
  npx prisma generate
  ```

- Aplicar migrations (dev):

  ```bash
  npx prisma migrate dev
  ```

- Inspecionar banco (ex.: abrir um REPL do prisma):

  ```bash
  npx prisma studio
  ```

## Observações para análise
- O esquema é simples — uma única tabela `Goal` atualmente.
- Verifique se a migration que adicionou `year` foi aplicada com a tabela vazia; caso contrário, pode haver inconsistência (a warning na migration aponta isso).
- Se for necessário versionamento/novas tabelas, adicione novos modelos no `schema.prisma` e crie uma migration com `prisma migrate`.

Se quiser, eu posso:
- executar um resumo das migrations aplicadas;
- gerar exemplos de queries usando o `Prisma Client`;
- ou revisar/ajustar a migration que adicionou `year` (se precisar contornar dados existentes).
