import { SupabaseClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import { QueryOptions, TenantContext, DataResult, AuditLog } from '../types/data';
import { EventManager } from '../events/EventManager';
import { EventType } from '../types/events';
import { DataError, ErrorCodes } from '../utils/errors';
import { validateSchema } from '../utils/validation';

export class DataManager {
  constructor(
    private supabase: SupabaseClient,
    private events: EventManager
  ) {}

  /**
   * Create a record with tenant isolation
   */
  async create<T = any>(
    table: string,
    data: Partial<T>,
    context: TenantContext
  ): Promise<DataResult<T>> {
    try {
      // Ensure tenant_id is set for isolation
      const recordData = {
        ...data,
        tenant_id: context.tenant_id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      const { data: result, error } = await this.supabase
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

      // Create audit log
      await this.createAuditLog({
        tenant_id: context.tenant_id,
        user_id: context.user_id,
        action: 'CREATE',
        resource_type: table,
        resource_id: result.id,
        new_values: recordData
      });

      // Emit event
      this.events.emit({
        id: uuidv4(),
        type: EventType.DATA_CREATED,
        tenant_id: context.tenant_id,
        user_id: context.user_id,
        timestamp: new Date().toISOString(),
        data: { table, record: result }
      });

      return { data: result };

    } catch (error) {
      if (error instanceof DataError) {
        throw error;
      }
      return { data: null, error: error.message };
    }
  }

  /**
   * Read records with tenant isolation
   */
  async read<T = any>(
    table: string,
    options: QueryOptions = {},
    context: TenantContext
  ): Promise<DataResult<T[]>> {
    try {
      let query = this.supabase
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

  /**
   * Update a record with tenant isolation
   */
  async update<T = any>(
    table: string,
    id: string,
    updates: Partial<T>,
    context: TenantContext
  ): Promise<DataResult<T>> {
    try {
      // First, get the existing record for audit trail
      const { data: existingRecord } = await this.supabase
        .from(table)
        .select('*')
        .eq('id', id)
        .eq('tenant_id', context.tenant_id)
        .single();

      if (!existingRecord) {
        throw new DataError(
          'Record not found',
          ErrorCodes.RESOURCE_NOT_FOUND,
          404
        );
      }

      const updateData = {
        ...updates,
        updated_at: new Date().toISOString()
      };

      const { data, error } = await this.supabase
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

      // Create audit log
      await this.createAuditLog({
        tenant_id: context.tenant_id,
        user_id: context.user_id,
        action: 'UPDATE',
        resource_type: table,
        resource_id: id,
        old_values: existingRecord,
        new_values: updateData
      });

      // Emit event
      this.events.emit({
        id: uuidv4(),
        type: EventType.DATA_UPDATED,
        tenant_id: context.tenant_id,
        user_id: context.user_id,
        timestamp: new Date().toISOString(),
        data: { table, record: data, changes: updateData }
      });

      return { data };

    } catch (error) {
      if (error instanceof DataError) {
        throw error;
      }
      return { data: null, error: error.message };
    }
  }

  /**
   * Delete a record with tenant isolation
   */
  async delete(
    table: string,
    id: string,
    context: TenantContext
  ): Promise<DataResult<void>> {
    try {
      // First, get the existing record for audit trail
      const { data: existingRecord } = await this.supabase
        .from(table)
        .select('*')
        .eq('id', id)
        .eq('tenant_id', context.tenant_id)
        .single();

      if (!existingRecord) {
        throw new DataError(
          'Record not found',
          ErrorCodes.RESOURCE_NOT_FOUND,
          404
        );
      }

      const { error } = await this.supabase
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

      // Create audit log
      await this.createAuditLog({
        tenant_id: context.tenant_id,
        user_id: context.user_id,
        action: 'DELETE',
        resource_type: table,
        resource_id: id,
        old_values: existingRecord
      });

      // Emit event
      this.events.emit({
        id: uuidv4(),
        type: EventType.DATA_DELETED,
        tenant_id: context.tenant_id,
        user_id: context.user_id,
        timestamp: new Date().toISOString(),
        data: { table, record_id: id }
      });

      return { data: undefined };

    } catch (error) {
      if (error instanceof DataError) {
        throw error;
      }
      return { data: null, error: error.message };
    }
  }

  /**
   * Execute raw SQL query with tenant context
   */
  async query<T = any>(
    sql: string,
    params: any[] = [],
    context: TenantContext
  ): Promise<DataResult<T[]>> {
    try {
      // Inject tenant_id parameter for security
      const { data, error } = await this.supabase.rpc('execute_tenant_query', {
        query_sql: sql,
        query_params: params,
        tenant_id: context.tenant_id
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

  /**
   * Bulk operations with tenant isolation
   */
  async bulkCreate<T = any>(
    table: string,
    records: Partial<T>[],
    context: TenantContext
  ): Promise<DataResult<T[]>> {
    try {
      const recordsWithTenant = records.map(record => ({
        ...record,
        tenant_id: context.tenant_id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }));

      const { data, error } = await this.supabase
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

      // Create audit logs for each record
      for (const record of data || []) {
        await this.createAuditLog({
          tenant_id: context.tenant_id,
          user_id: context.user_id,
          action: 'BULK_CREATE',
          resource_type: table,
          resource_id: record.id,
          new_values: record
        });
      }

      return { data: data || [] };

    } catch (error) {
      if (error instanceof DataError) {
        throw error;
      }
      return { data: null, error: error.message };
    }
  }

  /**
   * Get audit logs for tenant
   */
  async getAuditLogs(
    context: TenantContext,
    options: {
      resource_type?: string;
      resource_id?: string;
      user_id?: string;
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<DataResult<AuditLog[]>> {
    try {
      let query = this.supabase
        .from('audit_logs')
        .select('*')
        .eq('tenant_id', context.tenant_id)
        .order('created_at', { ascending: false });

      if (options.resource_type) {
        query = query.eq('resource_type', options.resource_type);
      }

      if (options.resource_id) {
        query = query.eq('resource_id', options.resource_id);
      }

      if (options.user_id) {
        query = query.eq('user_id', options.user_id);
      }

      if (options.limit) {
        query = query.limit(options.limit);
      }

      if (options.offset) {
        query = query.range(
          options.offset,
          options.offset + (options.limit || 50) - 1
        );
      }

      const { data, error } = await query;

      if (error) {
        throw new DataError(
          'Failed to fetch audit logs',
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

  /**
   * Create audit log entry
   */
  private async createAuditLog(logData: {
    tenant_id: string;
    user_id: string;
    action: string;
    resource_type: string;
    resource_id?: string;
    old_values?: any;
    new_values?: any;
    metadata?: any;
  }): Promise<void> {
    try {
      const auditLog: Omit<AuditLog, 'id'> = {
        ...logData,
        created_at: new Date().toISOString()
      };

      await this.supabase
        .from('audit_logs')
        .insert({
          id: uuidv4(),
          ...auditLog
        });

    } catch (error) {
      // Don't throw on audit log failures, just log the error
      console.error('Failed to create audit log:', error);
    }
  }

  /**
   * Check if user has access to resource
   */
  async hasResourceAccess(
    table: string,
    resourceId: string,
    context: TenantContext
  ): Promise<boolean> {
    try {
      const { data } = await this.supabase
        .from(table)
        .select('id')
        .eq('id', resourceId)
        .eq('tenant_id', context.tenant_id)
        .single();

      return !!data;

    } catch (error) {
      return false;
    }
  }
}
