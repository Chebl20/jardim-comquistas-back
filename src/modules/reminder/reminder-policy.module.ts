import { Module } from '@nestjs/common';
import { ReminderPolicyEngine } from './policy/reminder-policy.engine';
import { ReminderObservabilityService } from './observability/reminder-observability.service';

/**
 * Módulo leve que provê apenas a política de lembretes e observabilidade.
 * Sem dependências de AiModule ou ReminderModule — pode ser importado por ambos
 * sem criar ciclo de módulo.
 */
@Module({
  providers: [ReminderPolicyEngine, ReminderObservabilityService],
  exports: [ReminderPolicyEngine, ReminderObservabilityService],
})
export class ReminderPolicyModule {}
