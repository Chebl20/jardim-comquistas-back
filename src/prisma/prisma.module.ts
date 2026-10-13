import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * PrismaModule é global (@Global) para que PrismaService fique disponível
 * em qualquer módulo sem precisar importar PrismaModule explicitamente.
 * Registrar apenas uma vez em AppModule.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
