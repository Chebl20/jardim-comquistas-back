# Guia de Criação de Núcleos

Este documento define o padrão oficial para criar novos núcleos no módulo de IA sem inflar o `ConversationOrchestratorService`.

## Regra de ouro

Um núcleo novo deve:

- interpretar a mensagem
- receber o contexto já preparado
- retornar `FlowResult`

Um núcleo novo não deve:

- persistir sessão
- decidir política global de routing
- executar efeitos colaterais diretamente
- crescer o orquestrador com regra específica de domínio

## Perguntas antes de criar um núcleo

Antes de começar, responda:

1. Isso é realmente um novo domínio conversacional?
2. Isso precisa de um novo `FlowState`?
3. Esse núcleo precisa de dados especiais além do contexto básico?
4. Ele reutiliza actions existentes ou precisa de uma action nova?

Se a resposta para a primeira pergunta for "não", provavelmente isso deve ser apenas um helper, service ou ajuste em um núcleo já existente.

## Checklist obrigatório

### 1. Criar a pasta do núcleo

Estrutura mínima:

```text
src/modules/ia/nuclei/<novo-nucleo>/
  index.ts
  prompt.ts
```

### 2. Implementar o contrato `Nucleus`

Todo núcleo deve implementar o contrato definido em `src/modules/ia/nuclei/nucleus.interface.ts`.

Template:

```ts
import { Injectable } from '@nestjs/common';
import { Nucleus, NucleusInput } from '../nucleus.interface';
import { FlowResult, DECISIONS } from '../../conversation/flow.types';

@Injectable()
export class MeuNovoNucleus implements Nucleus {
  async analyze(input: NucleusInput): Promise<FlowResult> {
    return {
      actions: [],
      decision: DECISIONS.HANDLED,
      confidence: 1,
    };
  }
}
```

### 3. Criar o prompt do núcleo

Use o padrão já adotado no projeto:

- `PromptSpec`
- `makePrompt(...)`
- `classificationLine(...)`

Evite prompt manual fora desse formato.

### 4. Adicionar o `FlowState` se o núcleo for um estado real

Arquivo:

- `src/modules/ia/conversation/flow.types.ts`

Exemplo:

```ts
export const FLOW_STATES = {
  CLARIFICATION: 'CLARIFICATION',
  GOAL_CREATION: 'GOAL_CREATION',
  GOAL_STATUS: 'GOAL_STATUS',
  REMINDER: 'REMINDER',
  MEU_NOVO_NUCLEO: 'MEU_NOVO_NUCLEO',
} as const;
```

### 5. Registrar no registry

Arquivo:

- `src/modules/ia/conversation/nucleus-registry.ts`

Exemplo:

```ts
MEU_NOVO_NUCLEO: MeuNovoNucleus,
```

### 6. Registrar no módulo Nest

Arquivo:

- `src/modules/ia/ai.module.ts`

Adicionar como provider.

### 7. Registrar no mapa de `flows`

Arquivo:

- `src/modules/ia/conversation/conversation-orchestrator.service.ts`

Adicionar o núcleo no mapa interno:

```ts
this.flows = {
  CLARIFICATION: this.clarification,
  GOAL_CREATION: this.goalCreation,
  GOAL_STATUS: this.goalStatus,
  REMINDER: this.reminderNucleus,
  MEU_NOVO_NUCLEO: this.meuNovoNucleus,
};
```

## Quando criar um MetaBuilder

Se o núcleo precisar de dados específicos, não coloque essa lógica no orquestrador.

Crie um builder em:

```text
src/modules/ia/conversation/meta/
```

Exemplo:

```text
goal-review-meta.builder.ts
```

Ele deve implementar o contrato:

- `src/modules/ia/conversation/meta/nucleus-meta.builder.ts`

Depois registre o builder em:

- `src/modules/ia/conversation/meta/nucleus-meta.factory.ts`

### Regra

Se a particularidade é "quais dados esse núcleo precisa", isso pertence ao builder.

Não pertence ao orquestrador.

## Quando mexer na política de routing

Arquivo:

- `src/modules/ia/conversation/flow-routing-policy.service.ts`

Mexa aqui apenas se o novo núcleo precisar de:

- mensagem de ack própria
- regra de threshold própria no futuro
- comportamento especial de fallback

### Regra

Se a particularidade é "como o sistema decide entrar nesse núcleo", isso pertence à policy.

Não pertence ao núcleo em si.

## Quando mexer no router

Arquivo:

- `src/modules/ia/nuclei/router/index.ts`

Mexa aqui quando o LLM puder retornar variações de nome para o novo núcleo.

Exemplo:

```ts
const mapping: Record<string, FlowState> = {
  meunovonucleo: FLOW_STATES.MEU_NOVO_NUCLEO,
  review: FLOW_STATES.MEU_NOVO_NUCLEO,
};
```

## Quando criar uma action nova

Antes de criar action nova, veja se dá para reutilizar:

- `reply`
- `continue`
- `redirect`
- `create_goal`
- `cancel`
- `mark_done`

Se realmente precisar de uma nova action:

1. adicionar em `src/modules/ia/conversation/flow.types.ts`
2. adicionar suporte em `src/modules/ia/conversation/conversation-action-executor.service.ts`
3. testar o fluxo completo

### Regra

Action nova só existe quando o sistema precisa executar um novo efeito colateral real.

## O que não fazer

- Não colocar `if (state === X)` novo no orquestrador para regra de domínio.
- Não fazer o núcleo salvar dados diretamente.
- Não fazer o núcleo conhecer Telegram, sessão ou banco.
- Não duplicar lógica de histórico em transporte e orquestrador.
- Não criar prompt fora do padrão `PromptSpec`.

## Fluxo mental correto

Use esta divisão:

- núcleo: interpreta
- meta builder: prepara contexto
- routing policy: decide entrada e ack
- action executor: executa efeitos
- orchestrator: coordena

## Exemplo de adição saudável

Se amanhã surgir um núcleo `GOAL_REVIEW`, o caminho ideal é:

1. criar `src/modules/ia/nuclei/goal-review/index.ts`
2. criar `src/modules/ia/nuclei/goal-review/prompt.ts`
3. adicionar `GOAL_REVIEW` em `flow.types.ts`
4. registrar em `nucleus-registry.ts`
5. registrar em `ai.module.ts`
6. registrar em `this.flows`
7. criar `goal-review-meta.builder.ts` se precisar de contexto especial
8. registrar aliases no router se necessário
9. mexer na policy apenas se precisar de ack específico

## Checklist final antes de considerar pronto

- O núcleo implementa `Nucleus`
- O prompt segue `PromptSpec`
- O estado foi registrado
- O registry foi atualizado
- O módulo foi atualizado
- O mapa `flows` foi atualizado
- O builder de meta foi criado se necessário
- O router foi atualizado se necessário
- A policy foi atualizada se necessário
- Não foi adicionada regra de domínio no orquestrador
- O projeto compila

## Resumo em uma frase

Quando surgir um núcleo novo, a regra é simples:

coloque a inteligência no núcleo, os dados no builder, a política no routing, a execução no executor e mantenha o orquestrador pequeno.
