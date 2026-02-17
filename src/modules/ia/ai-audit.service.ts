import { promises as fs } from 'fs';
import { join } from 'path';

const AUDIT_FILE = join(process.cwd(), 'logs', 'ai-audit.log');

async function ensureDir(path: string) {
  try {
    await fs.mkdir(path, { recursive: true });
  } catch (e) {
    // ignore
  }
}

export async function logAiAudit(entry: Record<string, any>) {
  try {
    const dir = join(process.cwd(), 'logs');
    await ensureDir(dir);
    const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n';
    await fs.appendFile(AUDIT_FILE, line, { encoding: 'utf8' });
  } catch (e) {
    // swallow audit errors
    // eslint-disable-next-line no-console
    console.warn('[AI AUDIT] failed to write audit log', e);
  }
}

export default logAiAudit;
