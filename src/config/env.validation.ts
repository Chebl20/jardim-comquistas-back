import * as Joi from 'joi';

/**
 * Schema de validação de variáveis de ambiente.
 * A aplicação falha na inicialização (fail-fast) se alguma variável
 * obrigatória estiver ausente ou com formato inválido.
 *
 * Adicione aqui toda nova env var que o sistema depender.
 */
export const envValidationSchema = Joi.object({
  // Banco de dados
  DATABASE_URL: Joi.string().required(),

  // Auth — sem fallback inseguro: a ausência deve causar erro na inicialização
  JWT_SECRET: Joi.string().min(16).required(),

  // OpenAI / LLM
  OPENAI_API_KEY: Joi.string().required(),
  OPENAI_MODEL: Joi.string().default('gpt-4o'),

  // Telegram
  TELEGRAM_BOT_TOKEN: Joi.string().optional(),
  TELEGRAM_BOT_USERNAME: Joi.string().optional(),

  // WhatsApp (Evolution API)
  WUZAPI_BASE_URL: Joi.string().uri().optional(),
  WUZAPI_TOKEN: Joi.string().optional(),
  WUZAPI_HMAC_KEY: Joi.string().optional(),

  // Storage S3-compatível
  S3_ENDPOINT: Joi.string().optional(),
  S3_REGION: Joi.string().optional(),
  S3_BUCKET: Joi.string().optional(),
  S3_ACCESS_KEY: Joi.string().optional(),
  S3_SECRET_KEY: Joi.string().optional(),

  // Supabase
  SUPABASE_URL: Joi.string().uri().optional(),
  SUPABASE_KEY: Joi.string().optional(),

  // URLs públicas
  PUBLIC_BASE_URL: Joi.string().uri().optional(),

  // Redis (opcional — fallback in-memory se ausente)
  REDIS_URL: Joi.string().optional(),

  // Reminder knobs (todos opcionais com defaults no código)
  REMINDER_GROUP_WINDOW_MINUTES: Joi.number().integer().min(1).optional(),
  CONVERSATION_SESSION_TTL_MIN: Joi.number().integer().min(1).optional(),
  RATE_LIMIT_MESSAGES_PER_MINUTE: Joi.number().integer().min(1).optional(),
}).options({ allowUnknown: true });
