# Jardim das Conquistas — backend

API NestJS do Jardim das Conquistas: metas com agenda, jardim virtual (SVG/árvores), conversa por Telegram e WhatsApp, resumo diário e lembretes no cron.

Sobe na porta **3000**. CORS está ligado. Documentação interativa: **[http://localhost:3000/api/docs](http://localhost:3000/api/docs)** (Swagger).

## O que o sistema faz

- **Metas:** `Goal` + `GoalSchedule` + `GoalReminder` na mesma transação de criação. Slots são o par (dia civil no fuso do usuário, `HH:mm`).
- **Lembretes:** policy avalia, claim grava, depois envia. Telegram/WhatsApp só entregam a mensagem; o pipeline de entrada fica em `inbound`. Detalhe do contrato: [`docs/superpowers/specs/2026-09-04-reminder-occurrence-contract.md`](docs/superpowers/specs/2026-09-04-reminder-occurrence-contract.md).
- **Jardim:** mundos SVG, âncoras, catálogo e árvores plantadas, eventos de crescimento, WebSocket (Socket.IO) para o front.
- **Auth:** JWT. `JWT_SECRET` é obrigatório (mínimo 16 caracteres), sem fallback de desenvolvimento.

## Stack

- NestJS 11, Prisma 5 + PostgreSQL
- OpenAI no orquestrador de conversa
- Telegram Bot API e WhatsApp via **Evolution**
- Storage S3-compatível (Garage) para assets; Supabase ainda entra no import legado de árvores
- Redis opcional (sessão / rate limit; sem `REDIS_URL` cai em memória)
- Luxon para fuso; Puppeteer / SVG.js no parsing de mundos

## Setup

```bash
npm install
npx prisma generate
npx prisma migrate deploy   # local: npx prisma migrate dev
```

Copie as variáveis para um `.env` na raiz (não commitar). O boot valida o schema em `src/config/env.validation.ts` e falha se o obrigatório faltar.

**Obrigatórias**

| Variável | Uso |
| --- | --- |
| `DATABASE_URL` | PostgreSQL |
| `JWT_SECRET` | Assinatura JWT (≥ 16 chars) |
| `OPENAI_API_KEY` | LLM da conversa |

**Opcionais úteis**

| Variável | Uso |
| --- | --- |
| `OPENAI_MODEL` | Default no Joi: `gpt-4o` |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME` | Bot Telegram |
| `EVOLUTION_BASE_URL`, `EVOLUTION_API_KEY` | Cliente Evolution |
| `EVOLUTION_WEBHOOK_PATH` | Default `/api/evolution/webhook` |
| `PUBLIC_BASE_URL` | URL pública (webhook / proxy de assets) |
| `WHATSAPP_NUMBER` | Número da instância |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` | Garage / S3 |
| `REDIS_URL` | Redis |
| `SUPABASE_URL`, `SUPABASE_KEY` | Import de catálogo / legado |
| `REMINDER_GROUP_WINDOW_MINUTES` | Cluster de follow-up/last-chance (não agrupa operacional na policy) |

O Joi ainda aceita nomes antigos `WUZAPI_*`; o código de WhatsApp usa **Evolution**.

## Rodar

```bash
npm run start          # uma vez
npm run start:dev      # watch
npm run build && npm run start:prod   # dist/src/main.js
```

## Testes

```bash
npm run test
npm run test:e2e
npm run test:cov
npm run typecheck
```

## HTTP (resumo)

Bearer JWT na maioria das rotas autenticadas. Lista completa e DTOs: `/api/docs`.

| Área | Rotas |
| --- | --- |
| Health | `GET /health` |
| Usuários | `POST /api/users`, `POST /api/users/login`, `GET /api/users/me`, `PATCH /api/users/me/current-world`, `GET /api/users/:id/telegram-linked`, `GET /api/users/:id/channels-linked` |
| Vínculo | `POST /api/users/link/generate`, `POST /api/users/link/telegram`, `POST /api/users/link/whatsapp`, `GET /api/users/link/bot-info` |
| Metas | `GET/POST /api/goals`, `GET/PATCH/DELETE /api/goals/:id` |
| Instâncias | `GET /api/goal-instances`, `POST /api/goal-instances/:id/complete` |
| Dashboard | `GET /api/dashboard?period=day\|week\|month&date=...` |
| Progresso | `GET /api/progress/week`, `/month`, `/streaks` |
| Áreas | `GET /api/areas` |
| Eventos | `GET/POST /api/events`, `GET/PATCH/DELETE /api/events/:id` |
| Guia | `GET /api/garden-guide/conversations`, mensagens `GET/POST .../conversations/:id/messages` |
| Mundos | SVG `GET/POST /api/worlds/:id/svg`, âncoras, `GET/DELETE /api/worlds/:id/trees`, import Supabase, planted-trees, progress/events |
| Assets | `GET /api/assets/*` (proxy/assinatura S3) |
| WhatsApp | `POST /api/evolution/webhook`, `GET /api/evolution/status`, `POST /api/whatsapp/webhook` |

## Estrutura

```
src/
├── auth/              # JWT
├── config/            # validação de env (Joi)
├── domain/types/      # ScheduleConfig, tipos de meta/conquista
├── filters/           # HTTP e Prisma
├── logging/
├── prisma/
├── storage/           # S3 / Garage
├── supabase/
├── main.ts
├── app.module.ts
└── modules/
    ├── areas/
    ├── daily-digest/
    ├── dashboard/
    ├── events/
    ├── goals/
    ├── ia/            # orquestrador e núcleos de conversa
    ├── inbound/       # pipeline após Telegram/WhatsApp
    ├── messaging/     # saída
    ├── progress/
    ├── reminder/      # policy, claim, planner, delivery
    ├── shared/
    ├── telegram/
    ├── users/
    ├── whatsapp/      # Evolution
    └── worlds/
```

Prisma: [`prisma/schema.prisma`](prisma/schema.prisma). Scripts extras: `migrate:schedule-at`, `migrate:tree-catalog-keys`, `s3:check-cors`, `s3:apply-cors`.
