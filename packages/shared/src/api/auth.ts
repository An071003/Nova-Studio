import { z } from 'zod';
import { RoleSchema } from '../permissions.js';

export const RegisterSchema = z.object({
  email: z.string().trim().email().max(255).toLowerCase(),
  name: z.string().trim().min(1).max(100),
  password: z.string().min(8).max(128),
});

export type RegisterDto = z.infer<typeof RegisterSchema>;

export const LoginSchema = z.object({
  email: z.string().trim().email().max(255).toLowerCase(),
  password: z.string().min(1).max(128),
});

export type LoginDto = z.infer<typeof LoginSchema>;

export const UserSummarySchema = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string(),
  avatarUrl: z.string().nullable().optional(),
});

export type UserSummary = z.infer<typeof UserSummarySchema>;

export const AuthResponseSchema = z.object({
  user: UserSummarySchema,
  accessToken: z.string(),
});

export type AuthResponse = z.infer<typeof AuthResponseSchema>;

export const MeWorkspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  role: RoleSchema,
});

export const MeResponseSchema = z.object({
  user: UserSummarySchema,
  workspaces: z.array(MeWorkspaceSchema),
});

export type MeResponse = z.infer<typeof MeResponseSchema>;
