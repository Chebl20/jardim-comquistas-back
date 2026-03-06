# Fase 1 – Mapeamento Completo dos Núcleos

> Início imediato do processo de fortalecimento solicitado pelo engenheiro.

## 1. Identificação de núcleos existentes
O código `src/modules/ia/nuclei` contém as seguintes classes exportadas como núcleos:

- `ClarificationNucleus`  
- `GoalCreationNucleus`  
- `GoalStatusNucleus`  
- `ReminderNucleus`  
- `RouterNucleus` (encaminhador, tratado de forma especial)

Não há nenhuma classe ou arquivo chamado `GoalListing`; portanto, o conjunto atual não inclui um núcleo explicitamente com esse nome.

## 2. Nome técnico exato de cada núcleo

| Nome da classe           | Estado associado | Comentário           |
|--------------------------|------------------|----------------------|
| ClarificationNucleus     | `CLARIFICATION` (também usado como `IDLE`) | núcleo universal de conversação |
| GoalCreationNucleus      | `GOAL_CREATION`  | criação de metas      |
| GoalStatusNucleus        | `GOAL_STATUS`    | consulta/estado de metas |
| ReminderNucleus          | `REMINDER`       | geração de lembretes  |
| RouterNucleus            | (nenhum estado)  | roteador, não registrado como fluxo |

## 3. Estado associado a cada núcleo
Já listado acima; o `RouterNucleus` não mapeia para um FlowState porque ele atua apenas internamente no orquestrador.

## 4. Responsabilidade declarada atual
Responsabilidades fixadas no código e nos prompts:

- **Clarification**: conversas gerais, pequenas dúvidas, apresentação/ajuda, detectar ``new_intent`` e indicar início de fluxo.
- **GoalCreation**: extrair e validar atributos de uma nova meta, sinalizar quando pronta ou quando cancelar.
- **GoalStatus**: responder perguntas sobre o progresso das metas existentes, usando dados de árvores.
- **Reminder**: compor mensagens de lembrete motivacionais e, se solicitado pelo LLM, emitir ação ``mark_done``.
- **Router**: escolher o fluxo adequado com base em texto/ contexto; não responde ao usuário.

## 5. Ambiguidades iniciais detectadas

- A instrução do engenheiro menciona ``GOAL_LISTING`` como primeiro alvo de endurecimento, mas nenhum núcleo com esse nome existe. O mais próximo é ``GoalStatusNucleus`` que trata de consultas sobre metas; consideraremos este último como o candidato lógico para a fase 4.
- O ``ClarificationNucleus`` é deliberadamente amplo e pode sobrepor-se a qualquer outro núcleo se este retornar ``not_my_job`` tardio, mas essa amplitude é intencional e deve ser tratada com cuidado nos prompts.

---

> **Próximos passos**: com o mapeamento concluído, a Fase 2 será iniciada em cada núcleo na ordem especificada. O primeiro núcleo alvo será *GoalStatus (interpretação de GoalListing)*, conforme a prioridade definida.

Os demais núcleos serão auditados em sequência: `ReminderNucleus`, `GoalCreationNucleus` e por último `ClarificationNucleus`. O roteador permanece inalterado.  

*Documento gerado em 2026‑03‑02 às 04:23 UTC.*
