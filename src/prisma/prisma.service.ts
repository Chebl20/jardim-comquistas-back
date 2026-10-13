import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * PrismaService é o único ponto de acesso ao banco de dados.
 * Gerencia connect/disconnect no ciclo de vida do módulo NestJS.
 *
 * Uso: injete PrismaService em vez de importar o singleton `prisma`
 * de `prisma/client.ts` — isso permite DI, teste com mocks e shutdown gracioso.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
