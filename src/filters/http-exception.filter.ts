import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
} from '@nestjs/common';
import { Response } from 'express';

/**
 * Normaliza todos os HttpException para o formato { statusCode, error, message }.
 * Sem este filtro, NestJS usa formatos diferentes dependendo de como a exceção
 * foi lançada (string vs objeto).
 */
@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const status = exception.getStatus();
    const exceptionResponse = exception.getResponse();

    const body =
      typeof exceptionResponse === 'string'
        ? { statusCode: status, message: exceptionResponse }
        : { statusCode: status, ...(exceptionResponse as object) };

    response.status(status).json(body);
  }
}
