/**
 * Retorna emoji apropriado para meta baseado em conquestType ou título.
 * Usado em GoalStatus, DailyDigest e Reminder.
 */
const GOAL_EMOJIS: Record<string, string> = {
  Corpo: '🏃',
  Mente: '🧠',
  Família: '👨‍👩‍👧',
  Trabalho: '💼',
  Saúde: '❤️',
  Espiritual: '🙏',
  Financeiro: '💰',
  Hobby: '🎨',
  Lazer: '🎮',
  Água: '💧',
};

export function pickGoalEmoji(conquestType?: string, title?: string): string {
  if (conquestType) {
    const ct = String(conquestType);
    for (const [key, emoji] of Object.entries(GOAL_EMOJIS)) {
      if (ct.toLowerCase().includes(key.toLowerCase())) return emoji;
    }
  }
  if (title) {
    const t = title.toLowerCase();
    if (t.includes('remédio') || t.includes('remedio') || t.includes('medicamento')) return '💊';
    if (t.includes('ler') || t.includes('leitura')) return '📚';
    if (t.includes('treinar') || t.includes('correr') || t.includes('exercício')) return '🏃';
    if (t.includes('água') || t.includes('beber')) return '💧';
    if (t.includes('estudar') || t.includes('estudo') || t.includes('história') || t.includes('historia')) return '📖';
    if (t.includes('cozinha') || t.includes('cozinhar')) return '🍳';
  }
  return '📌';
}
