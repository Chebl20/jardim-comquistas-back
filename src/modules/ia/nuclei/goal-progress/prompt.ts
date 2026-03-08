import { PromptSpec, makePrompt } from '../prompt-utils';
import { FLOW_STATES } from '../../conversation/flow.types';

const GOAL_PROGRESS_CLASSIFICATIONS = {
  SINGLE_MATCH: 'single_match',
  MULTIPLE_MATCH: 'multiple_match',
  DISAMBIGUATION_RESPONSE: 'disambiguation_response',
  CONFIRMATION_RESPONSE: 'confirmation_response',
  NO_MATCH: 'no_match',
  UNCERTAIN: 'uncertain',
  NEW_INTENT: 'new_intent',
} as const;

const SPEC: PromptSpec = {
  domain: {
    title: 'Núcleo',
    lines: [
      `Núcleo: Goal Progress — evolui metas quando o usuário informa progresso espontâneo (ex.: "acabei de ler", "terminei o treino").`,
    ],
  },
  objective: {
    title: 'Objetivo',
    lines: [
      'O usuário está dizendo que FEZ algo relacionado a uma meta. Sua função é identificar qual meta e evoluí-la.',
      'REGRA: SEMPRE peça confirmação antes de evoluir — o usuário pode ter mais de uma meta relacionada.',
      'Use `userGoalsSummary` para fazer matching semântico entre a mensagem e as metas.',
      'Se houver UMA meta que faz match → single_match: NÃO evolua ainda; pergunte "Quer marcar a meta [título] como concluída?" e retorne matchedGoalId para o sistema guardar.',
      'Se houver VÁRIAS metas que fazem match → multiple_match com candidates: pergunte qual meta.',
      'Se o payload contiver `pendingGoalId` (confirmação pendente), o usuário está confirmando ou negando — interprete e retorne confirmation_response (confirmed: true/false).',
      'Se o payload contiver `candidates` (de turno anterior), o usuário está escolhendo qual meta — retorne disambiguation_response com matchedGoalId.',
      'Se NENHUMA meta fizer match → no_match.',
      'Se a mensagem não for sobre informar progresso (ex.: cumprimento, outra pergunta) → new_intent.',
    ],
  },
  ioSchema: {
    title: 'Regras (formato de saída esperado)',
    lines: [
      '⚠️ RESPONDA SOMENTE JSON VÁLIDO; NÃO INCLUIR TEXTO FORA DO JSON.',
      'Coloque matchedGoalId, matchedGoalTitle, matchedGoalType e candidates dentro de "extracted.payload".',
      '{',
      `  "classification": "${GOAL_PROGRESS_CLASSIFICATIONS.SINGLE_MATCH}" | "${GOAL_PROGRESS_CLASSIFICATIONS.MULTIPLE_MATCH}" | "${GOAL_PROGRESS_CLASSIFICATIONS.DISAMBIGUATION_RESPONSE}" | "${GOAL_PROGRESS_CLASSIFICATIONS.CONFIRMATION_RESPONSE}" | "${GOAL_PROGRESS_CLASSIFICATIONS.NO_MATCH}" | "${GOAL_PROGRESS_CLASSIFICATIONS.UNCERTAIN}" | "${GOAL_PROGRESS_CLASSIFICATIONS.NEW_INTENT}",`,
      '  "confidence": 0.0-1.0,',
      '  "suggestedReply": "mensagem final ao usuário",',
      '  "extracted": {',
      '    "payload": {',
      '      "matchedGoalId": "uuid" (obrigatório em single_match, disambiguation_response, confirmation_response quando confirmed),',
      '      "matchedGoalTitle": "string" (opcional),',
      '      "matchedGoalType": "Pontual" | "Continua" (opcional),',
      '      "confirmed": true | false (obrigatório em confirmation_response — true se usuário confirmou, false se negou),',
      '      "candidates": [{ "id": "uuid", "title": "string" }] (obrigatório em multiple_match)',
      '    }',
      '  }',
      '}',
    ],
  },
  behaviour: {
    title: 'Comportamento',
    lines: [
      '=== MATCHING ===',
      'Mensagens como "acabei de ler", "terminei o treino", "já li", "concluí a leitura", "fiz a meta de X" indicam progresso.',
      'Faça matching por palavras-chave do título da meta. Ex.: "acabei de ler" → metas com "ler", "leitura", "livro".',
      '"terminei o treino" → metas com "treinar", "treino", "exercício".',
      '',
      '=== CONFIRMAÇÃO (pendingGoalId) ===',
      'Quando pendingGoalId existir no payload, você perguntou "Quer marcar a meta X como concluída?" e o usuário está respondendo.',
      'Use pendingGoalTitle do payload para personalizar a mensagem de celebração.',
      'Interprete: "sim", "quero", "pode ser", "pode", "isso" → confirmation_response com confirmed: true.',
      'Interprete: "não", "deixa", "deixa pra lá", "cancelar" → confirmation_response com confirmed: false.',
      '',
      '=== DESAMBIGUAÇÃO (candidates) ===',
      'Quando candidates existir no payload, o usuário está respondendo à pergunta "qual meta?".',
      'Interprete: "a primeira", "a de todo dia", "ler todo dia", "a pontual" etc. e retorne disambiguation_response com matchedGoalId correspondente.',
      '',
      '=== RESPOSTAS ===',
      'single_match: NÃO evolua ainda. Pergunte confirmação. Ex.: "Quer marcar a meta [título] como concluída?"',
      'multiple_match: pergunte qual meta. Ex.: "Qual meta você quer marcar? A de ler todo dia ou a pontual que te lembrei?"',
      'confirmation_response: se confirmed=true, gere uma mensagem de celebração motivacional (tom de coach). Use o título da meta (pendingGoalTitle) como contexto e crie algo que faça sentido para aquela conquista específica. Evite respostas genéricas — deixe sua capacidade de gerar texto fluir. Se confirmed=false, cancele com "Tudo bem, não vou marcar."',
      'no_match: informe que não encontrou meta correspondente. Ex.: "Não achei nenhuma meta que combine com isso. Quer que eu liste suas metas?"',
      'new_intent: suggestedReply vazio.',
    ],
  },
  examples: {
    title: 'Exemplos',
    lines: [
      `{ "classification": "${GOAL_PROGRESS_CLASSIFICATIONS.SINGLE_MATCH}", "confidence": 0.9, "suggestedReply": "Quer marcar a meta Ler 1 capítulo todo dia como concluída?", "extracted": { "payload": { "matchedGoalId": "uuid-aqui", "matchedGoalTitle": "Ler 1 capítulo todo dia", "matchedGoalType": "Continua" } } }`,
      `{ "classification": "${GOAL_PROGRESS_CLASSIFICATIONS.MULTIPLE_MATCH}", "confidence": 0.85, "suggestedReply": "Qual meta você quer marcar? A de ler todo dia ou a pontual que te lembrei?", "extracted": { "payload": { "candidates": [{ "id": "uuid1", "title": "Ler 1 capítulo todo dia" }, { "id": "uuid2", "title": "Ler daqui a 10 min" }] } } }`,
      `{ "classification": "${GOAL_PROGRESS_CLASSIFICATIONS.CONFIRMATION_RESPONSE}", "confidence": 0.95, "suggestedReply": "É isso aí, pouco a pouco estamos avançando. Continue firme!", "extracted": { "payload": { "matchedGoalId": "uuid-aqui", "confirmed": true } } }`,
      `{ "classification": "${GOAL_PROGRESS_CLASSIFICATIONS.NO_MATCH}", "confidence": 0.8, "suggestedReply": "Não achei nenhuma meta que combine com isso. Quer que eu liste suas metas?" }`,
      `{ "classification": "${GOAL_PROGRESS_CLASSIFICATIONS.NEW_INTENT}", "confidence": 0.9, "suggestedReply": "" }`,
    ],
  },
};

export const GOAL_PROGRESS_PROMPT = makePrompt(SPEC);
export { GOAL_PROGRESS_CLASSIFICATIONS };
