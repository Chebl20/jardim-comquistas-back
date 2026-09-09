/**
 * Estrutura canônica de agendamento de metas/lembretes.
 * Regra de formato:
 *   - once.at  → ISO completo (momento absoluto)
 *   - daily/weekly/monthly.times → HH:mm (horário do dia no fuso do usuário)
 *
 * Este é o único lugar onde ScheduleConfig é definido; todos os outros módulos
 * importam daqui em vez de redefinir ou importar de ia/conversation/flow.types.
 */
export type ScheduleConfig =
  | { type: 'once'; at: string }
  | { type: 'daily'; times: string[]; durationDays?: number }
  | { type: 'weekly'; daysOfWeek: number[]; times: string[] }
  | { type: 'monthly'; dayOfMonth: number; times: string[] };

/**
 * Type guard para ScheduleConfig. Valida estrutura mínima e tipos de elementos.
 * Fonte única de verdade — usado por goal-creation, schedule-formatter e outros.
 */
export function isValidScheduleConfig(obj: unknown): obj is ScheduleConfig {
  if (!obj || typeof obj !== 'object') return false;
  const o = obj as Record<string, unknown>;
  const type = o.type;
  if (type === 'once') return typeof o.at === 'string';
  if (type === 'daily') {
    if (!Array.isArray(o.times) || !o.times.every((t) => typeof t === 'string'))
      return false;
    if (
      o.durationDays !== undefined &&
      (typeof o.durationDays !== 'number' || o.durationDays < 1)
    )
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
