import { LoggerService } from '@nestjs/common';

const LOG_CONTEXTS = new Set(['WhatsAppService', 'NestApplication']);

function isAllowed(context?: string): boolean {
  return Boolean(context && LOG_CONTEXTS.has(context));
}

function stringify(message: unknown): string {
  if (typeof message === 'string') return message;
  if (message instanceof Error) return message.message;
  try {
    return JSON.stringify(message);
  } catch {
    return String(message);
  }
}

export class AppLogger implements LoggerService {
  log(message: unknown, context?: string) {
    if (!isAllowed(context)) return;
    console.log(`[${context}] ${stringify(message)}`);
  }

  warn(message: unknown, context?: string) {
    if (!isAllowed(context)) return;
    console.warn(`[${context}] ${stringify(message)}`);
  }

  error(message: unknown, trace?: string, context?: string) {
    console.error(`[${context ?? 'App'}] ${stringify(message)}`);
    if (trace) console.error(trace);
  }

  debug() {}
  verbose() {}
}
