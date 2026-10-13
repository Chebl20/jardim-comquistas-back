import { Module, forwardRef } from '@nestjs/common';
import { InboundMessagePipeline } from './inbound-message-pipeline';
import { UserModule } from '../users/user.module';
import { SharedModule } from '../shared/shared.module';
import { AiModule } from '../ia/ai.module';
import { DailyDigestModule } from '../daily-digest/daily-digest.module';

@Module({
  imports: [
    forwardRef(() => UserModule),
    SharedModule,
    forwardRef(() => AiModule),
    forwardRef(() => DailyDigestModule),
  ],
  providers: [InboundMessagePipeline],
  exports: [InboundMessagePipeline],
})
export class InboundModule {}
