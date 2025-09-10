import { v4 as uuidv4 } from 'uuid';
import { IDatabaseAdapter } from '../interfaces/IDatabaseAdapter';
import { IEventProvider } from '../interfaces/IEventProvider';
import { QueryOptions, TenantContext, DataResult, AuditLog } from '../types/data';
import { EventType } from '../types/events';
import { DataError, ErrorCodes } from '../utils/errors';

/**
 * Data Manager V2 - Database agnostic implementation
 */
export class DataManagerV2 {
  constructor(
    private databaseAdapter: IDatabaseAdapter,
    private eventProvider?: IEventProvider
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
      const result = await this.databaseAdapter.create(table, data, context);

      if (result.data) {
        // Create audit log
        await this.createAuditLog({
          tenant_id: context.tenant_id,
          user_id: context.user_id,
          action: 'CREATE',
          resource_type: table,
          resource_id: result.data.id,
          new_values: data
        });

        // Emit event
        if (this.eventProvider) {
          await this.eventProvider.emit({
            id: uuidv4(),
            type: EventType.DATA_CREATED,
            tenant_id: context.tenant_id,
            user_id: context.user_id,
            timestamp: new Date().toISOString(),
            data: { table, record: result.data }
          });
        }
      }

      return result;
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
      return await this.databaseAdapter.read(table, options, context);
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
      // Get existing record for audit trail
      const existingResult = await this.databaseAdapter.read(
        table, 
        { filter: { id } }, 
        context
      );
      
      const existingRecord = existingResult.data?.[0];
      
      const result = await this.databaseAdapter.update(table, id, updates, context);

      if (result.data) {
        // Create audit log
        await this.createAuditLog({
          tenant_id: context.tenant_id,
          user_id: context.user_id,
          action: 'UPDATE',
          resource_type: table,
          resource_id: id,
          old_values: existingRecord,
          new_values: updates
        });

        // Emit event
        if (this.eventProvider) {
          await this.eventProvider.emit({
            id: uuidv4(),
            type: EventType.DATA_UPDATED,
            tenant_id: context.tenant_id,
            user_id: context.user_id,
            timestamp: new Date().toISOString(),
            data: { table, record: result.data, changes: updates }
          });
        }
      }

      return result;
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
      // Get existing record for audit trail
      const existingResult = await this.databaseAdapter.read(
        table, 
        { filter: { id } }, 
        context
      );
      
      const existingRecord = existingResult.data?.[0];
      
      const result = await this.databaseAdapter.delete(table, id, context);

      if (result.data === undefined) { // Successful deletion
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
        if (this.eventProvider) {
          await this.eventProvider.emit({
            id: uuidv4(),
            type: EventType.DATA_DELETED,
            tenant_id: context.tenant_id,
            user_id: context.user_id,
            timestamp: new Date().toISOString(),
            data: { table, record_id: id }
          });
        }
      }

      return result;
    } catch (error) {
      if (error instanceof DataError) {
        throw error;
      }
      return { data: null, error: error.message };
    }
  }

  /**
   * Execute raw query with tenant context
   */
  async query<T = any>(
    sql: string,
    params: any[] = [],
    context: TenantContext
  ): Promise<DataResult<T[]>> {
    try {
      // Set tenant context before executing query
      await this.databaseAdapter.setTenantContext(context.tenant_id);
      
      return await this.databaseAdapter.query(sql, params);
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
      const result = await this.databaseAdapter.bulkCreate(table, records, context);

      if (result.data) {
        // Create audit logs for each record
        for (const record of result.data) {
          await this.createAuditLog({
            tenant_id: context.tenant_id,
            user_id: context.user_id,
            action: 'BULK_CREATE',
            resource_type: table,
            resource_id: record.id,
            new_values: record
          });
        }

        // Emit bulk event
        if (this.eventProvider) {
          await this.eventProvider.emit({
            id: uuidv4(),
            type: EventType.DATA_CREATED,
            tenant_id: context.tenant_id,
            user_id: context.user_id,
            timestamp: new Date().toISOString(),
            data: { 
              table, 
              records: result.data,
              bulk: true,
              count: result.data.length
            }
          });
        }
      }

      return result;
    } catch (error) {
      if (error instanceof DataError) {
        throw error;
      }
      return { data: null, error: error.message };
    }
  }

  /**
   * Begin a database transaction
   */
  async beginTransaction() {
    try {
      return await this.databaseAdapter.beginTransaction();
    } catch (error) {
      throw new DataError(
        'Failed to begin transaction',
        ErrorCodes.DATABASE_ERROR,
        500,
        error
      );
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
      const queryOptions: QueryOptions = {
        filter: {},
        order: { column: 'created_at', ascending: false },
        limit: options.limit || 50,
        offset: options.offset || 0
      };

      if (options.resource_type) {
        queryOptions.filter!.resource_type = options.resource_type;
      }

      if (options.resource_id) {
        queryOptions.filter!.resource_id = options.resource_id;
      }

      if (options.user_id) {
        queryOptions.filter!.user_id = options.user_id;
      }

      return await this.databaseAdapter.read('audit_logs', queryOptions, context);
    } catch (error) {
      if (error instanceof DataError) {
        throw error;
      }
      return { data: null, error: error.message };
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
      const result = await this.databaseAdapter.read(
        table,
        { 
          select: 'id',
          filter: { id: resourceId }
        },
        context
      );

      return result.data && result.data.length > 0;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get table statistics
   */
  async getTableStats(
    table: string,
    context: TenantContext
  ): Promise<{
    totalRecords: number;
    createdToday: number;
    updatedToday: number;
  }> {
    try {
      // Total records
      const totalResult = await this.databaseAdapter.read(
        table,
        { select: 'COUNT(*) as count' },
        context
      );

      // Records created today
      const createdTodayResult = await this.databaseAdapter.query(
        `SELECT COUNT(*) as count FROM ${table} 
         WHERE tenant_id = ? AND DATE(created_at) = CURDATE()`,
        [context.tenant_id]
      );

      // Records updated today
      const updatedTodayResult = await this.databaseAdapter.query(
        `SELECT COUNT(*) as count FROM ${table} 
         WHERE tenant_id = ? AND DATE(updated_at) = CURDATE()`,
        [context.tenant_id]
      );

      return {
        totalRecords: totalResult.data?.[0]?.count || 0,
        createdToday: createdTodayResult.data?.[0]?.count || 0,
        updatedToday: updatedTodayResult.data?.[0]?.count || 0
      };
    } catch (error) {
      return {
        totalRecords: 0,
        createdToday: 0,
        updatedToday: 0
      };
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

      const context: TenantContext = {
        tenant_id: logData.tenant_id,
        user_id: logData.user_id,
        role: 'system',
        permissions: []
      };

      await this.databaseAdapter.create('audit_logs', {
        id: uuidv4(),
        ...auditLog
      }, context);

    } catch (error) {
      // Don't throw on audit log failures, just log the error
      console.error('Failed to create audit log:', error);
    }
  }
}
