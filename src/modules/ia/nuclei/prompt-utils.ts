// helper utilities for building nucleus prompts consistently

import { CLASSIFICATIONS, Classification, DECISIONS, Decision } from '../conversation/flow.types';

// basic building blocks for a standardized prompt structure
export interface PromptSection {
  title: string;
  lines: string[];
}

export interface PromptSpec {
  domain: PromptSection;
  objective: PromptSection;
  ioSchema: PromptSection;
  behaviour?: PromptSection;
  examples: PromptSection;
}

export type PromptBuilder = (state: string, payload: any) => string;

// expand template placeholders such as {CLASSIFICATIONS.SMALL_TALK}
function expandTemplates(text: string): string {
  return text.replace(/\{CLASSIFICATIONS\.([A-Z_]+)\}/g, (_, key) => {
    const val = (CLASSIFICATIONS as any)[key];
    return val !== undefined ? String(val) : `{CLASSIFICATIONS.${key}}`;
  });
}

// helper that returns a line containing classification options
export function classificationLine(...values: Classification[]): string {
  return `"classification": "${values.join('|')}"`;
}

// internally combine the sections into a single string with separators
function buildPrompt(spec: PromptSpec): string {
  const formatSection = (sec: PromptSection) =>
    [`// --- ${sec.title} ---`, ...sec.lines.map(expandTemplates), ''].join('\n');

  const parts: PromptSection[] = [spec.domain, spec.objective, spec.ioSchema];
  if (spec.behaviour) parts.push(spec.behaviour);
  parts.push(spec.examples);

  return parts.map(formatSection).join('\n');
}

// append runtime context (state + payload) to a base prompt string
export function withContext(
  basePrompt: string,
  state: string,
  payload: any,
): string {
  return `${basePrompt}\n\nEstado atual: ${state}\nPayload atual: ${JSON.stringify(payload || {})}`;
}

// factory producing a PromptBuilder from a spec
export function makePrompt(spec: PromptSpec): PromptBuilder {
  const base = buildPrompt(spec);
  return (state: string, payload: any) => withContext(base, state, payload);
}

// Utilitário padrão: mapeia classification retornada pelo LLM para a Decision
// de domínio. Garante que todos os núcleos sigam o mesmo contrato.
export function decisionFromClassification(classification: string): Decision {
  if (classification === CLASSIFICATIONS.NEW_INTENT) return DECISIONS.NOT_MY_JOB;
  if (classification === CLASSIFICATIONS.UNCERTAIN) return DECISIONS.UNCERTAIN;
  return DECISIONS.HANDLED;
}
