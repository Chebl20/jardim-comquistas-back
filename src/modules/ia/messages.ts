/**
 * Centraliza todas as mensagens do sistema para facilitar manutenção e variações.
 * Aqui ficam mensagens fixas, variações e templates para respostas.
 */

export const MESSAGES = {
  // Lembretes
  REMINDERS: [
    "Ei {name}, hora de trabalhar na sua meta: \"{title}\". Você consegue! 💪",
    "Olá {name}! Lembrete para \"{title}\". Vamos fazer acontecer hoje?",
    "{name}, não esqueça: \"{title}\" te espera. Um passo de cada vez!",
    "Oi {name}, é hora de \"{title}\". Estou aqui para te apoiar!",
    "{name}, lembre-se da sua meta: \"{title}\". Vamos juntos nessa!",
  ],

  // Respostas simples (operacionais)
  TIME_RESPONSE: "Agora são {time}.",
  MARK_DONE_SUCCESS: "Bom trabalho{comma} {name}! Progresso registrado.",
  RESCHEDULE_SUCCESS: "Tudo bem{comma} {name}, vamos reagendar para amanhã.",
  ABANDON_SUCCESS: "Entendi{comma} {name}. Vamos pausar essa meta.",

  // Mensagens de erro ou fallback
  GENERIC_ERROR: "Ops, algo deu errado. Tente novamente.",

  // Mensagens de confirmação
  PROGRESS_REGISTERED: "Progresso registrado com sucesso.",

  // Templates
  WAITING_MESSAGE: "Ei {name}, estou aguardando você cumprir \"{title}\". Vamos lá! 💪",
};

/**
 * Substitui placeholders na mensagem.
 * @param message Mensagem com placeholders como {name}, {title}
 * @param replacements Objeto com substituições
 * @returns Mensagem formatada
 */
export function formatMessage(message: string, replacements: Record<string, string>): string {
  let formatted = message;
  for (const [key, value] of Object.entries(replacements)) {
    formatted = formatted.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
  }
  return formatted;
}

/**
 * Escolhe uma mensagem aleatória de uma lista.
 * @param messages Lista de mensagens
 * @returns Mensagem aleatória
 */
export function randomMessage(messages: string[]): string {
  return messages[Math.floor(Math.random() * messages.length)];
}