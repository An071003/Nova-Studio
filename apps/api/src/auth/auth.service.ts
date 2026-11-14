import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  NovaError,
  type AuthResponse,
  type LoginDto,
  type MeResponse,
  type RegisterDto,
  type Role,
  type UserSummary,
} from '@nova/shared';
import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import { getApiEnv } from '../common/env';
import { PrismaService } from '../prisma/prisma.service';

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const REFRESH_COOKIE_NAME = 'nova_refresh';

export function hashRefreshToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

@Injectable()
export class AuthService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private signAccessToken(user: UserSummary): string {
    const env = getApiEnv();
    return jwt.sign(
      {
        sub: user.id,
        email: user.email,
        name: user.name,
        type: 'access',
      },
      env.jwtAccessSecret,
      { algorithm: 'HS256', expiresIn: ACCESS_TOKEN_TTL_SECONDS },
    );
  }

  private async issueRefreshToken(userId: string, familyId: string): Promise<string> {
    const rawToken = randomBytes(48).toString('base64url');
    const tokenHash = hashRefreshToken(rawToken);
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

    await this.prisma.refreshToken.create({
      data: {
        userId,
        familyId,
        tokenHash,
        expiresAt,
      },
    });
    return rawToken;
  }

  async register(dto: RegisterDto): Promise<{ response: AuthResponse; refreshToken: string }> {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) {
      throw new NovaError(ERROR_CODES.CONFLICT, 'Email already registered');
    }

    const passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id });
    const created = await this.prisma.user.create({
      data: {
        email: dto.email,
        name: dto.name,
        passwordHash,
      },
    });

    const user: UserSummary = {
      id: created.id,
      email: created.email,
      name: created.name,
      avatarUrl: created.avatarUrl,
    };
    const accessToken = this.signAccessToken(user);
    const refreshToken = await this.issueRefreshToken(user.id, randomUUID());
    return { response: { user, accessToken }, refreshToken };
  }

  async login(dto: LoginDto): Promise<{ response: AuthResponse; refreshToken: string }> {
    const found = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!found) {
      throw new NovaError(ERROR_CODES.AUTH_INVALID_CREDENTIALS, 'Invalid email or password');
    }

    const valid = await argon2.verify(found.passwordHash, dto.password);
    if (!valid) {
      throw new NovaError(ERROR_CODES.AUTH_INVALID_CREDENTIALS, 'Invalid email or password');
    }

    const user: UserSummary = {
      id: found.id,
      email: found.email,
      name: found.name,
      avatarUrl: found.avatarUrl,
    };
    const accessToken = this.signAccessToken(user);
    const refreshToken = await this.issueRefreshToken(user.id, randomUUID());
    return { response: { user, accessToken }, refreshToken };
  }

  async refresh(rawToken: string | undefined): Promise<{ accessToken: string; refreshToken: string }> {
    if (!rawToken) {
      throw new NovaError(ERROR_CODES.AUTH_TOKEN_EXPIRED, 'Missing refresh token');
    }

    const tokenHash = hashRefreshToken(rawToken);
    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!existing) {
      throw new NovaError(ERROR_CODES.AUTH_TOKEN_EXPIRED, 'Invalid refresh token');
    }

    if (existing.revokedAt !== null) {
      await this.prisma.refreshToken.updateMany({
        where: { familyId: existing.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new NovaError(ERROR_CODES.AUTH_TOKEN_EXPIRED, 'Refresh token reuse detected');
    }

    if (existing.expiresAt.getTime() <= Date.now()) {
      throw new NovaError(ERROR_CODES.AUTH_TOKEN_EXPIRED, 'Refresh token expired');
    }

    const nextRawToken = randomBytes(48).toString('base64url');
    const nextTokenHash = hashRefreshToken(nextRawToken);
    const nextExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

    const rotated = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.refreshToken.updateMany({
        where: { id: existing.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (updated.count !== 1) {
        await tx.refreshToken.updateMany({
          where: { familyId: existing.familyId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        return false;
      }

      await tx.refreshToken.create({
        data: {
          userId: existing.userId,
          familyId: existing.familyId,
          tokenHash: nextTokenHash,
          expiresAt: nextExpiresAt,
        },
      });
      return true;
    });

    if (!rotated) {
      throw new NovaError(ERROR_CODES.AUTH_TOKEN_EXPIRED, 'Refresh token reuse detected');
    }

    const accessToken = this.signAccessToken({
      id: existing.user.id,
      email: existing.user.email,
      name: existing.user.name,
      avatarUrl: existing.user.avatarUrl,
    });
    return { accessToken, refreshToken: nextRawToken };
  }

  async logout(rawToken: string | undefined): Promise<void> {
    if (!rawToken) return;
    const tokenHash = hashRefreshToken(rawToken);
    const existing = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (!existing) return;
    await this.prisma.refreshToken.updateMany({
      where: { familyId: existing.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async getMe(userId: string): Promise<MeResponse> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        memberships: {
          include: { workspace: true },
          orderBy: { joinedAt: 'asc' },
        },
      },
    });
    if (!user) {
      throw new NovaError(ERROR_CODES.AUTH_TOKEN_EXPIRED, 'User not found', undefined, 401);
    }

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
      },
      workspaces: user.memberships.map((m) => ({
        id: m.workspace.id,
        name: m.workspace.name,
        slug: m.workspace.slug,
        role: m.role as Role,
      })),
    };
  }
}
