import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import * as jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const auth = request.headers['authorization'];
    if (!auth || !auth.startsWith('Bearer ')) throw new UnauthorizedException('Token ausente');
    const token = auth.replace('Bearer ', '');
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      (request as any).user = payload;
      return true;
    } catch {
      throw new UnauthorizedException('Token inválido');
    }
  }
}

export function signJwt(payload: any) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}
