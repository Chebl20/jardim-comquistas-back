import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpStatus,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Response } from 'express';

const PRISMA_ERROR_MAP: Record<string, { status: number; message: string }> = {
  P2025: { status: HttpStatus.NOT_FOUND, message: 'Recurso não encontrado' },
  P2002: { status: HttpStatus.CONFLICT, message: 'Já existe um registro com esses dados' },
  P2003: { status: HttpStatus.BAD_REQUEST, message: 'Referência inválida (chave estrangeira)' },
  P2014: { status: HttpStatus.BAD_REQUEST, message: 'Violação de relação obrigatória' },
  P2016: { status: HttpStatus.BAD_REQUEST, message: 'Erro de interpretação de query' },
};

@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  catch(exception: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    const mapped = PRISMA_ERROR_MAP[exception.code] ?? {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Erro interno no banco de dados',
    };

    response.status(mapped.status).json({
      statusCode: mapped.status,
      error: HttpStatus[mapped.status],
      message: mapped.message,
      prismaCode: exception.code,
    });
  }
}
