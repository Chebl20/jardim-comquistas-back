import { Injectable, Logger } from '@nestjs/common';
import { NucleusInput, NucleusResult } from '../nucleus.interface';
import { DateTime } from 'luxon';
import { ConversationAIService } from '../../conversation-ai.service';
import { PROMPT as DATE_PROMPT } from '../date-extraction/prompt';

@Injectable()
export class DateExtractionNucleus {
  private readonly logger = new Logger(DateExtractionNucleus.name);

  public static PROMPT = DATE_PROMPT;

  constructor(private readonly llm: ConversationAIService) {}

  async analyze(input: NucleusInput): Promise<NucleusResult> {
    const text = (input.text || '').trim();
    const meta = input.meta || {};
    const tz = (meta.timezone as string) || 'UTC';
    const now = DateTime.now().setZone(tz);

    // 1) explicit HH:MM
    const mClock = text.match(/(\d{1,2}):(\d{2})/);
    if (mClock) {
      const h = parseInt(mClock[1], 10);
      const m = parseInt(mClock[2], 10);
      let dt = now.set({ hour: h % 24, minute: m, second: 0, millisecond: 0 });
      if (dt <= now) dt = dt.plus({ days: 1 });
      const iso = dt.toUTC().toISO();
      const payload = { reminderTime: iso };
      return { action: 'CREATE_GOAL', confidence: 0.9, extracted: { payload, missing: [] }, suggestedReply: `Entendi — vou programar para ${dt.toFormat('HH:mm')} no seu fuso (${tz}).` };
    }

    // 2) relative minutes/hours
    const mMin = text.match(/(?:em|daqui a)\s*(\d+)\s*min/);
    if (mMin) {
      const minutes = parseInt(mMin[1], 10);
      const dt = now.plus({ minutes });
      const iso = dt.toUTC().toISO();
      const payload = { reminderTime: iso, timeToken: `${minutes}_min` };
      return { action: 'CREATE_GOAL', confidence: 0.85, extracted: { payload, missing: [] }, suggestedReply: `Certo — daqui a ${minutes} minutos.` };
    }
    const mHour = text.match(/(?:em|daqui a)\s*(\d+)\s*(?:h|hora|horas)/i);
    if (mHour) {
      const hours = parseInt(mHour[1], 10);
      const dt = now.plus({ hours });
      const payload = { reminderTime: dt.toUTC().toISO(), timeToken: `${hours}_hour` };
      return { action: 'CREATE_GOAL', confidence: 0.8, extracted: { payload, missing: [] }, suggestedReply: `Beleza — daqui a ${hours} ${hours === 1 ? 'hora' : 'horas'}.` };
    }

    // 3) tomorrow keywords
    if (/amanh[aã]|amanha/i.test(text)) {
      let dt = now.plus({ days: 1 }).set({ hour: 9, minute: 0, second: 0, millisecond: 0 });
      const payload = { reminderTime: dt.toUTC().toISO(), timeToken: 'tomorrow' };
      return { action: 'CREATE_GOAL', confidence: 0.75, extracted: { payload, missing: [] }, suggestedReply: `Posso agendar para amanhã às ${dt.toFormat('HH:mm')}.` };
    }

    // 4) ambiguous: ask for clarification with controlled LLM
    try {
      const llmRes = await this.llm.analyze({ currentState: input.currentSession as any || 'IDLE', payload: input.meta || {}, userMessage: text }, DATE_PROMPT);
      // if LLM extracted a time, convert
      const extTime = llmRes.extracted?.time;
      if (extTime) {
        return { action: 'CREATE_GOAL', confidence: llmRes.confidence || 0.6, extracted: { payload: { reminderTime: extTime }, missing: [] }, suggestedReply: llmRes.suggestedReply };
      }
      return { confidence: llmRes.confidence || 0.3, suggestedReply: llmRes.suggestedReply, extracted: null };
    } catch (e) {
      this.logger.warn('LLM date extraction failed', e);
      return { confidence: 0.0, suggestedReply: 'Não consegui entender o horário. Pode informar no formato HH:MM?' };
    }
  }
}

export default DateExtractionNucleus;
