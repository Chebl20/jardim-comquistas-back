import { promises as fs } from 'fs';
import { join } from 'path';

const AUDIT_DIR = join(process.cwd(), 'logs');
const AUDIT_FILE = join(AUDIT_DIR, 'ai-audit.log');
const MAX_BYTES = Number(process.env.AI_AUDIT_MAX_BYTES || 5 * 1024 * 1024); // 5MB default

async function ensureDir(path: string) {
  try {
    await fs.mkdir(path, { recursive: true });
  } catch (e) {
    // ignore
  }
}

function maskValue(key: string, value: any) {
  if (value == null) return value;
  const s = String(value);
  // mask emails
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) return '[REDACTED_EMAIL]';
  // mask long digits (phones, tokens)
  if (/^\+?\d{6,}$/.test(s)) return '[REDACTED_PHONE_OR_ID]';
  // mask password-like
  if (/password|senha|token|secret|api[_-]?key/i.test(key)) return '[REDACTED]';
  // mask user ids (heuristic)
  if (key.toLowerCase().includes('userid') || key.toLowerCase().includes('telegram')) return '[REDACTED_ID]';
  // mask long texts exceeding 1000 chars
  if (s.length > 1000) return s.slice(0, 1000) + '...[TRUNCATED]';
  return s;
}

function maskEntry(entry: Record<string, any>) {
  const out: Record<string, any> = {};
  for (const k of Object.keys(entry)) {
    try {
      const v = entry[k];
      if (v && typeof v === 'object') {
        // shallow mask for nested objects
        out[k] = JSON.parse(JSON.stringify(v, (key, val) => (typeof val === 'string' ? maskValue(key, val) : val)));
      } else {
        out[k] = maskValue(k, v);
      }
    } catch (e) {
      out[k] = '[MASK_ERROR]';
    }
  }
  return out;
}

async function rotateIfNeeded() {
  try {
    const st = await fs.stat(AUDIT_FILE).catch(() => null);
    if (st && st.size >= MAX_BYTES) {
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const target = join(AUDIT_DIR, `ai-audit.${ts}.log`);
      await fs.rename(AUDIT_FILE, target).catch(() => null);
    }
  } catch (e) {
    // ignore rotation errors
  }
}

export async function logAiAudit(entry: Record<string, any>) {
  try {
    await ensureDir(AUDIT_DIR);
    await rotateIfNeeded();
    const safe = maskEntry(entry);
    const line = JSON.stringify({ ts: new Date().toISOString(), ...safe }) + '\n';
    await fs.appendFile(AUDIT_FILE, line, { encoding: 'utf8' });
  } catch (e) {
    // swallow audit errors
    // eslint-disable-next-line no-console
    console.warn('[AI AUDIT] failed to write audit log', e);
  }
}

export default logAiAudit;
