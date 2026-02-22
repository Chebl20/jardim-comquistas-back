import { Injectable } from '@nestjs/common';
import { PROMPT as SMALLTALK_PROMPT } from './prompt';
import { NucleusInput, NucleusResult } from '../nucleus.interface';
import { DateTime } from 'luxon';

@Injectable()
export class SmallTalkNucleus {
  public static PROMPT = SMALLTALK_PROMPT;

  async analyze(input: NucleusInput): Promise<NucleusResult> {
    const text = (input.text || '').trim().toLowerCase();
    const tz = (input.meta?.timezone as string) || 'UTC';
    // greetings
    if (/(oi|olá|ola|bom dia|boa tarde|boa noite)/i.test(text)) {
      return { confidence: 0.9, suggestedReply: 'Oi! Como posso te ajudar com suas metas hoje?' };
    }
    // thanks
    if (/(obrigad|valeu|brigad)/i.test(text)) {
      return { confidence: 0.9, suggestedReply: 'Disponha! 😊' };
    }
    // ask time
    if (/que horas|horas são|que horas são|que horas tem/i.test(text)) {
      const now = DateTime.now().setZone(tz);
      return { confidence: 0.95, suggestedReply: `Agora são ${now.toFormat('HH:mm')} (${tz}).` };
    }
    // persona / capability questions
    if (/(quem\s*(é|e)\s*(você|voce|vc)|quem\s*é\s*tu)/i.test(text)) {
      return {
        confidence: 0.98,
        suggestedReply:
          'Eu sou seu assistente do Jardim das Conquistas — posso ajudar a criar e lembrar suas metas, listar metas ativas e guiar você no uso do serviço. Pergunte "Como você pode me ajudar" para exemplos.'
      };
    }
    if (/(o que\s*(você|voce|vc)\s*(pode fazer|faz)|como\s*(voce|você)\s*(pode|pode me)\s*ajudar|como\s*(voce|você)\s*me\s*ajudar)/i.test(text)) {
      return {
        confidence: 0.97,
        suggestedReply:
          'Posso: 1) Criar metas (ex: "Ler 30 minutos às 20:00"), 2) Lembrar você no horário definido, 3) Listar metas ativas. Diga "Criar meta" para começarmos.'
      };
    }

    return { confidence: 0.4, suggestedReply: 'Entendi.' };
  }
}

export default SmallTalkNucleus;
