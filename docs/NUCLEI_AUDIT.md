# Núcleos IA – Auditoria de Domínio

Este documento responde ao questionário profundo solicitado pelo engenheiro, analisando cada núcleo existente e o router. As respostas baseiam-se no código (`src/modules/ia/nuclei/**`) e nos prompts que orientam o LLM.

---

## 1️⃣ Identidade e delimitação de domínio

**Núcleos atuais**
- `ClarificationNucleus` – estado `CLARIFICATION` e também usado como `IDLE`.
- `GoalCreationNucleus` – estado `GOAL_CREATION`.
- `GoalStatusNucleus` – estado `GOAL_STATUS`.
- `ReminderNucleus` – estado `REMINDER`.
- `RouterNucleus` – recebe histórico e texto, decide o próximo estado; não faz parte do registry como "estado" mas está no fluxo.

**Descrição formal de cada domínio**
- **Clarification**: conversa geral, apresentação do assistente, entrada de ajuda, lidar com entradas inválidas, detectar intenções iniciais e transferi-las. Não deve criar ou modificar metas; limite claramente definido no prompt.
- **GoalCreation**: extrair ou perguntar campos para montar uma nova meta (título, tipo, conquista, horário, etc.). Deve continuar o processo até ter todas as informações e só então finalizar com `finished:true`. Não salva nem modifica nada, apenas retorna payload. Cancela quando o usuário pede.
- **GoalStatus**: responde perguntas sobre o estado das metas já criadas (avaliação de crescimento das árvores, sugestões). Não altera dados e não faz perguntas abertas.
- **Reminder**: gerar texto motivacional/lembratório; opcionalmente emite `mark_done` se LLM classifica como "done". Não sincroniza com banco, apenas produz conteúdo.
- **Router**: classificador que escolhe entre os estados acima com base no texto e contexto; nunca responde diretamente ou altera sessão.

**Documentação escrita da fronteira**
- Os prompts de cada núcleo contêm longas seções de definição de domínio e limites. O Clarification tem cláusulas explicitas de quando devolver `notMyJob`; GoalCreation lista campos obrigatórios e quando não pertence ao domínio; Reminder e Router também incluem regras de saída.

**Sobreposição entre núcleos**
- Clarification e GoalCreation podem se sobrepor em mensagens genéricas de criação de meta; o router/ordem de execução previne conflitos (cant handle caso de Clarification ao detectar `CREATE_GOAL` racks). `GoalStatus` também poderia ver perguntas genéricas sobre metas, mas se a frase não mencionar "status" ou algo similar provavelmente cairá em Clarification. A delimitação é razoável.

**Núcleo genérico demais?**
- Clarification é inevitavelmente genérico, pois absorve quase qualquer mensagem não mapeada. Isso está intencional, mas torna-o muito amplo.

**Dependências semânticas**
- Nenhum núcleo chama outro; eles apenas analisam e retornam ações. Clarification pode emitir `redirect` que o orquestrador transforma em mudança de estado, mas isso é fluxo, não dependência.

**Núcleo "quase router"**
- Clarification contém lógica para detectar `new_intent` e direcionar para `GOAL_CREATION`, mas não escolhe entre vários destinos — apenas um. Não executa redirecionamento genérico.

**Responde perguntas fora de domínio?**
- GoalCreation tenta responder apenas durante o fluxo de criação; se recebe algo muito fora de escopo, ele define `notMyJob` ou `small_talk`. É raro fora de escopo ser tratado erroneamente, mas prompts o instruem explicitamente a devolver `notMyJob` em vários casos.

**Domínio descoberto não coberto**
- Não há núcleo explícito para conversas sobre configuração de mundo, ajuda técnica, etc. Esses caem no Clarification, que pode saturar.

**Núcleo raramente ativado**
- `GoalStatus` pode ser pouco acionado em uso real, pois as conversas principais envolvem criação e lembretes. Estatísticas reais ainda não foram medidas.

---

## 2️⃣ Prompt de cada núcleo

### Clarification
- **Definição de domínio**: presente nas primeiras linhas e seção de objetivo; claramente declara que não deve criar/modificar metas.
- **Definição do que NÃO é domínio**: "Limite: Este núcleo NÃO cria, salva ou modifica metas..." e instruções para marcar `notMyJob` nessas situações.
- **Exemplos positivos/negativos**: vários exemplos JSON no final, incluindo novos intents e small_talk vs invalid_input.
- **Quando retornar not_my_job**: instruído nas regras e no comportamento adicional (spam, nonsense, repetição). Template explica uso de flag `notMyJob` nas respostas de erro.
- **Quando retornar uncertain**: não explicitamente; Clarification tende a sempre handled, não há regra de uncertain no prompt.
- **Como definir confidence**: pede número 0‑1, mas não dá regras de cálculo.
- **Não redirecionar**: não menciona explicitamente "não pode redirecionar" porque Clarification, por design, nunca usa redirect; mas claramente não há lógica de roteamento (exceto new_intent->redirect para GOAL_CREATION, que é permitido).
- **Não alterar state**: implícito; foco em conversação.
- **Proíbe assumir domínio de outro núcleo**: várias notas sobre marcar `notMyJob` se mensagem for sobre criação/alteração de metas.

### GoalCreation
- **Domínio definido**: enuncia no topo e na estrutura do prompt. Regras 1‑7 detalham comportamento exclusivo para criação.
- **Domínio negado**: regras finais e exemplos mostram `notMyJob` quando fora do contexto; a nota sobre nonsense e repetição força `notMyJob` também.
- **Exemplos positivos/negativos**: vários JSON incluindo começo de meta, confirmação, cancelamento e comportamento de defensiva com nonsense.
- **not_my_job**: explicitamente solicitado quando a mensagem for fora do fluxo ou nonsense; instruções adicionais para repetir e marcar notMyJob depois de dois fails.
- **uncertain**: o prompt usa classification que pode ser "uncertain"; mas não dá critérios estritos.
- **Confidence**: pede valor 0‑1 no formato; mas sem regra de cálculo.
- **Sem redirecionar/alterar state/assumir domínio**: instruções proíbem persistência de dados, portanto nenhum redirecionamento ou alterações de state.

### GoalStatus
- Prompt pequeno e direto; define domínio e tom. Não há seções explicitando o que não faz, mas por omissão não menciona redirecionar, etc.
- Exemplos não existem no texto; não há menção a `notMyJob` ou `uncertain`—a lógica no código trata `notMyJob` se o LLM sinalizar.

### Reminder
- Prompt descreve gerar lembretes motivacionais e quando adicionar `mark_done`. Não detalha limites de domínio além de ser sobre lembretes/goal-done.
- Não há exemplos negativos ou instruções de notMyJob; o código simplesmente deixa essa decisão no LLM (`if llmRes.notMyJob`).
- Não há menção a states ou redirecionamento.

### Router
- Prompt define explicitamente que não conversa com o usuário e deve responder apenas com JSON {target,confidence}.
- Lista os núcleos possíveis e diz para encaminhar para `clarification` em casos de confusão. Não há exemplos negativos: ele já é puramente roteador.
- Não menciona notMyJob, uncertain, etc – não aplicável.

---

## 3️⃣ Decision e confidence

- **GoalCreation**: a decisão entre `handled` e `uncertain` baseia-se na classification gerada pelo LLM (`continue|cancel|new_intent|small_talk|invalid_input|uncertain`). Regras 2‑7 e exemplos orientam o modelo. É subjetivo, mas o prompt dá critérios para `cancel` e acostuma a usar `finished` e `missing`. O `confidence` é repassado diretamente do LLM sem ajuste.
- **Clarification**: nunca retorna `not_my_job`; a distinção handled/uncertain não existe (sempre handled). Confidence vem direto do LLM. Não há critério interno para uncertain.
- **GoalStatus**: default é handled; se LLM colocar `notMyJob` a serviço devolve not_my_job. Não há uncertain logic. Confidence vindo do LLM também sem regra.
- **Reminder**: decision é `not_my_job` se LLM notMyJob flag; caso contrário handled. No classification, os bots internamente não usam handled/uncertain; nada de uncertain. Confidence originário do LLM.
- **Router**: não retorna decision, apenas target + confidence. Decision e confidence do router não influenciam além de threshold 0.5 e validação; se menor, fallback para CLARIFICATION. O threshold 0.5 está no orquestrador.

Observações:
- Nenhum núcleo calcula confiança objetivamente; todos a catam do LLM. Nem existe um threshold interno (exceto orquestrador pós‑checada). Alguns núcleos (e.g. Clarification) ignoram confidence completamente.
- **Algum núcleo sempre retorna confidence alto?** Não intrínseco; depende da LLM.
- **Algum nunca retorna not_my_job?** Clarification e GoalStatus no código podem, mas Clarification nunca o faz (ignora flag). GoalStatus pode. Reminder pode.
- **Confiança influencia lógica posterior?** Somente para roteamento (se <0.5, orquestrador força CLARIFICATION). Ninguém mais usa confidence.
- **Análise estatística**: não há código de métricas, mas o orchestrator tests don't measure rates.

---

## 4️⃣ Capacidades e ações

- **Clarification**: ações `reply`, `cancel`, `redirect`. A `redirect` só vai para `GOAL_CREATION` com payload; não há outra ação. Não altera domainMetadata. A action `cancel` existe para pedir cancelamento de rota, mas Clarification decide; ação executada separadamente no orquestrador. O núcleo não executa side effects.
- **GoalCreation**: actions `reply`, `continue`, `cancel`, `create_goal`. `create_goal` é interpretada pelo orquestrador para chamar serviço -- não executada pelo núcleo. Não depende de estado anterior; o payload pode ter missing fields mas isso é explicitado. A estrutura de ação separa decisão (analyze) da execução (orquestrador); se a criação falhar no orquestrador/serviço, orquestrador trataria, não o núcleo.
- **GoalStatus**: apenas `suggestedReply` (reply action criado pelo orquestrador e enviado). Não há efeitos.
- **Reminder**: `reply` e possivelmente `mark_done`. O mark_done é condicional e declarado claramente no código. Evento externo é o envio de mensagem pelo service (executado separadamente). Se o action falha (por exemplo, mark_done sem goalId válidos), a orquestrador/service deve tratar.
- **Router**: nenhuma action.

Nenhum núcleo altera `domainMetadata`. As actions são separadas da decisão pelo orquestrador. A execução de `create_goal` e `mark_done` pode falhar, mas a lógica de orquestrador lida com catch e logs.

---

## 5️⃣ Histórico e contexto

- Todos os prompts usam `withContext` (clarification, goal-creation, reminder, router) o que concatena o histórico (via helper `prompt-utils.ts`). Esse helper injeta até as últimas três mensagens e possivelmente `domainMetadata`. Portanto, **os núcleos recebem todo o histórico**.
- Alguns prompts instruem a limitar aos últimos 3 entradas (Clarification) ou a usar `recentMessages` (GoalCreation). O LLM pode ser confundido por histórico longo; a arquitetura tenta evitar ruído ao truncar.
- **Interpreta role assistant**: os prompts frequentemente não mencionam explicitamente os papéis, mas o helper `withContext` preserva role fields; por isso o modelo vê interações anteriores de assistente e usuário. Não há garantia explícita sobre uso, mas o modelo geralmente terá contexto.
- **Ignora mensagens irrelevantes?** Cabe ao modelo. Prompt Clarification menciona `recentMessages` e `userGoals` para evitar repetições. Não há filtro automático.
- **DomainMetadata**: o `payload` é enviado inteiro e pode conter `lastBotOrigin`, pendências etc. Nenhum núcleo parece usar esse campo explicitamente exceto verificações no orquestrador (e.g., `reminder` nucleus generically uses `meta` but not domainMetadata). Então está disponível, mas não usado de forma expressa nos prompts.
- **Assume estado implícito?** Os prompts recebem `state` e `payload` mas não instruem o modelo a basear-se nele para decições de domínio.
- **Histórico longo**: não há teste se confunde.

---

## 6️⃣ Fronteira com Router

- Os núcleos recebem prompts que instruem a retornar `notMyJob` em várias situações (GoalCreation, GoalStatus, Reminder). Clarification é o menos focado aqui porque ele nunca devolve notMyJob.
- **Não forçar resposta**: GoalCreation e Reminder têm instruções claras para abandonar se não for domínio; a lógica de `notMyJob` é enfatizada em GoalCreation.
- **Casos observados**: sem telemetria não sabemos, mas o código de orquestrador inclui várias verificações (re-rota se `not_my_job`). O test contract cobriu que segundo `not_my_job` dispara clarificação.
- **Tendência absorver genéricos**: Clarification absorve perguntas genéricas (intencional). GoalCreation tende a recusar spam ou nonsense com `notMyJob`. Router se destina a desfazer isso.
- **Perguntas meta**: Clarification contém exemplos explicando o funcionamento do sistema, portanto responde perguntas meta; GoalCreation e Reminder deveriam devolver `notMyJob` para essas mensagens.
- **Tentativas de autoridade**: nenhum núcleo age como orquestrador; apenas Clarification explica o fluxo quando usuário pergunta. Nenhum núcleo devolve regras do sistema (além do prompt de Clarification instruindo a explicar como funciona).
- **Confidence alto para domínio errado**: possível se LLM estiver enganado; não há mitigação além de threshold no orquestrador.

---

## 7️⃣ Casos de borda

- **Mensagem vazia**: não há tratamento explícito, mas o LLM provavelmente classificará como `invalid_input` ou similar. Prompt GoalCreation sugere resposta de desculpas e possivelmente `notMyJob` se repetido.
- **Mensagem ambígua**: **GoalCreation** tem `uncertain` classification para perguntas incompletas (lista missing). Clarification absorve e pede reformulação. Reminder/GoalStatus ficam no fluxo.
- **Mudança abrupta de assunto**: Orchestrator pode mandar para Router se nucleus respondeu `not_my_job` ou `uncertain`? No segundo caso router não é chamado. Um núcleo poderia retornar `not_my_job` e permitir rerouter.
- **Pedir algo fora de escopo**: deve resultar em `notMyJob` ou classification apropriada. Ex.: usuário pedindo receita de bolo deve ir para Clarification -> small_talk.
- **Respostas ilegais**: não observadas no código, mas os prompts de GoalCreation tratam nonsense convertendo para `invalid_input` e `notMyJob`.
- **Violação de contrato**: tests cobrem alguns como `not_my_job` with actions throwing error. Nenhum núcleo devolve decision inconsistente no código, embora LLM possa.
- **Handled sem capacidade real**: se LLM responde handled com payload vazio, orquestrador irá executar actions e possivelmente nada acontecer.
- **Uncertain mas não domínio**: semelhante a above; possivelmente Clarification ou Router revisam.

---

## 8️⃣ Maturidade do especialista

- **Clarification**: linguagem acolhedora e variada, bastante detalhado no prompt; parece especialista em conversa e filosofia do assistente.
- **GoalCreation**: prompt altamente técnico, com campos e regras claras; demonstra profundidade no domínio de metas e validações. Respostas tendem a ser estruturadas e etapas definidas.
- **GoalStatus**: menos formal, baseado em observação de níveis de árvore; não dá muitos detalhes técnicos, mas é suficiente para o domínio.
- **Reminder**: especialista em mensagens motivacionais, inclui lógica de marcação de conclusão. O prompt foca em variação e tom do lembrete.
- **Personalidade**: Clarification e Reminder têm personalidade mais calorosa; GoalCreation é funcional, GoalStatus é conversacional.
- **Consistência de tom**: os prompts asseguram tom apropriado para cada domínio. Nenhum núcleo extrapola ou promete mais do que controla.

---

## 9️⃣ Performance real

- Até o momento não há métricas implementadas no código. O único teste estatístico agregado é o `orchestrator.contract.spec.ts` que verifica cenários de roteamento e conflito.
- **Taxa de not_my_job/uncertain**: desconhecida; precisaria de logs ou contadores em produção.
- **Núcleo pouco usado**: `GoalStatus` possivelmente.
- **Núcleo dominante**: Clarification serve como fallback; em situações de confusão ele provavelmente domina.
- **Router redirecionando para o mesmo núcleo**: orquestrador protege contra isso e força clarificação.
- **Necessidade de divisão/fusão**: nada evidente em análise; mas o Clarification poderia ser dividido entre "ajuda" e "small talk" se o volume crescesse.
- **Eliminação de núcleos**: dificil remover Clarification; outros são úteis.

---

## 🎯 Pergunta final crítica

1. **Sem Router hoje** o fluxo ficaria muito dependente de cada núcleo para sinalizar `not_my_job`. Clarification absorveria a maioria dos casos e, desde que cada núcleo devolva `not_my_job` corretamente, eles manteriam fronteiras razoáveis. Entretanto, o router simplifica a lógica de fallback e evita muita lógica no orquestrador; removê-lo exigiria reintroduzir redirecionamento manual em cada núcleo.

2. **Duplicar número de núcleos**: fronteiras claras dependeriam de prompts muito bem elaborados. Já o Clarification é amplo, então novos núcleos deveriam definir limites bem estritos para não serem consumidos por Clarification. É plausível, porém exigiria disciplina na escrita de prompts e possivelmente monitoramento de taxas de not_my_job.

3. **"Muleta arquitetural"**: Clarification age um pouco como tal, pois absorve ambiguidades e serve como catch-all. Ele é necessário, mas também uma área de risco se crescer demais.

4. **Responsabilidades em uma frase**:
   - Clarification: resolver conversas gerais e encaminhar quando houver intenção de metas.
   - GoalCreation: extrair dados para criar uma nova meta.
   - GoalStatus: informar sobre o progresso das metas existentes.
   - Reminder: gerar textos de lembrete e marcar conclusão quando apropriado.
   - Router: decidir qual núcleo deve processar a mensagem.

5. **Novo engenheiro**: com a documentação existente (`IA-MODULE-DETAILS.md`, prompts) e este arquivo, ele provavelmente entenderia as fronteiras se dedicar alguns minutos. A exigência de contratos formais e testes auxilia bastante.

---

## Conclusão

A arquitetura modular de núcleos está bem delineada. O maior risco é a amplitude do `ClarificationNucleus`, que precisa ser monitorado para evitar que ele engula sinais que deveriam ir a outros módulos. Prompts robustos e testes de contrato proporcionam uma boa base para expansão. 

Recomenda‑se adicionar métricas de uso e taxas de `not_my_job`/`uncertain` para validar empiricamente os limites de cada especialista.

---

*Gerado automaticamente em 2026‑03‑02 como parte da auditoria recomendada.*
