import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { ERROR_CODES, NovaError } from '@nova/shared';
import type { Request } from 'express';
import jwt from 'jsonwebtoken';
import { getApiEnv } from '../common/env';
import type { AuthUser } from './current-user.decorator';

interface AccessTokenPayload {
  sub: string;
  email: string;
  name: string;
  type?: string;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new NovaError(ERROR_CODES.AUTH_TOKEN_EXPIRED, 'Missing bearer token', undefined, 401);
    }

    const token = authHeader.slice('Bearer '.length).trim();
    if (!token) {
      throw new NovaError(ERROR_CODES.AUTH_TOKEN_EXPIRED, 'Empty bearer token', undefined, 401);
    }

    const env = getApiEnv();
    try {
      const payload = jwt.verify(token, env.jwtAccessSecret, {
        algorithms: ['HS256'],
      }) as AccessTokenPayload;
      if (!payload.sub || payload.type !== 'access') {
        throw new NovaError(ERROR_CODES.AUTH_TOKEN_EXPIRED, 'Invalid access token', undefined, 401);
      }
      req.user = {
        id: payload.sub,
        email: payload.email,
        name: payload.name,
      };
      return true;
    } catch (err) {
      if (err instanceof NovaError) throw err;
      throw new NovaError(ERROR_CODES.AUTH_TOKEN_EXPIRED, 'Invalid or expired token', undefined, 401);
    }
  }
}
