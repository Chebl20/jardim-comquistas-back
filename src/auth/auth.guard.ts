import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import * as jwt from 'jsonwebtoken';

function jwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error(
      'JWT_SECRET não configurado. Defina a variável de ambiente JWT_SECRET.',
    );
  }
  return secret;
}

@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const auth = request.headers['authorization'];
    if (!auth || !auth.startsWith('Bearer '))
      throw new UnauthorizedException('Token ausente');
    const token = auth.replace('Bearer ', '');
    try {
      const payload = jwt.verify(token, jwtSecret());
      (request as any).user = payload;
      return true;
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('JWT_SECRET')) {
        throw err;
      }
      throw new UnauthorizedException('Token inválido');
    }
  }
}

export function signJwt(payload: any) {
  return jwt.sign(payload, jwtSecret(), { expiresIn: '7d' });
}
