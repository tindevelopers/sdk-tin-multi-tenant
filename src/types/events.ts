import { z } from 'zod';
import { Tenant } from './tenant';
import { User, TenantUser } from './auth';

// Event Types
export enum EventType {
  // Tenant Events
  TENANT_CREATED = 'tenant.created',
  TENANT_UPDATED = 'tenant.updated',
  TENANT_SUSPENDED = 'tenant.suspended',
  TENANT_ACTIVATED = 'tenant.activated',
  TENANT_DELETED = 'tenant.deleted',
  
  // User Events
  USER_INVITED = 'user.invited',
  USER_JOINED = 'user.joined',
  USER_ROLE_CHANGED = 'user.role_changed',
  USER_REMOVED = 'user.removed',
  
  // Auth Events
  USER_LOGGED_IN = 'auth.logged_in',
  USER_LOGGED_OUT = 'auth.logged_out',
  SESSION_EXPIRED = 'auth.session_expired',
  
  // Data Events
  DATA_CREATED = 'data.created',
  DATA_UPDATED = 'data.updated',
  DATA_DELETED = 'data.deleted',
  
  // System Events
  MIGRATION_EXECUTED = 'system.migration_executed',
  BACKUP_CREATED = 'system.backup_created'
}

// Base Event Schema
export const BaseEventSchema = z.object({
  id: z.string().uuid(),
  type: z.nativeEnum(EventType),
  tenant_id: z.string().uuid(),
  user_id: z.string().uuid().optional(),
  timestamp: z.string().datetime(),
  metadata: z.record(z.any()).optional()
});

// Tenant Events
export const TenantCreatedEventSchema = BaseEventSchema.extend({
  type: z.literal(EventType.TENANT_CREATED),
  data: z.object({
    tenant: z.any() // Tenant type
  })
});

export const TenantUpdatedEventSchema = BaseEventSchema.extend({
  type: z.literal(EventType.TENANT_UPDATED),
  data: z.object({
    tenant: z.any(), // Tenant type
    changes: z.record(z.any())
  })
});

// User Events
export const UserInvitedEventSchema = BaseEventSchema.extend({
  type: z.literal(EventType.USER_INVITED),
  data: z.object({
    email: z.string().email(),
    role: z.string(),
    invited_by: z.string().uuid()
  })
});

export const UserJoinedEventSchema = BaseEventSchema.extend({
  type: z.literal(EventType.USER_JOINED),
  data: z.object({
    user: z.any(), // User type
    tenant_user: z.any() // TenantUser type
  })
});

// Generic Event Union
export type SDKEvent = 
  | z.infer<typeof TenantCreatedEventSchema>
  | z.infer<typeof TenantUpdatedEventSchema>
  | z.infer<typeof UserInvitedEventSchema>
  | z.infer<typeof UserJoinedEventSchema>;

// Event Handler Type
export type EventHandler<T extends SDKEvent = SDKEvent> = (event: T) => void | Promise<void>;

// Event Emitter Interface
export interface EventEmitter {
  emit(event: SDKEvent): void;
  on<T extends SDKEvent>(eventType: EventType, handler: EventHandler<T>): void;
  off<T extends SDKEvent>(eventType: EventType, handler: EventHandler<T>): void;
}
