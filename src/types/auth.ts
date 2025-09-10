import { z } from 'zod';

// User Role Enum
export enum UserRole {
  OWNER = 'owner',
  ADMIN = 'admin',
  MEMBER = 'member',
  VIEWER = 'viewer'
}

// User Status Enum
export enum UserStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  SUSPENDED = 'suspended'
}

// User Schema
export const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string().min(1).max(100),
  avatar_url: z.string().url().optional(),
  status: z.nativeEnum(UserStatus),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime()
});

export type User = z.infer<typeof UserSchema>;

// Tenant User Schema (Junction table)
export const TenantUserSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  user_id: z.string().uuid(),
  role: z.nativeEnum(UserRole),
  permissions: z.array(z.string()).optional(),
  invited_by: z.string().uuid().optional(),
  joined_at: z.string().datetime(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime()
});

export type TenantUser = z.infer<typeof TenantUserSchema>;

// Authentication Context
export const AuthContextSchema = z.object({
  user: UserSchema,
  tenant: z.object({
    id: z.string().uuid(),
    slug: z.string(),
    role: z.nativeEnum(UserRole),
    permissions: z.array(z.string())
  }),
  session: z.object({
    access_token: z.string(),
    refresh_token: z.string(),
    expires_at: z.number()
  })
});

export type AuthContext = z.infer<typeof AuthContextSchema>;

// Login Schema
export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  tenant_slug: z.string().regex(/^[a-z0-9-]+$/).optional()
});

export type LoginRequest = z.infer<typeof LoginSchema>;

// Invite User Schema
export const InviteUserSchema = z.object({
  email: z.string().email(),
  role: z.nativeEnum(UserRole),
  permissions: z.array(z.string()).optional(),
  tenant_id: z.string().uuid()
});

export type InviteUser = z.infer<typeof InviteUserSchema>;
