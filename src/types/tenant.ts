import { z } from 'zod';

// Tenant Status Enum
export enum TenantStatus {
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  PENDING = 'pending',
  CANCELLED = 'cancelled'
}

// Tenant Plan Enum
export enum TenantPlan {
  STARTER = 'starter',
  PROFESSIONAL = 'professional',
  ENTERPRISE = 'enterprise'
}

// Tenant Schema
export const TenantSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  status: z.nativeEnum(TenantStatus),
  plan: z.nativeEnum(TenantPlan),
  settings: z.record(z.any()).optional(),
  metadata: z.record(z.any()).optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  owner_id: z.string().uuid()
});

export type Tenant = z.infer<typeof TenantSchema>;

// Tenant Creation Schema
export const CreateTenantSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  plan: z.nativeEnum(TenantPlan).default(TenantPlan.STARTER),
  settings: z.record(z.any()).optional(),
  metadata: z.record(z.any()).optional(),
  owner_id: z.string().uuid()
});

export type CreateTenant = z.infer<typeof CreateTenantSchema>;

// Tenant Update Schema
export const UpdateTenantSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  status: z.nativeEnum(TenantStatus).optional(),
  plan: z.nativeEnum(TenantPlan).optional(),
  settings: z.record(z.any()).optional(),
  metadata: z.record(z.any()).optional()
});

export type UpdateTenant = z.infer<typeof UpdateTenantSchema>;
