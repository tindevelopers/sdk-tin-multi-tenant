import { QueryOptions, TenantContext, DataResult } from '../types/data';

/**
 * Abstract database adapter interface
 * All database implementations must conform to this interface
 */
export interface IDatabaseAdapter {
  /**
   * Initialize the database connection and setup
   */
  initialize(): Promise<void>;

  /**
   * Test database connectivity
   */
  testConnection(): Promise<boolean>;

  /**
   * Execute a raw SQL query with parameters
   */
  query<T = any>(sql: string, params?: any[]): Promise<DataResult<T[]>>;

  /**
   * Create a new record in the specified table
   */
  create<T = any>(table: string, data: Partial<T>, context: TenantContext): Promise<DataResult<T>>;

  /**
   * Read records from the specified table with options
   */
  read<T = any>(table: string, options: QueryOptions, context: TenantContext): Promise<DataResult<T[]>>;

  /**
   * Update a record in the specified table
   */
  update<T = any>(table: string, id: string, updates: Partial<T>, context: TenantContext): Promise<DataResult<T>>;

  /**
   * Delete a record from the specified table
   */
  delete(table: string, id: string, context: TenantContext): Promise<DataResult<void>>;

  /**
   * Bulk create multiple records
   */
  bulkCreate<T = any>(table: string, records: Partial<T>[], context: TenantContext): Promise<DataResult<T[]>>;

  /**
   * Begin a database transaction
   */
  beginTransaction(): Promise<ITransaction>;

  /**
   * Setup tenant isolation (RLS policies, etc.)
   */
  setupTenantIsolation(tenantId: string): Promise<void>;

  /**
   * Set tenant context for the current session
   */
  setTenantContext(tenantId: string): Promise<void>;

  /**
   * Execute database migrations
   */
  runMigrations(migrations: Migration[]): Promise<void>;

  /**
   * Get database health status
   */
  getHealth(): Promise<{
    connected: boolean;
    latency?: number;
    error?: string;
  }>;

  /**
   * Close database connections
   */
  close(): Promise<void>;
}

/**
 * Database transaction interface
 */
export interface ITransaction {
  /**
   * Execute a query within the transaction
   */
  query<T = any>(sql: string, params?: any[]): Promise<DataResult<T[]>>;

  /**
   * Commit the transaction
   */
  commit(): Promise<void>;

  /**
   * Rollback the transaction
   */
  rollback(): Promise<void>;
}

/**
 * Migration interface
 */
export interface Migration {
  id: string;
  name: string;
  version: string;
  up: string;    // SQL for applying migration
  down: string;  // SQL for rolling back migration
  tenant_id?: string; // null for global migrations
}

/**
 * Database configuration interface
 */
export interface DatabaseConfig {
  type: 'supabase' | 'postgresql' | 'mysql' | 'sqlite';
  host?: string;
  port?: number;
  database?: string;
  username?: string;
  password?: string;
  ssl?: boolean;
  connectionLimit?: number;
  
  // Supabase specific
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  supabaseServiceKey?: string;
  
  // Connection pool settings
  pool?: {
    min?: number;
    max?: number;
    acquireTimeoutMillis?: number;
    idleTimeoutMillis?: number;
  };
}
