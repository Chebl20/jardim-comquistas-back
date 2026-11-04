import {
  looksPortuguese,
  parseDailyNoteText,
  soundsLikeReport,
} from './phrases';

describe('parseDailyNoteText', () => {
  it('aceita reflection e care válidos em português', () => {
    const result = parseDailyNoteText(
      {
        reflection: 'Hoje cabe ir com calma.',
        care: 'Reserve alguns minutos para respirar.',
      },
      true,
      [],
    );
    expect(result).toEqual({
      reflection: 'Hoje cabe ir com calma.',
      care: 'Reserve alguns minutos para respirar.',
    });
  });

  it('retorna care null quando allowCare é false', () => {
    const result = parseDailyNoteText(
      {
        reflection: 'Presença também conta.',
        care: 'Faça algo simples.',
      },
      false,
      [],
    );
    expect(result).toEqual({
      reflection: 'Presença também conta.',
      care: null,
    });
  });

  it('rejeita texto em inglês', () => {
    const result = parseDailyNoteText(
      {
        reflection: 'The goal for today is to rest.',
        care: null,
      },
      false,
      [],
    );
    expect(result).toBeNull();
  });

  it('rejeita quando reflection cita termo proibido', () => {
    const result = parseDailyNoteText(
      {
        reflection: 'Lembre de cuidar da Meditar de manhã.',
        care: null,
      },
      false,
      ['Meditar de manhã'],
    );
    expect(result).toBeNull();
  });
});

describe('soundsLikeReport', () => {
  it('detecta linguagem de relatório', () => {
    expect(soundsLikeReport('Sua meta ainda não foi feita.', [])).toBe(true);
    expect(soundsLikeReport('O jardim floresceu hoje.', [])).toBe(true);
  });

  it('detecta título de meta na frase', () => {
    expect(soundsLikeReport('Foque no Beber água.', ['Beber água'])).toBe(true);
  });
});

describe('looksPortuguese', () => {
  it('aceita frase com acento ou palavra comum', () => {
    expect(looksPortuguese('Hoje é um dia tranquilo.')).toBe(true);
    expect(looksPortuguese('Voce pode ir devagar.')).toBe(true);
  });
});
