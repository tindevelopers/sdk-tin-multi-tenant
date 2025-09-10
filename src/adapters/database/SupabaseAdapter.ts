import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import { IDatabaseAdapter, ITransaction, Migration, DatabaseConfig } from '../../interfaces/IDatabaseAdapter';
import { QueryOptions, TenantContext, DataResult } from '../../types/data';
import { DataError, ErrorCodes } from '../../utils/errors';

/**
 * Supabase database adapter implementation
 */
export class SupabaseAdapter implements IDatabaseAdapter {
  private client: SupabaseClient;
  private serviceClient?: SupabaseClient;
  private config: DatabaseConfig;

  constructor(config: DatabaseConfig) {
    this.config = config;
    
    if (!config.supabaseUrl || !config.supabaseAnonKey) {
      throw new DataError(
        'Supabase URL and anonymous key are required',
        ErrorCodes.CONFIGURATION_ERROR,
        400
      );
    }

    this.client = createClient(config.supabaseUrl, config.supabaseAnonKey);
    
    if (config.supabaseServiceKey) {
      this.serviceClient = createClient(config.supabaseUrl, config.supabaseServiceKey);
    }
  }

  async initialize(): Promise<void> {
    try {
      // Test connection
      const isConnected = await this.testConnection();
      if (!isConnected) {
        throw new DataError(
          'Failed to connect to Supabase',
          ErrorCodes.DATABASE_ERROR,
          500
        );
      }
    } catch (error) {
      throw new DataError(
        'Failed to initialize Supabase adapter',
        ErrorCodes.DATABASE_ERROR,
        500,
        error
      );
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      const { error } = await this.client.from('tenants').select('count').limit(1);
      return !error || error.code !== 'PGRST301'; // PGRST301 = relation does not exist
    } catch (error) {
      return false;
    }
  }

  async query<T = any>(sql: string, params: any[] = []): Promise<DataResult<T[]>> {
    try {
      const { data, error } = await this.client.rpc('execute_sql', {
        query_sql: sql,
        query_params: params
      });

      if (error) {
        throw new DataError(
          'Query execution failed',
          ErrorCodes.INVALID_QUERY,
          400,
          error
        );
      }

      return { data: data || [] };
    } catch (error) {
      if (error instanceof DataError) {
        throw error;
      }
      return { data: null, error: error.message };
    }
  }

  async create<T = any>(table: string, data: Partial<T>, context: TenantContext): Promise<DataResult<T>> {
    try {
      const recordData = {
        ...data,
        tenant_id: context.tenant_id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      const { data: result, error } = await this.client
        .from(table)
        .insert(recordData)
        .select()
        .single();

      if (error) {
        throw new DataError(
          'Failed to create record',
          ErrorCodes.DATABASE_ERROR,
          500,
          error
        );
      }

      return { data: result };
    } catch (error) {
      if (error instanceof DataError) {
        throw error;
      }
      return { data: null, error: error.message };
    }
  }

  async read<T = any>(table: string, options: QueryOptions, context: TenantContext): Promise<DataResult<T[]>> {
    try {
      let query = this.client
        .from(table)
        .select(options.select || '*', { count: 'exact' })
        .eq('tenant_id', context.tenant_id);

      // Apply filters
      if (options.filter) {
        Object.entries(options.filter).forEach(([key, value]) => {
          query = query.eq(key, value);
        });
      }

      // Apply ordering
      if (options.order) {
        query = query.order(options.order.column, { 
          ascending: options.order.ascending 
        });
      }

      // Apply pagination
      if (options.limit) {
        query = query.limit(options.limit);
      }

      if (options.offset) {
        query = query.range(
          options.offset, 
          options.offset + (options.limit || 10) - 1
        );
      }

      const { data, error, count } = await query;

      if (error) {
        throw new DataError(
          'Failed to read records',
          ErrorCodes.DATABASE_ERROR,
          500,
          error
        );
      }

      return { data: data || [], count };
    } catch (error) {
      if (error instanceof DataError) {
        throw error;
      }
      return { data: null, error: error.message };
    }
  }

  async update<T = any>(table: string, id: string, updates: Partial<T>, context: TenantContext): Promise<DataResult<T>> {
    try {
      const updateData = {
        ...updates,
        updated_at: new Date().toISOString()
      };

      const { data, error } = await this.client
        .from(table)
        .update(updateData)
        .eq('id', id)
        .eq('tenant_id', context.tenant_id)
        .select()
        .single();

      if (error) {
        throw new DataError(
          'Failed to update record',
          ErrorCodes.DATABASE_ERROR,
          500,
          error
        );
      }

      return { data };
    } catch (error) {
      if (error instanceof DataError) {
        throw error;
      }
      return { data: null, error: error.message };
    }
  }

  async delete(table: string, id: string, context: TenantContext): Promise<DataResult<void>> {
    try {
      const { error } = await this.client
        .from(table)
        .delete()
        .eq('id', id)
        .eq('tenant_id', context.tenant_id);

      if (error) {
        throw new DataError(
          'Failed to delete record',
          ErrorCodes.DATABASE_ERROR,
          500,
          error
        );
      }

      return { data: undefined };
    } catch (error) {
      if (error instanceof DataError) {
        throw error;
      }
      return { data: null, error: error.message };
    }
  }

  async bulkCreate<T = any>(table: string, records: Partial<T>[], context: TenantContext): Promise<DataResult<T[]>> {
    try {
      const recordsWithTenant = records.map(record => ({
        ...record,
        tenant_id: context.tenant_id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }));

      const { data, error } = await this.client
        .from(table)
        .insert(recordsWithTenant)
        .select();

      if (error) {
        throw new DataError(
          'Bulk create failed',
          ErrorCodes.DATABASE_ERROR,
          500,
          error
        );
      }

      return { data: data || [] };
    } catch (error) {
      if (error instanceof DataError) {
        throw error;
      }
      return { data: null, error: error.message };
    }
  }

  async beginTransaction(): Promise<ITransaction> {
    // Supabase doesn't support explicit transactions in the client
    // This is a limitation we'll document
    throw new DataError(
      'Explicit transactions not supported in Supabase adapter',
      ErrorCodes.DATABASE_ERROR,
      501
    );
  }

  async setupTenantIsolation(tenantId: string): Promise<void> {
    if (!this.serviceClient) {
      throw new DataError(
        'Service key required for tenant isolation setup',
        ErrorCodes.CONFIGURATION_ERROR,
        500
      );
    }

    try {
      // In a real implementation, this would set up RLS policies
      // For now, we'll log the setup
      console.log(`Setting up tenant isolation for tenant: ${tenantId}`);
      
      // Example RLS policy setup (would be executed via service client):
      // CREATE POLICY tenant_isolation ON table_name FOR ALL TO authenticated 
      // USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
      
    } catch (error) {
      throw new DataError(
        'Failed to setup tenant isolation',
        ErrorCodes.DATABASE_ERROR,
        500,
        error
      );
    }
  }

  async setTenantContext(tenantId: string): Promise<void> {
    try {
      // Set tenant context for RLS policies
      await this.client.rpc('set_tenant_context', { tenant_id: tenantId });
    } catch (error) {
      throw new DataError(
        'Failed to set tenant context',
        ErrorCodes.DATABASE_ERROR,
        500,
        error
      );
    }
  }

  async runMigrations(migrations: Migration[]): Promise<void> {
    if (!this.serviceClient) {
      throw new DataError(
        'Service key required for running migrations',
        ErrorCodes.CONFIGURATION_ERROR,
        500
      );
    }

    try {
      for (const migration of migrations) {
        // Check if migration already executed
        const { data: existingMigration } = await this.serviceClient
          .from('migrations')
          .select('id')
          .eq('id', migration.id)
          .single();

        if (!existingMigration) {
          // Execute migration
          await this.serviceClient.rpc('execute_migration', {
            migration_sql: migration.up
          });

          // Record migration
          await this.serviceClient
            .from('migrations')
            .insert({
              id: migration.id,
              name: migration.name,
              version: migration.version,
              tenant_id: migration.tenant_id,
              executed_at: new Date().toISOString(),
              rollback_sql: migration.down
            });
        }
      }
    } catch (error) {
      throw new DataError(
        'Failed to run migrations',
        ErrorCodes.DATABASE_ERROR,
        500,
        error
      );
    }
  }

  async getHealth(): Promise<{ connected: boolean; latency?: number; error?: string }> {
    try {
      const startTime = Date.now();
      const connected = await this.testConnection();
      const latency = Date.now() - startTime;

      return {
        connected,
        latency: connected ? latency : undefined,
        error: connected ? undefined : 'Connection failed'
      };
    } catch (error) {
      return {
        connected: false,
        error: error.message
      };
    }
  }

  async close(): Promise<void> {
    // Supabase client doesn't require explicit closing
    // Connection pooling is handled automatically
  }
}
