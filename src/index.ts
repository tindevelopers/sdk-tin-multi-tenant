// Multi-Tenant SDK - Phase 1: Supabase-Native Implementation
export { MultiTenantSDK } from './core/MultiTenantSDK';
export { TenantManager } from './tenant/TenantManager';
export { AuthManager } from './auth/AuthManager';
export { DataManager } from './data/DataManager';
export { EventManager } from './events/EventManager';

// Multi-Tenant SDK - Phase 2: Database-Agnostic Implementation
export { MultiTenantSDKV2 } from './core/MultiTenantSDKV2';
export { DataManagerV2 } from './data/DataManagerV2';
export { MigrationManager } from './migration/MigrationManager';

// Database Adapters
export { DatabaseAdapterFactory } from './adapters/DatabaseAdapterFactory';
export { SupabaseAdapter } from './adapters/database/SupabaseAdapter';
export { PostgreSQLAdapter } from './adapters/database/PostgreSQLAdapter';
export { MySQLAdapter } from './adapters/database/MySQLAdapter';

// Interfaces
export * from './interfaces/IDatabaseAdapter';
export * from './interfaces/IAuthProvider';
export * from './interfaces/IEventProvider';

// Types
export * from './types/tenant';
export * from './types/auth';
export * from './types/data';
export * from './types/events';

// Utilities
export * from './utils/validation';
export * from './utils/errors';
