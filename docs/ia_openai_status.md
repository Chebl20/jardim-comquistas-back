IA — Estado atual da integração OpenAI, parsing, rate-limit, timeout, timezone, logs e infra

Este documento responde de forma direta e técnica às perguntas enviadas, com base no código fonte inspecionado no repositório.

1) OpenAI — Como está hoje exatamente?

- Está sendo usado o método `client.chat.completions.create` (arquivo: `src/modules/ia/openIa/ai.service.ts`).
- Não há uso de `responses.create` no código inspecionado.
- O projeto usa o SDK oficial (`import OpenAI from 'openai'`).
- Não há uso de `response_format` ou do parâmetro estruturado para forçar JSON na chamada — a validação é feita via prompt + `JSON.parse` do `content` retornado.
- Erros frequentes conhecidos (baseado no código): respostas não-JSON são previstas e tratadas (lançam erro para o fluxo); timeouts e rate limits da OpenAI não são tratados explicitamente no código.
- Não existe retry automático centralizado: chamadas ao OpenAI são simples (try/catch) sem backoff/retries. Algumas funções têm fallbacks locais (retornam texto padrão em caso de erro), mas não há retry.

2) Parsing e validação

- O parsing principal é `JSON.parse(content)` no `AiService.interpret`. Há tentativas de fallback em funções menores (ex.: `generateProgressMetadata` tenta `JSON.parse` e, se falhar, extrai linhas de texto). Mas não há validação robusta de esquema (schema validation) nem uso de libs como `ajv`.
- Se o JSON vier inválido, o código faz:
  - lança `new Error('Resposta da IA não é JSON')` dentro de `interpret` e esse erro é propagado; o `TelegramService` captura erros gerais e responde ao usuário com uma mensagem genérica ('Erro ao processar sua mensagem.').
  - o `ai-audit.log` ainda grava o `raw` output (para investigação), mas não há remediação automática.
- Em resumo: o sistema não “quebra” silenciosamente — ele captura o erro, loga auditoria e retorna erro ao fluxo chamador; não há re-parse/repair automático nem validação de tipos/valores antes de enviar ao `IntentRouter` (além de enriquecimentos condicionais como preencher opções de `conquestType`).
- Já ocorreu (ou ao menos o código protege contra) respostas inválidas — o tratamento de exceção está presente; não há prova direta de metas criadas com campos null a partir do modelo, mas o `IntentRouter` realiza validações (normaliza `goalType` e `conquestType`) e interrompe/cria `ASK_INFO` quando faltam dados; portanto criar uma meta com campo nulo é improvável sem falha adicional, mas possível se o `IntentRouter` for contornado.

3) Rate limit / Redis / hosting / spam

- O código não usa Redis nem qualquer cache/queue visível nas pastas inspecionadas.
- Não há configuração explícita de rate limit por usuário no código.
- Sobre infraestrutura (VPS/Railway/Render/etc): o repositório não contém informação de deployment; portanto não sabemos onde está rodando (pode ser local, Docker, VPS ou plataforma PaaS). O bot usa `polling: true` (node-telegram-bot-api), o que é comum em deploys simples.
- Não há código para detecção/mitigação de spam/flood; relatos de spam não estão acessíveis no repositório.
- Número de usuários ativos hoje: não é possível inferir a partir do código — requerar logs/DB ou métricas externas.

4) Timeout / Retry

- Não há timeout explícito definido ao chamar `client.chat.completions.create`. O comportamento final depende do SDK e do ambiente (pode existir timeout por padrão na versão do SDK usada, mas não está configurado no código).
- Se a OpenAI demorar 20s, a chamada ficará pendente até a conclusão ou até que o SDK/soquete feche; enquanto isso o handler do Telegram aguardará. Não há limite de tempo programado no fluxo, então a experiência do usuário ficará lenta e o processo pode acumular requests.
- O código não implementa retries com backoff; portanto, erros temporários (ETIMEDOUT/ECONNRESET) não são re-tentados automaticamente pelo app. Esses erros podem ocorrer na rede e o SDK pode repassá-los; o app apenas captura e loga/retorna erro.

5) Timezone

- Não há armazenamento explícito de timezone por usuário no banco (nenhuma referência a `timezone` em consultas vistas).
- O `CURRENT_TIME` e outras leituras de horário usam `new Date().toLocaleTimeString('pt-BR', ...)` ou `new Date()` diretamente no servidor, portanto o horário reflete o timezone do ambiente onde o servidor está rodando.
- Não há uso de bibliotecas especializadas (ex.: `moment-timezone`, `luxon`) no fluxo inspecionado.
- Já teve lembrete tocando no horário errado? Não temos logs neste repositório que comprovem incidências; porém, dado que não se usa timezone por usuário, é plausível ocorrerem discrepâncias se o servidor e o usuário estiverem em fusos diferentes.

6) Logs (`ai-audit.log`)

- Localização: arquivo `logs/ai-audit.log` no diretório do projeto (implementado em `src/modules/ia/ai-audit.service.ts`).
- Onde aparece em runtime depende de onde o processo roda: localmente será em `caminho/para/projeto/logs/ai-audit.log`; em container Docker ficará no filesystem do container (a menos que exista bind/volume); em VPS ficará no filesystem do host se mapeado.
- O arquivo cresce indefinidamente por append; não há rotação implementada no código.
- O `ai-audit.log` grava prompts e respostas brutas (o campo `prompt` pode conter o `SYSTEM_PROMPT` e as mensagens do usuário), então ele pode conter dados sensíveis ou PII se os prompts/usuários os fornecerem. Recomenda-se proteger/rotacionar/remover dados sensíveis.

7) Infra geral / comportamento em reinício

- O código aparenta projetado para rodar como processo Node único (não há código de cluster/worker ou filas visíveis). Deploy em cluster precisaria de adaptações (ex.: sincronizar `chatHistories` e `ai-audit.log`).
- Se o servidor reiniciar, conversas em andamento (o `chatHistories` em memória) são perdidas — o histórico é volátil.
- Não existe sistema de fila visível; processamento é síncrono no handler do Telegram.

Comandos úteis para investigação local (inspecionar logs):

```bash
# visualizar últimas linhas do log
tail -n 200 logs/ai-audit.log

# buscar respostas que não são JSON (exemplo heurístico: linhas onde parsed não exista ou checar por mensagens de erro)
grep -i "Resposta da IA não é JSON" -n logs/ai-audit.log || true

# contar entradas de audit
wc -l logs/ai-audit.log
```

Conclusões rápidas e recomendações prioritárias

- Adicionar timeout explícito e retries com backoff nas chamadas à OpenAI.
- Implementar validação de esquema (ex.: `ajv`) para o JSON retornado antes de aceitar ações do modelo.
- Mover `chatHistories` para um armazenamento compartilhado (Redis) se for precisar de alta disponibilidade/cluster.
- Implementar rate limiting por `userId`/`chatId` e proteção básica anti-spam.
- Rotacionar e proteger `ai-audit.log`, remover/mascarar PII.

Quer que eu:
- extraia exemplos reais de respostas inválidas do `logs/ai-audit.log` (se existir), ou
- adicione tickets/PRs com as mudanças prioritárias (timeout, retries, validação de esquema, rate-limit)?
