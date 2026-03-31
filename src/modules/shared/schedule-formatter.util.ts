/**
 * Formata scheduleConfig para exibição visual ao usuário (tabelas, dias da semana, horários).
 * Usado pelo GoalCreation na confirmação e pelo GoalStatus ao listar metas.
 */

export type ScheduleConfig =
  | { type: 'once'; at: string }
  | { type: 'daily'; times: string[]; durationDays?: number }
  | { type: 'weekly'; daysOfWeek: number[]; times: string[] }
  | { type: 'monthly'; dayOfMonth: number; times: string[] };

const DAY_NAMES = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
// Ordem para tabela: Seg primeiro (padrão pt-BR)
const TABLE_DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

function isValidScheduleConfig(obj: unknown): obj is ScheduleConfig {
  if (!obj || typeof obj !== 'object') return false;
  const o = obj as Record<string, unknown>;
  const type = o.type;
  if (type === 'once') return typeof o.at === 'string';
  if (type === 'daily') {
    if (!Array.isArray(o.times) || !o.times.every((t) => typeof t === 'string')) return false;
    if (o.durationDays !== undefined && (typeof o.durationDays !== 'number' || o.durationDays < 1))
      return false;
    return true;
  }
  if (type === 'weekly')
    return (
      Array.isArray(o.daysOfWeek) &&
      o.daysOfWeek.every((d) => typeof d === 'number') &&
      Array.isArray(o.times) &&
      o.times.every((t) => typeof t === 'string')
    );
  if (type === 'monthly')
    return (
      typeof o.dayOfMonth === 'number' &&
      Number.isInteger(o.dayOfMonth) &&
      o.dayOfMonth >= 1 &&
      o.dayOfMonth <= 31 &&
      Array.isArray(o.times) &&
      o.times.every((t) => typeof t === 'string')
    );
  return false;
}

/**
 * Formata data ISO para exibição em pt-BR (ex: "10 de março às 14:00").
 */
function formatDateForDisplay(iso: string, timezone = 'America/Sao_Paulo'): string {
  try {
    const date = new Date(iso);
    const formatter = new Intl.DateTimeFormat('pt-BR', {
      timeZone: timezone,
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
    });
    return formatter.format(date);
  } catch {
    return iso;
  }
}

/**
 * Formata scheduleConfig em texto visual para o cliente.
 * Retorna tabela de dias da semana (para weekly) ou resumo simples (daily/once).
 *
 * @param scheduleConfig - Objeto scheduleConfig do UserGoal
 * @param goalTitle - Título da meta (opcional, para personalizar a mensagem)
 * @param timezone - Timezone do usuário para formatação de datas
 */
export function formatScheduleForUser(
  scheduleConfig: unknown,
  goalTitle?: string,
  timezone = 'America/Sao_Paulo',
): string {
  if (!isValidScheduleConfig(scheduleConfig)) {
    return '';
  }

  const titleLine = goalTitle ? `📅 Quando vou te lembrar de "${goalTitle}":\n\n` : '📅 Quando vou te lembrar:\n\n';

  if (scheduleConfig.type === 'once') {
    const dateStr = formatDateForDisplay(scheduleConfig.at, timezone);
    return `${titleLine}Lembrete único:\n  ${dateStr}`;
  }

  if (scheduleConfig.type === 'daily') {
    const { times, durationDays } = scheduleConfig;
    const colWidth = 6;
    const labelWidth = 10;
    const pad = (s: string, w: number) => s.padEnd(w).slice(0, w);

    if (durationDays && durationDays > 1) {
      const now = new Date();
      const formatter = new Intl.DateTimeFormat('pt-BR', {
        timeZone: timezone,
        day: 'numeric',
        month: 'short',
      });
      const timeHeaders = times.map((t) => pad(String(t), colWidth)).join(' ');
      const rows: string[] = [];
      for (let i = 0; i < durationDays; i++) {
        const d = new Date(now);
        d.setUTCDate(d.getUTCDate() + i);
        const dayLabel = `Dia ${formatter.format(d)}`;
        const row = times.map(() => pad('✅', colWidth)).join(' ');
        rows.push(`${pad(dayLabel, labelWidth)} ${row}`);
      }
      return `${titleLine}               ${timeHeaders}\n${rows.join('\n')}`;
    }

    if (times.length > 1) {
      const timeHeaders = times.map((t) => pad(String(t), colWidth)).join(' ');
      const row = times.map(() => pad('✅', colWidth)).join(' ');
      return `${titleLine}               ${timeHeaders}\n${pad('Todo dia', labelWidth)} ${row}`;
    }
    const timesStr = times[0] || '—';
    return `${titleLine}Lembrete diário:\n  ${timesStr} — todo dia`;
  }

  if (scheduleConfig.type === 'weekly') {
    const { daysOfWeek, times } = scheduleConfig;
    const colWidth = 5;
    const timeWidth = 10;
    const pad = (s: string, w: number) => s.padEnd(w).slice(0, w);
    const dayHeaders = TABLE_DAY_ORDER.map((d) => pad(DAY_NAMES[d], colWidth)).join(' ');
    const timeRows = times
      .map((t) => {
        const cells = TABLE_DAY_ORDER.map((d) => {
          const mark = daysOfWeek.includes(d) ? '✅' : '—';
          return pad(mark, colWidth);
        }).join(' ');
        return `${pad(String(t), timeWidth)}  ${cells}`;
      })
      .join('\n');
    return `${titleLine}               ${dayHeaders}\n${timeRows}`;
  }

  if (scheduleConfig.type === 'monthly') {
    const { dayOfMonth, times } = scheduleConfig;
    const timesStr = times.length > 1 ? times.join(' e ') : times[0] || '—';
    return `${titleLine}Todo mês no dia ${dayOfMonth}:\n  ${timesStr}`;
  }

  return '';
}

/**
 * Retorna um resumo curto do schedule (ex: "todo dia às 08:00 e 20:00" ou "seg, qua, sex às 09:00").
 * Útil para listagem no GoalStatus.
 */
export function formatScheduleSummary(
  scheduleConfig: unknown,
  timezone = 'America/Sao_Paulo',
): string {
  if (!isValidScheduleConfig(scheduleConfig)) {
    return '';
  }

  if (scheduleConfig.type === 'once') {
    return formatDateForDisplay(scheduleConfig.at, timezone);
  }

  if (scheduleConfig.type === 'daily') {
    const timesStr = scheduleConfig.times.length > 1
      ? scheduleConfig.times.join(' e ')
      : scheduleConfig.times[0] || '—';
    if (scheduleConfig.durationDays) {
      return `${scheduleConfig.durationDays} dias às ${timesStr}`;
    }
    return `todo dia às ${timesStr}`;
  }

  if (scheduleConfig.type === 'weekly') {
    const daysStr = scheduleConfig.daysOfWeek
      .sort((a, b) => a - b)
      .map((d) => DAY_NAMES[d])
      .join(', ');
    const timesStr = scheduleConfig.times.length > 1
      ? scheduleConfig.times.join(' e ')
      : scheduleConfig.times[0] || '—';
    return `${daysStr} às ${timesStr}`;
  }

  if (scheduleConfig.type === 'monthly') {
    const timesStr = scheduleConfig.times.length > 1
      ? scheduleConfig.times.join(' e ')
      : scheduleConfig.times[0] || '—';
    return `dia ${scheduleConfig.dayOfMonth} de cada mês às ${timesStr}`;
  }

  return '';
}
