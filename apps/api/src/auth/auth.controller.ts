import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  LoginSchema,
  RegisterSchema,
  type AuthResponse,
  type LoginDto,
  type MeResponse,
  type RegisterDto,
} from '@nova/shared';
import type { Request, Response } from 'express';
import { getApiEnv } from '../common/env';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AuthService, REFRESH_COOKIE_NAME, REFRESH_TOKEN_TTL_MS } from './auth.service';
import { CurrentUser, type AuthUser } from './current-user.decorator';
import { JwtAuthGuard } from './jwt-auth.guard';

function setRefreshCookie(res: Response, token: string): void {
  const env = getApiEnv();
  res.cookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.nodeEnv === 'production',
    sameSite: 'lax',
    path: '/api/v1/auth',
    maxAge: REFRESH_TOKEN_TTL_MS,
  });
}

function clearRefreshCookie(res: Response): void {
  const env = getApiEnv();
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: env.nodeEnv === 'production',
    sameSite: 'lax',
    path: '/api/v1/auth',
  });
}

const AUTH_REGISTER_LOGIN_LIMIT =
  process.env.NODE_ENV === 'production'
    ? 10
    : Number(process.env.NOVA_E2E_THROTTLE_LIMIT ?? 10);
const AUTH_REFRESH_LIMIT =
  process.env.NODE_ENV === 'production'
    ? 30
    : Number(process.env.NOVA_E2E_THROTTLE_LIMIT ?? 30);

@Controller()
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Post('auth/register')
  @Throttle({ default: { limit: AUTH_REGISTER_LOGIN_LIMIT, ttl: 60_000 } })
  async register(
    @Body(new ZodValidationPipe(RegisterSchema)) dto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const { response, refreshToken } = await this.auth.register(dto);
    setRefreshCookie(res, refreshToken);
    return response;
  }

  @Post('auth/login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: AUTH_REGISTER_LOGIN_LIMIT, ttl: 60_000 } })
  async login(
    @Body(new ZodValidationPipe(LoginSchema)) dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const { response, refreshToken } = await this.auth.login(dto);
    setRefreshCookie(res, refreshToken);
    return response;
  }

  @Post('auth/refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: AUTH_REFRESH_LIMIT, ttl: 60_000 } })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ accessToken: string }> {
    const rawCookie = (req.cookies as Record<string, string | undefined> | undefined)?.[
      REFRESH_COOKIE_NAME
    ];
    try {
      const { accessToken, refreshToken } = await this.auth.refresh(rawCookie);
      setRefreshCookie(res, refreshToken);
      return { accessToken };
    } catch (err) {
      clearRefreshCookie(res);
      throw err;
    }
  }

  @Post('auth/logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const rawCookie = (req.cookies as Record<string, string | undefined> | undefined)?.[
      REFRESH_COOKIE_NAME
    ];
    await this.auth.logout(rawCookie);
    clearRefreshCookie(res);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@CurrentUser() user: AuthUser): Promise<MeResponse> {
    return this.auth.getMe(user.id);
  }
}
