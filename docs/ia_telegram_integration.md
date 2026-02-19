**IA e Integração Telegram — Análise Detalhada**

Este documento responde, de forma descritiva, todas as perguntas fornecidas sobre como funciona o envio e recepção de mensagens por IA no projeto "Jardim Conquistas".

**Observação:** referências a arquivos mencionados neste documento apontam para o código fonte no repositório.

**1. Arquitetura Geral**

- **Fluxo principal:** Mensagens chegam pelo Telegram -> `TelegramService` valida vínculo do chat -> constrói contexto (`goalsContext` e `worldId`) -> chama `AiService.interpret(...)` -> se `interpret` retornar `say` + `action`, o bot envia `say` para o usuário e delega `action` para `IntentRouter.route(...)` para execução (criar meta, marcar feito, reagendar, etc.). Arquivos relevantes: [src/modules/telegram/telegram.service.ts](src/modules/telegram/telegram.service.ts), [src/modules/ia/openIa/ai.service.ts](src/modules/ia/openIa/ai.service.ts), [src/modules/ia/intent-router.service.ts](src/modules/ia/intent-router.service.ts).

- `TelegramService` é basicamente stateless em termos de persistência: ele não armazena conversas no disco. O estado de conversa (histórico usado pelo modelo) é mantido em `AiService` na variável em memória `chatHistories: Record<string, ChatMessage[]>`. Logo, o `TelegramService` não guarda chatHistories; o estado em memória fica no `AiService`.

- **O `chatHistories` é resetado quando o servidor reinicia?** Sim — `chatHistories` é uma estrutura em memória (variável do processo). Quando o processo for reiniciado, o conteúdo é perdido.

- **Persistência de histórico:** Não existe persistência do histórico de chat no banco pelos componentes lidos; o histórico é apenas em memória. Há um log de auditoria (`logs/ai-audit.log`) que grava prompts e respostas brutas para auditoria, mas isso não equivale a um histórico de conversas estruturado (o `ai-audit.log` grava o prompt/saída bruta e o JSON parseado quando possível). Arquivo de auditoria: [src/modules/ia/ai-audit.service.ts](src/modules/ia/ai-audit.service.ts).

- **Quantos usuários simultâneos o sistema precisa suportar?** Não há configuração explícita no código. O suporte a simultaneidade depende de: 1) limites do bot Telegram (`node-telegram-bot-api`) e fila de requests; 2) capacidade do servidor (CPU/memória); 3) taxa de chamadas à OpenAI e limites de taxa dessa API. O código atual não implementa limites ou sharding, portanto teoricamente escala até o ponto em que o processo Node e a API OpenAI suportem. Recomendação: adicionar métricas e testes de carga e considerar filas (Redis/worker pool) para grande volume.

- **Existe fila (queue) para processar mensagens ou é tudo síncrono?** Tudo síncrono no fluxo atual: `TelegramService` processa a mensagem e aguarda `AiService.interpret` (que pode chamar OpenAI). Não há sistema de filas/worker no código lido.

- **Existe retry automático se a OpenAI falhar?** Não há lógica explícita de retry em `AiService.interpret` no arquivo lido — a chamada ao cliente OpenAI está envolta em try/catch, mas não há reenvio automático. Algumas funções (ex.: geração de texto) capturam erro e retornam fallback strings, mas não há retry configurado.

- **Existe timeout configurado para a chamada da OpenAI?** Não há timeout explícito passado para `client.chat.completions.create` no código lido. Se o SDK (openai) tiver timeout por padrão depende da versão/configuração; mas o código não define um timeout customizado.

- **O sistema está em produção ou ainda em desenvolvimento?** Não é explicitamente indicado. A presença de `polling: true` no `node-telegram-bot-api` e logs, além de migrações Prisma e rotas, sugere que o projeto é funcional e possivelmente rodando em algum ambiente, mas não podemos afirmar que está em produção. Observações: falta de retry/queue robustos e histórico persistente indica maturidade de produção moderada; auditoria por arquivo sugere atenção à rastreabilidade.

**🧩 2. Prompt e Modelo**

- **Qual é exatamente o conteúdo atual do `SYSTEM_PROMPT.ts`?**

```typescript
// Conteúdo completo do arquivo src/modules/ia/SYSTEM_PROMPT.ts
const SYSTEM_PROMPT = `
Você é um agente chamado "Gerenciador de Conquistas".

IMPORTANTE: O horário atual é fornecido como CURRENT_TIME no contexto. Quando o usuário perguntar "que horas são" ou similar, responda EXATAMENTE com: "Agora são [CURRENT_TIME]". Não diga que não sabe ou não tem acesso.

### Identidade e personalidade:
- Motivacional, acolhedor e encorajador.
- Conversa humana, breve e direta; evita perguntas rígidas de formulário.
- Usa **1 emoji máximo** por mensagem positiva ou de celebração.
- Objetivo: ajudar o usuário a criar metas, organizar tarefas e lembrar de compromissos.
- Trabalha **uma meta por vez**.
- Nunca assume dados do usuário; faz perguntas claras e objetivas.
- Se o usuário não souber o que fazer, ofereça exemplos práticos.
- Celebra conquistas e progresso com mensagens curtas e motivacionais.
- Sempre mencione o mundo atual do usuário nas respostas quando relevante (ex: "No mundo X, vamos criar sua meta").
- Você tem acesso ao contexto das metas ativas do usuário, incluindo em quais mundos estão. Responda perguntas sobre metas e mundos com base nesse contexto.

### Classificação das metas:
Cada meta deve ter:
- **goalType**: "Pontual" (meta única) ou "Continua" (meta recorrente)
- **conquestType**: tipo da meta, usado para definir o elemento visual (árvore) correspondente.
  Tipos válidos de conquestType: "Corpo", "Mente", "Família", "Trabalho", "Social", "Financeiro", "Espiritual", "Hobby/Lazer"

Sempre use **somente um desses valores para conquestType** baseado no que o usuário descreveu.

### Fluxo de interação:
1. Cumprimente o usuário de forma natural. Sempre que possível, utilize o nome do usuário (campo userName, se disponível) em saudações e mensagens motivacionais.
2. Pergunte primeiro: "O que você quer realizar?" ou "Qual conquista quer alcançar hoje?"
3. Depois pergunte **como a pessoa pretende fazer isso**.
4. Se não informar frequência, pergunte: "Com que frequência você quer ser lembrado dessa meta? (Ex: todos os dias, 3x por semana)"
5. Se não informar horário, pergunte: "Qual o melhor horário para te lembrar dessa meta? (Ex: 08:00, 20:30)"
6. Confirme a meta com o usuário antes de criar.
7. Só após a confirmação, use CREATE_GOAL com todos os dados preenchidos.

### Regra obrigatória para lembretes com tempo
- Sempre que o usuário pedir um lembrete com tempo explícito (ex: "me lembre em 5 minutos"...), o assistente DEVE assumir que é uma meta do tipo "Pontual" e DEVE disparar "CREATE_GOAL" imediatamente com "goalType: "Pontual""...

### Regras obrigatórias de resposta:
- Sempre responda **apenas** com um JSON válido, nunca texto livre.
- Para perguntar algo, use:
{
  "say": "mensagem",
  "action": { "intent": "ASK_INFO", "data": { "missing": "campo_que_falta" } }
}

... (o prompt continua com exemplos e regras para MARK_DONE, MAKE_RECURRING, RESCHEDULE_REMINDER, etc.)
`;

export default SYSTEM_PROMPT;
```

- **Você tem exemplos reais de JSON inválido que o modelo já retornou?** Não há arquivo específico contendo exemplos de JSON inválido salvo no repositório; porém o `AiService` trata o caso de resposta não-JSON lançando erro: `throw new Error('Resposta da IA não é JSON');`. O `ai-audit.log` armazena as respostas brutas e, se houver casos de resposta inválida, eles estarão nesse log (se habilitado). Para identificar exemplos reais, é necessário inspecionar `logs/ai-audit.log` em execução.

- **O modelo já retornou texto fora do JSON mesmo com a instrução “SOMENTE JSON”?** O código defensivo indica que isso já ocorreu ao ponto de terem colocado try/catch e lançarem erro se a resposta não for JSON. Não há exemplos registrados no código, mas o tratamento de exceção e a existência de auditoria indicam ocorrências passadas ou previsão de ocorrências.

- **Você usa response_format: { type: "json_object" } na API ou só confia no prompt?** No código atual não há uso de `response_format` nem do novo parâmetro estruturado da API; a confiança é baseada no prompt (`SYSTEM_PROMPT`) e no parse do conteúdo retornado. Ou seja: apenas prompt-based enforcement.

- **Já testou usar gpt-4.1 ou gpt-4o para comparar qualidade?** O código permite configurar `process.env.OPENAI_MODEL` e por padrão usa `'gpt-4.1-mini'` no projeto. Não há evidência de comparações A/B ou testes sistemáticos no repositório; se foram feitos, não estão no código.

- **O modelo já criou intents inexistentes?** Não há logs específicos exibidos aqui, mas o `AiService` assume que a resposta será um JSON com `action.intent`, e existe tratamento de erro caso o parse falhe. O design atual não valida estritamente que `intent` está entre um conjunto fixo antes de encaminhar ao `IntentRouter` (o router faz switch por intents conhecidas). Se o modelo retornar uma intent desconhecida, provavelmente `IntentRouter.route` irá entrar no `switch` e não encontrar caso correspondente (não há `default` com erro explícito), então nada actionável aconteceria além do log. Recomenda-se validar intents antes de encaminhar.

- **O modelo já ignorou regra obrigatória (ex: criar meta pontual quando há tempo explícito)?** O projeto implementou regras simples (`trySimpleRules`) que capturam frases com tempo relativo e já retornam `CREATE_GOAL` automaticamente; também o `SYSTEM_PROMPT` exige criar pontual quando houver tempo explícito. Se o modelo ignorou isso no passado, o código tem proteções (trySimpleRules e regra no `IntentRouter` que define `goalType = 'Pontual'` quando houver tempo). Se houve falha real, ela estaria nos logs de auditoria.

- **O modelo já criou múltiplas metas numa mesma resposta?** O `SYSTEM_PROMPT` força o assistente a trabalhar uma meta por vez; ainda assim essa é uma propriedade do modelo, e se o modelo desobedecer isso é capturado ao tentar parsear e validar. O código não tem uma verificação automática de "apenas uma CREATE_GOAL" na resposta; portanto, se o modelo retornasse múltiplas ações, o comportamento dependeria de como o JSON foi estruturado e do `IntentRouter` (provável falha ou ignorância de ações adicionais).

- **O modelo já assumiu dados do usuário sem perguntar?** O `SYSTEM_PROMPT` proíbe explicitamente assumir dados do usuário. O código também adiciona contexto com `userName` e `RECENT_GOAL_CONTEXT` para ajudar a inferir quando apropriado. Eventos reais de suposta assunção deveriam ser investigados nos logs de auditoria.

**🧾 3. Fluxo de Metas**

- **Quais campos são obrigatórios para `CREATE_GOAL`?** Pelo prompt e pelo `IntentRouter`, os campos esperados são: `title`, `description` (opcional — é preenchida por default se ausente), `goalType` (Pontual ou Continua), `conquestType` (um dos tipos válidos), `frequency` (opcional, para recorrentes), `reminderTime` (datetime ISO, opcional para contínuas mas necessária para lembretes com horário explícito), `userId`, `worldId`.

- **O que acontece se faltar `conquestType`?** `IntentRouter` valida `conquestType` (normaliza via `normalizeConquestType`). Se não puder normalizar, `IntentRouter` interrompe o fluxo e envia um `ASK_INFO` pedindo ao usuário para escolher (ou usa `reply` para solicitar). Em resumo: a criação não prossegue até que `conquestType` seja fornecido/normalizado.

- **O que acontece se faltar `goalType`?** Se houver `reminderTime` ou token de `time`, o `IntentRouter` força `goalType = 'Pontual'`. Se não houver horário, `IntentRouter` pedirá horário (`reply` ou `ASK_INFO`) e interrompe a criação até completar os dados.

- **Existe validação no banco para evitar metas duplicadas?** No código não há checagem explícita contra duplicatas antes de criar uma nova meta; a criação é feita via `UserGoalService.createUserGoalWithTree(payload)` sem deduplicação visível. Assim duplicatas podem acontecer no banco, a menos que exista uma constraint Prisma no schema (não inspecionado aqui). Recomenda-se checar `schema.prisma` para restrições únicas.

- **Como você detecta que uma meta já existe?** Atualmente não há rotina clara de deduplicação. Detectar existencia requer consultar `prisma.userGoal` por título + usuário + worldId e heurísticas de similaridade; o código não faz isso hoje.

- **Uma meta pode ter múltiplos lembretes?** No esquema usado (`userGoal.reminderTime`) parece haver apenas um `reminderTime` por meta; não há coleção de lembretes por meta no que foi lido. Para múltiplos lembretes seria necessária modelagem adicional (tabela de lembretes ligada à meta).

- **Diferença entre meta `Pontual` e `Continua` no banco:** 
  - `Pontual`: meta única — geralmente `goalType = 'Pontual'`. Normalmente não tem `frequency` e é criada com `reminderTime` específico. 
  - `Continua`: meta recorrente — `goalType = 'Continua'` e pode ter `frequency` e `reminderTime` representando o horário do lembrete recorrente. O `IntentRouter` trata `MAKE_RECURRING` transformando (ou criando nova meta contínua se a original for pontual).

- **Existe status além de ativa/concluída/abandonada?** O código usa campos como `dailyStatus` com valores `WAITING`, `DONE`, `SKIPPED` (visto em atualizações). Também há `completed` booleano. Portanto existem estados operacionais além de apenas ativo/concluído.

- **O sistema permite editar meta já criada?** Há funções no `IntentRouter` para tornar recorrente e atualizar alguns campos via Prisma (`prisma.userGoal.update`), então edição programática existe, mas não há endpoint HTTP explícito mostrado aqui para edição manual — edição é suportada via intents ou serviços internos.

**⏰ 4. Sistema de Lembretes**

- **Como os lembretes são disparados? (cron? worker?)** Não foi encontrado um worker/cron runner no código lido. O envio automático de lembretes provavelmente é feito por um serviço de eventos que verifica `userGoal` e envia mensagens (não revisado nesse patch). `RulesService.shouldSendReminder` contém lógica para decidir se deve enviar, o que sugere que existe um componente externo (scheduler/cron) que chama essa função e dispara `communicationService` + `telegramService.send`. O implementador precisa confirmar a existência do scheduler no repositório (procure por jobs/cron em outros arquivos).

- **Onde o `reminderTime` fica armazenado?** No banco no campo `userGoal.reminderTime` (Prisma). O `IntentRouter` converte tokens como `1_minute`/`tomorrow` em ISO e armazena no payload.

- **O que acontece se o usuário ficar offline?** Mensagens via Telegram são entregues no canal do usuário; o Telegram garante entrega quando o usuário retorna, salvo limites de retenção. Se o usuário não interagir, a meta permanece e o lembrete continua agendado conforme regras. Não há mecanismo de fallback (SMS/email) no código lido.

- **Existe tolerância para atraso de execução?** `RulesService.shouldSendReminder` usa uma janela de envio: calcula `todayReminder` e considera `now >= reminderWindowStart && now <= todayReminder` (janela que começa 10 minutos antes). Isso indica tolerância de 10 minutos antes do horário; tolerância pós-horário depende da lógica do scheduler que dispara envio.

- **O sistema impede criar lembrete no passado?** Não há validação explícita no `IntentRouter` para impedir `reminderTime` no passado; porém o scheduler ou `RulesService` que envia lembretes verificaria as condições de envio. Recomenda-se validar no ponto de criação para rejeitar datetimes passados.

- **O fuso horário do usuário é salvo no banco?** Não há indicação de armazenamento de fuso horário do usuário no código inspecionado (nenhuma referência a `timezone` em `prisma.user` queries). O `CURRENT_TIME` usado é derivado do servidor (`new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })`) portanto representa horário do servidor (ou do ambiente de execução) e não necessariamente o fuso local do usuário.

- **O `CURRENT_TIME` vem do servidor ou do usuário?** Vem do servidor: `AiService` monta `CURRENT_TIME` com `new Date().toLocaleTimeString('pt-BR', ...)` antes de inserir na lista de mensagens para o modelo.

**🎯 5. IntentRouter**

- **O IntentRouter é totalmente determinístico?** Ele implementa regras determinísticas (switch/cases) para intents conhecidas (`CREATE_GOAL`, `MARK_DONE`, `MAKE_RECURRING`, `RESCHEDULE_REMINDER`, `ABANDON_GOAL`), porém aceita dados vindos do modelo (potencialmente não determinísticos). Portanto o comportamento final é determinístico dado um `action` bem-formado, mas o conteúdo do `action` pode variar por causa do modelo.

- **Existe log de erro quando a intent falha?** Sim — `IntentRouter` e os blocos `try/catch` registram logs com `this.logger.log`/`console.error`. Há mensagens de warning e erro quando operações falham.

- **O usuário recebe feedback se o banco falhar?** Em muitos casos `IntentRouter` usa `reply` callback para passar mensagens de erro. No fluxo via Telegram, `TelegramService` passa `result.say` para o usuário, mas se uma ação falhar dentro do `IntentRouter`, apenas em alguns pontos `reply` é usado para retornar falha. Portanto o feedback ao usuário existe em muitos cenários, mas pode faltar em alguns erros internos.

- **Existe rollback se algo der errado?** Não há transações explícitas envolvendo múltiplas operações (ex.: criar meta + criar árvore + outras operações) via transação Prisma no trecho observado. Portanto operações parcialmente concluídas podem ficar parciais. Recomenda-se usar transações Prisma para garantir atomicidade em fluxos multi-step.

- **O IntentRouter já recebeu dados inconsistentes do modelo?** O código tem defesas como validação de `goalType` e `conquestType` e interrompe solicitando `ASK_INFO` quando faltam campos, o que sinaliza que dados incompletos/inconsistentes do modelo foram esperados ou observados.

- **Existe camada de validação antes de salvar no banco?** Sim, `IntentRouter` normaliza e valida `goalType` e `conquestType` e pede `ASK_INFO` quando necessário. Porém nem todas as validações (ex.: evitar lembrar no passado, deduplicação) são implementadas.

**🛡️ 6. Segurança e Robustez**

- **Existe rate limit por usuário?** Não visto no código. Sem rate limiting, um usuário malicioso poderia spam-me enviar mensagens que geram chamadas à OpenAI. Recomendação: implementar rate limiting (ex.: Redis token bucket) por `userId`/`chatId`.

- **Existe proteção contra spam?** Não há proteções explícitas além da checagem de vinculação de usuário. O servidor depende do Telegram para autenticação do chat e do app para vinculação de `userId`.

- **O usuário pode tentar injetar prompt malicioso?** Sim — mensagens de usuário são concatenadas no histórico e inseridas nas mensagens para o modelo. O `SYSTEM_PROMPT` é projetado como sistema de proteção, porém sem sanitização adicional há risco de prompt injection. Recomenda-se sanitizar entradas e isolar o SYSTEM_PROMPT (já é uma mensagem `system`, mas inputs de usuário podem conter instruções maliciosas).

- **O SYSTEM_PROMPT pode ser exposto em algum lugar?** O prompt é carregado de `src/modules/ia/SYSTEM_PROMPT.ts` e usado em runtime; pode ser exposto se logs de auditoria gravarem toda a sequência de mensagens (o `ai-audit.log` grava o prompt usado). Se o log for acessível publicamente, isso exporia o prompt. Atenção: `ai-audit.log` deve ser protegido.

- **Você sanitiza mensagens antes de enviar para o modelo?** Não há sanitização explícita das mensagens no trecho lido (apenas concatenação do `userMessage` e histórico). Recomenda-se sanitizar caracteres problemáticos e limitar tamanho.

- **Existe limite máximo de tamanho de mensagem?** O código limita o histórico por número de mensagens (slice(-16)), e o modelo deve aceitar esse tamanho; não há validação explícita do tamanho total do prompt em caracteres. É prudente limitar tokens/bytes antes de enviar.

**📊 7. Auditoria e Observabilidade**

- **O ai-audit.log cresce indefinidamente?** Sim — o arquivo é aberto em modo append sem rotação ou truncamento. Em produção deve-se rotacionar logs (logrotate), arquivar ou enviar para um sistema de logs central (ELK, Datadog).

- **Você consegue rastrear uma ação até o prompt que a gerou?** Parcialmente: `logAiAudit` grava `chatId`, `prompt` (array de mensagens role/content) e `raw` output e também `parsed` quando possível. Isso permite traçar uma resposta até o prompt. Falta um `correlationId` explícito para rastrear across services.

- **Existe ID de correlação por mensagem?** Não há ID de correlação explícito gerado por mensagem no trecho lido. Recomenda-se adicionar `correlationId` por request para concatenação de logs e rastreabilidade.

- **Você mede taxa de erro do modelo?** Não há métricas instrumentadas no código visível. Esse tipo de monitoramento não está implementado — os dados podem ser inferidos a partir de `ai-audit.log`, mas não há contadores/telemetria.

- **Você mede taxa de ASK_INFO?** Não há métricas; seria útil contar ocorrências de `ASK_INFO` para melhorar UX.

- **Você mede taxa de JSON inválido?** Não automatizado; logs brutos podem ser processados para calcular essa taxa.

**💬 8. Experiência do Cliente (essa é a mais importante)**

- **O usuário entende quando está criando meta vs lembrete?** Há esforço para diferenciar: `trySimpleRules` cria `CREATE_GOAL` para lembretes com tempo explícito; mensagens no bot indicam a criação. Porém sem confirmação explícita em todos os fluxos, usuários podem ficar confusos. O `SYSTEM_PROMPT` exige confirmar antes de criar, mas `trySimpleRules` tem exceção para tempos explícitos (cria imediatamente).

- **O usuário entende o que é mundo?** O bot menciona `worldId` e pede para referenciar mundo em respostas quando relevante. Se o usuário não souber o conceito, o sistema não fornece uma explicação automática padrão — isso depende do model prompt e UX. Recomendação: ter respostas explicativas curtas sobre o que é um mundo.

- **O usuário já ficou confuso com ASK_INFO?** Não há métricas, mas `ASK_INFO` é usada quando faltam dados; sem um fluxo UX claro (bot mostrando opções interativas, botões etc.), usuários podem achar o `ASK_INFO` textual confuso. Melhorias: usar Telegram keyboards para opções.

- **O modelo às vezes pergunta coisas desnecessárias?** Pode acontecer; o `SYSTEM_PROMPT` tenta minimizar isso exigindo perguntas específicas, mas modelo pode pedir clarificações se inseguro.

- **O modelo às vezes deixa de perguntar algo essencial?** Sim — há defesas no `IntentRouter` que interrompem criação e pedem `ASK_INFO` quando campos faltam. Isso indica que o modelo já deixou de pedir algo essencial.

- **Existe confirmação antes de criar meta?** O `SYSTEM_PROMPT` exige confirmar antes de criar; porém `trySimpleRules` age como atalho e cria pontual quando há tempo explícito. Em muitos fluxos o bot confirma (mensagem de confirmação), mas não é universal.

- **O usuário pode cancelar no meio da criação?** Não há fluxo explícito de cancelamento; o usuário pode enviar uma nova mensagem que o modelo/flow interpretará, mas não há um handler `CANCEL` formal.

- **Existe resumo final antes de salvar?** Dependendo do fluxo, sim — o `SYSTEM_PROMPT` prescreve confirmar antes de criar. Na prática isso pode depender do que o modelo retorna e se `trySimpleRules` foi acionado.

- **Existe mensagem de sucesso clara após criação?** Sim — `IntentRouter` cria a meta e loga. Em `TelegramService` o bot envia `result.say` (que idealmente contém confirmação). Além disso, `IntentRouter` executa a criação e logs mostram `Meta criada`.

**🌍 9. Sistema de Mundos**

- **O worldId influencia no prompt?** Sim — `AiService.interpret` adiciona `worldId` ao contexto (`userMessage` e `RECENT_GOAL_CONTEXT`) e o `SYSTEM_PROMPT` pede para sempre mencionar o mundo atual quando relevante.

- **O modelo sabe a diferença entre mundos?** Tecnicamente ele recebe `worldId` e `RECENT_GOAL_CONTEXT` descrevendo metas e mundo; a compreensão depende do texto de contexto enviado. Há chance de confusão se `worldId` for apenas um identificador e não uma descrição humana.

- **Pode criar meta no mundo errado?** Sim, se `worldId` no contexto estiver ausente/errado ou se o modelo gerar `worldId` incorreto no `action.data`. `TelegramService` garante que `result.action.data.worldId = worldId` antes de enviar ao `IntentRouter` (o código adiciona explicitamente `result.action.data.worldId = worldId`), reduzindo esse risco.

- **O usuário pode trocar mundo no Telegram?** Não há comando explícito no bot para mudar `worldId`. Em teoria, se o usuário indicar no texto o mundo, o modelo poderia interpretar, mas não há handler dedicado. Recomenda-se adicionar comando `/mundo` ou fluxo de seleção.

- **Existe validação cruzada entre world e `conquestType`?** Não há validação explícita que relacione `worldId` e `conquestType` lida no `IntentRouter`.

**🧬 10. Regras Simples (trySimpleRules)**

- **Quais regex exatamente você usa?** Trechos principais (em `AiService.trySimpleRules`):
  - `me\\s+lembre(?:\\s+de)?\\s+(.+?)\\s+em\\s+(\\d+)\\s*min`
  - `me\\s+lembra(?:\\s+de)?\\s+(.+?)\\s+daqui\\s+a\\s+(\\d+)\\s*min`
  - `me\\s+lembre(?:\\s+em|\\s+daqui\\s+a)?\\s+(\\d+)\\s*min`
  - variações para capturar `que horas` / `horas são` / `hora atual` usando `msg.includes(...)` simples

- **Já houve falso positivo?** Não há log explícito de falsos positivos, mas regexs que capturam `me lembre de X em 5 minutos` podem ter falsos positivos se o texto do usuário contiver números contextuais. Para verificar ocorrências reais, inspecionar `ai-audit.log` e logs do Telegram é necessário.

- **Já houve falso negativo?** Sim, possível — regras regex são limitadas e formas distintas (ex.: "me avisa daqui 5min" sem espaço ou variação lexical) podem não ser capturadas. O código cai para o modelo nesses casos.

- **As regras simples têm prioridade absoluta?** Sim: `interpret` chama `trySimpleRules` primeiro; se retornar algo, o fluxo usa essa resposta sem chamar o modelo.

- **Elas podem entrar em conflito com o modelo?** Potencialmente: se a regra simples retornar `CREATE_GOAL` automaticamente e o modelo, se chamado, teria decidido pedir confirmação, há uma diferença de comportamento. A equipe já mitigou parcialmente via `trySimpleRules` por design.

**🚨 11. Problemas Reais que Já Aconteceram**

- **Qual foi o pior bug já ocorrido?** Não há histórico público no repositório. Possíveis piores bugs (hipotéticos) baseados no design: criação de metas duplicadas, perda de histórico após restart, respostas não-JSON do modelo que interrompem o fluxo, ou criação de metas no mundo errado.

- **Qual é o bug mais frequente hoje?** Não instrumentado; suspeita: respostas inválidas da IA (não-JSON) e casos onde o modelo não pede campos obrigatórios, exigindo intervenção manual.

- **O que mais quebra no fluxo?** Falta de transações atômicas, ausência de retries para chamadas externas (OpenAI), limites de prompt/token e falta de sanitização causam falhas.

- **O que mais confunde o usuário?** Falta de confirmação consistente, mensagens `ASK_INFO` sem UI (botões) e possíveis mensagens ambíguas sobre mundos.

- **Onde o sistema é mais frágil?** Integração com modelo sem validação robusta e falta de pipeline assíncrono/filas tornam o sistema frágil sob carga ou quando a IA erra.

**📈 12. Objetivo do Produto**

- **Qual é o objetivo final do produto?** Pelo prompt e pelo código, o objetivo é ser um assistente motivacional/gamificado que ajuda usuários a criar e manter metas (com árvores/elementos visuais) e lembrá-los com mensagens encorajadoras.

- **Ele é mais lembrete ou mais sistema gamificado?** Ambos: há forte componente de lembretes e rastreamento (`reminderTime`, `MARK_DONE`) e também componente gamificado com árvores e crescimento (`worlds`, `plantedTree`). A prioridade parece ser suporte a hábitos com gamificação.

- **Você quer que ele pareça assistente ou sistema?** O `SYSTEM_PROMPT` define tom de assistente: motivacional, acolhedor e humano. A orientação é ter aparência de assistente.

- **Você quer reduzir ASK_INFO ao mínimo?** O design do `SYSTEM_PROMPT` tenta coletar dados mínimos antes de criar e usar `ASK_INFO` quando faltam campos. Há trade-off entre pedir dados e inferir automaticamente — recomenda-se minimizar `ASK_INFO` com heurísticas seguras e UX interativa (botões), mas não eliminá-lo.

- **O que significa “contato melhor com o cliente” pra você exatamente?** Em termos práticos: respostas claras, confirmação antes de ações destrutivas, menos mensagens ambíguas, opções interativas no Telegram (keyboards), feedback imediato e histórico rastreável das decisões do assistente.

**Anexos e próximos passos recomendados**

- Inspecionar `logs/ai-audit.log` se existir para coletar exemplos reais de respostas inválidas ou intents estranhas.
- Adicionar `correlationId` para cada mensagem/req enviada ao modelo para melhorar rastreabilidade.
- Implementar retries com backoff para chamadas à OpenAI e limites de timeout explícitos.
- Introduzir fila/worker (ex.: BullMQ + Redis) para processar mensagens em carga e para envio de lembretes.
- Persistir histórico (opcionalmente parcial) para melhorar contexto e auditoria; ou mover `chatHistories` para Redis para sobreviver a reinícios.
- Proteger e rotacionar `ai-audit.log` e garantir que não vaze produção.

Arquivo relacionado: [src/modules/ia/SYSTEM_PROMPT.ts](src/modules/ia/SYSTEM_PROMPT.ts)

---

Documento gerado automaticamente com base na inspeção do código fonte; para investigações adicionais posso extrair exemplos reais dos logs, adicionar checks automatizados de qualidade de JSON, ou gerar um checklist priorizado de melhorias. Quer que eu adicione tickets/prioridades para as ações recomendadas?
