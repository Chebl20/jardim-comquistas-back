import { looksLikeNewReminderOrGoalRequest } from './new-reminder-intent.util';

describe('new-reminder-intent.util', () => {
  it('detecta agendamento com horário', () => {
    expect(
      looksLikeNewReminderOrGoalRequest(
        'me lembre as 16:05 de mandar mensagem',
      ),
    ).toBe(true);
    expect(
      looksLikeNewReminderOrGoalRequest(
        'pode me lembrar de tomar remédio às 14h?',
      ),
    ).toBe(true);
  });

  it('detecta lembrete relativo', () => {
    expect(
      looksLikeNewReminderOrGoalRequest('me lembra de ler daqui a 10 minutos'),
    ).toBe(true);
  });

  it('não confunde com resposta de pausa ao lembrete', () => {
    expect(looksLikeNewReminderOrGoalRequest('não me lembre hoje')).toBe(false);
    expect(looksLikeNewReminderOrGoalRequest('só amanhã')).toBe(false);
    expect(looksLikeNewReminderOrGoalRequest('depois')).toBe(false);
  });

  it('não confunde com consulta de horário', () => {
    expect(looksLikeNewReminderOrGoalRequest('que horas são')).toBe(false);
  });
});
