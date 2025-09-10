import { z } from 'zod';

// Database Query Options
export const QueryOptionsSchema = z.object({
  select: z.string().optional(),
  filter: z.record(z.any()).optional(),
  order: z.object({
    column: z.string(),
    ascending: z.boolean().default(true)
  }).optional(),
  limit: z.number().positive().optional(),
  offset: z.number().min(0).optional()
});

export type QueryOptions = z.infer<typeof QueryOptionsSchema>;

// Tenant Context for Data Operations
export const TenantContextSchema = z.object({
  tenant_id: z.string().uuid(),
  user_id: z.string().uuid(),
  role: z.string(),
  permissions: z.array(z.string())
});

export type TenantContext = z.infer<typeof TenantContextSchema>;

// Data Operation Result
export const DataResultSchema = z.object({
  data: z.any(),
  count: z.number().optional(),
  error: z.string().optional()
});

export type DataResult<T = any> = {
  data: T | null;
  count?: number;
  error?: string;
};

// Audit Log Schema
export const AuditLogSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  user_id: z.string().uuid(),
  action: z.string(),
  resource_type: z.string(),
  resource_id: z.string().optional(),
  old_values: z.record(z.any()).optional(),
  new_values: z.record(z.any()).optional(),
  metadata: z.record(z.any()).optional(),
  created_at: z.string().datetime()
});

export type AuditLog = z.infer<typeof AuditLogSchema>;

// Migration Schema
export const MigrationSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  tenant_id: z.string().uuid().optional(), // null for global migrations
  executed_at: z.string().datetime(),
  rollback_sql: z.string().optional()
});

export type Migration = z.infer<typeof MigrationSchema>;
