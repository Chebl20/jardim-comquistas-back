# Paridade de canais (WhatsApp, Telegram, App)

| Entrada | Identificação | Saída de respostas do coach |
|---------|---------------|-----------------------------|
| WhatsApp (Evolution webhook) | `whatsappId` (DDI) | `MessagingService` → preferência do usuário |
| Telegram (polling) | `telegramId` | `MessagingService` → preferência do usuário |
| Garden Guide API (JWT) | `userId` do token | Resposta HTTP (mesmo orquestrador) |

Fluxo inbound vinculado: `InboundMessagePipeline` → `ConversationOrchestrator` → auditoria `ConversationTurn` → `MessagingService.sendToUser`.

Mensagens de sistema (vinculação, erro) ainda usam `transport.send` direto no canal de origem.
