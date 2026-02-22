import { Injectable } from '@nestjs/common';
import { NucleusInput, NucleusResult } from '../nuclei/nucleus.interface';

@Injectable()
export class RecoveryNucleus {
  async analyze(input: NucleusInput): Promise<NucleusResult> {
    const text = (input.text || '').toString().trim();
    const safe = text.length > 0 ? ` (mensagem: "${text.replace(/"/g, '\\"')}")` : '';
    const prompt = `Desculpe, não entendi. Pode enviar novamente, por favor?${safe}`;
    return { confidence: 0, suggestedReply: prompt, stopPropagation: true };
  }
}

export default RecoveryNucleus;
