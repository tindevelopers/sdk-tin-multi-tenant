import { v4 as uuidv4 } from 'uuid';
import { IDatabaseAdapter } from '../interfaces/IDatabaseAdapter';
import { IEventProvider } from '../interfaces/IEventProvider';
import { ICacheProvider } from '../interfaces/ICacheProvider';
import { AnalyticsEngine } from '../analytics/AnalyticsEngine';
import { QueryOptions, TenantContext, DataResult, AuditLog } from '../types/data';
import { EventType } from '../types/events';
import { DataError, ErrorCodes } from '../utils/errors';

/**
 * Data Manager V3 - Enhanced with caching and analytics
 */
export class DataManagerV3 {
  constructor(
    private databaseAdapter: IDatabaseAdapter,
    private eventProvider?: IEventProvider,
    private cacheProvider?: ICacheProvider,
    private analyticsEngine?: AnalyticsEngine
  ) {}

  /**
   * Create a record with tenant isolation, caching, and analytics
   */
  async create<T = any>(
    table: string,
    data: Partial<T>,
    context: TenantContext,
    options?: {
      skipCache?: boolean;
      skipAnalytics?: boolean;
      cacheTTL?: number;
    }
  ): Promise<DataResult<T>> {
    const startTime = Date.now();
    
    try {
      const result = await this.databaseAdapter.create(table, data, context);

      if (result.data) {
        // Cache the created record
        if (this.cacheProvider && !options?.skipCache) {
          const cacheKey = `${table}:${result.data.id}`;
          await this.cacheProvider.set(
            cacheKey, 
            result.data, 
            context, 
            options?.cacheTTL || 3600
          );
        }

        // Track analytics
        if (this.analyticsEngine && !options?.skipAnalytics) {
          await this.analyticsEngine.trackEvent('record_created', {
            table,
            record_id: result.data.id,
            response_time: Date.now() - startTime
          }, context);

          await this.analyticsEngine.incrementCounter('records_created', context, 1, {
            table
          });
        }

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
      // Track error analytics
      if (this.analyticsEngine && !options?.skipAnalytics) {
        await this.analyticsEngine.trackEvent('record_create_error', {
          table,
          error: error.message,
          response_time: Date.now() - startTime
        }, context);
      }

      if (error instanceof DataError) {
        throw error;
      }
      return { data: null, error: error.message };
    }
  }

  /**
   * Read records with caching and analytics
   */
  async read<T = any>(
    table: string,
    options: QueryOptions = {},
    context: TenantContext,
    cacheOptions?: {
      useCache?: boolean;
      cacheTTL?: number;
      cacheKey?: string;
    }
  ): Promise<DataResult<T[]>> {
    const startTime = Date.now();
    
    try {
      // Try cache first if enabled
      if (this.cacheProvider && cacheOptions?.useCache !== false) {
        const cacheKey = cacheOptions?.cacheKey || 
          `${table}:query:${JSON.stringify(options)}:${context.tenant_id}`;
        
        const cachedResult = await this.cacheProvider.get<T[]>(cacheKey, context);
        
        if (cachedResult) {
          // Track cache hit
          if (this.analyticsEngine) {
            await this.analyticsEngine.trackEvent('cache_hit', {
              table,
              cache_key: cacheKey,
              response_time: Date.now() - startTime
            }, context);
          }
          
          return { data: cachedResult };
        }
      }

      // Fetch from database
      const result = await this.databaseAdapter.read(table, options, context);

      if (result.data && this.cacheProvider && cacheOptions?.useCache !== false) {
        // Cache the result
        const cacheKey = cacheOptions?.cacheKey || 
          `${table}:query:${JSON.stringify(options)}:${context.tenant_id}`;
        
        await this.cacheProvider.set(
          cacheKey, 
          result.data, 
          context, 
          cacheOptions?.cacheTTL || 300 // 5 minutes default
        );
      }

      // Track analytics
      if (this.analyticsEngine) {
        await this.analyticsEngine.trackEvent('records_read', {
          table,
          count: result.data?.length || 0,
          response_time: Date.now() - startTime,
          cache_miss: true
        }, context);

        await this.analyticsEngine.incrementCounter('records_read', context, 1, {
          table
        });
      }

      return result;
    } catch (error) {
      // Track error analytics
      if (this.analyticsEngine) {
        await this.analyticsEngine.trackEvent('record_read_error', {
          table,
          error: error.message,
          response_time: Date.now() - startTime
        }, context);
      }

      if (error instanceof DataError) {
        throw error;
      }
      return { data: null, error: error.message };
    }
  }

  /**
   * Update a record with cache invalidation and analytics
   */
  async update<T = any>(
    table: string,
    id: string,
    updates: Partial<T>,
    context: TenantContext,
    options?: {
      skipCache?: boolean;
      skipAnalytics?: boolean;
      invalidateCache?: boolean;
    }
  ): Promise<DataResult<T>> {
    const startTime = Date.now();
    
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
        // Update cache
        if (this.cacheProvider && !options?.skipCache) {
          const cacheKey = `${table}:${id}`;
          await this.cacheProvider.set(cacheKey, result.data, context, 3600);
          
          // Invalidate related cache entries if requested
          if (options?.invalidateCache) {
            await this.invalidateRelatedCache(table, context);
          }
        }

        // Track analytics
        if (this.analyticsEngine && !options?.skipAnalytics) {
          await this.analyticsEngine.trackEvent('record_updated', {
            table,
            record_id: id,
            fields_updated: Object.keys(updates),
            response_time: Date.now() - startTime
          }, context);

          await this.analyticsEngine.incrementCounter('records_updated', context, 1, {
            table
          });
        }

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
      // Track error analytics
      if (this.analyticsEngine && !options?.skipAnalytics) {
        await this.analyticsEngine.trackEvent('record_update_error', {
          table,
          record_id: id,
          error: error.message,
          response_time: Date.now() - startTime
        }, context);
      }

      if (error instanceof DataError) {
        throw error;
      }
      return { data: null, error: error.message };
    }
  }

  /**
   * Delete a record with cache invalidation and analytics
   */
  async delete(
    table: string,
    id: string,
    context: TenantContext,
    options?: {
      skipAnalytics?: boolean;
      invalidateCache?: boolean;
    }
  ): Promise<DataResult<void>> {
    const startTime = Date.now();
    
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
        // Remove from cache
        if (this.cacheProvider) {
          const cacheKey = `${table}:${id}`;
          await this.cacheProvider.delete(cacheKey, context);
          
          // Invalidate related cache entries if requested
          if (options?.invalidateCache) {
            await this.invalidateRelatedCache(table, context);
          }
        }

        // Track analytics
        if (this.analyticsEngine && !options?.skipAnalytics) {
          await this.analyticsEngine.trackEvent('record_deleted', {
            table,
            record_id: id,
            response_time: Date.now() - startTime
          }, context);

          await this.analyticsEngine.incrementCounter('records_deleted', context, 1, {
            table
          });
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
      // Track error analytics
      if (this.analyticsEngine && !options?.skipAnalytics) {
        await this.analyticsEngine.trackEvent('record_delete_error', {
          table,
          record_id: id,
          error: error.message,
          response_time: Date.now() - startTime
        }, context);
      }

      if (error instanceof DataError) {
        throw error;
      }
      return { data: null, error: error.message };
    }
  }

  /**
   * Get record by ID with caching
   */
  async getById<T = any>(
    table: string,
    id: string,
    context: TenantContext,
    options?: {
      useCache?: boolean;
      cacheTTL?: number;
    }
  ): Promise<DataResult<T | null>> {
    const startTime = Date.now();
    
    try {
      // Try cache first
      if (this.cacheProvider && options?.useCache !== false) {
        const cacheKey = `${table}:${id}`;
        const cachedRecord = await this.cacheProvider.get<T>(cacheKey, context);
        
        if (cachedRecord) {
          // Track cache hit
          if (this.analyticsEngine) {
            await this.analyticsEngine.trackEvent('cache_hit', {
              table,
              record_id: id,
              response_time: Date.now() - startTime
            }, context);
          }
          
          return { data: cachedRecord };
        }
      }

      // Fetch from database
      const result = await this.databaseAdapter.read(
        table,
        { filter: { id }, limit: 1 },
        context
      );

      const record = result.data?.[0] || null;

      // Cache the result if found
      if (record && this.cacheProvider && options?.useCache !== false) {
        const cacheKey = `${table}:${id}`;
        await this.cacheProvider.set(
          cacheKey, 
          record, 
          context, 
          options?.cacheTTL || 3600
        );
      }

      // Track analytics
      if (this.analyticsEngine) {
        await this.analyticsEngine.trackEvent('record_get_by_id', {
          table,
          record_id: id,
          found: !!record,
          response_time: Date.now() - startTime,
          cache_miss: true
        }, context);
      }

      return { data: record };
    } catch (error) {
      if (error instanceof DataError) {
        throw error;
      }
      return { data: null, error: error.message };
    }
  }

  /**
   * Bulk operations with enhanced performance
   */
  async bulkCreate<T = any>(
    table: string,
    records: Partial<T>[],
    context: TenantContext,
    options?: {
      batchSize?: number;
      skipCache?: boolean;
      skipAnalytics?: boolean;
    }
  ): Promise<DataResult<T[]>> {
    const startTime = Date.now();
    const batchSize = options?.batchSize || 100;
    
    try {
      const results: T[] = [];
      
      // Process in batches for better performance
      for (let i = 0; i < records.length; i += batchSize) {
        const batch = records.slice(i, i + batchSize);
        const batchResult = await this.databaseAdapter.bulkCreate(table, batch, context);
        
        if (batchResult.data) {
          results.push(...batchResult.data);
          
          // Cache created records
          if (this.cacheProvider && !options?.skipCache) {
            const cachePromises = batchResult.data.map(record => {
              const cacheKey = `${table}:${record.id}`;
              return this.cacheProvider!.set(cacheKey, record, context, 3600);
            });
            
            await Promise.all(cachePromises);
          }
        }
      }

      // Track analytics
      if (this.analyticsEngine && !options?.skipAnalytics) {
        await this.analyticsEngine.trackEvent('bulk_create', {
          table,
          count: results.length,
          batch_size: batchSize,
          response_time: Date.now() - startTime
        }, context);

        await this.analyticsEngine.incrementCounter('records_bulk_created', context, results.length, {
          table
        });
      }

      // Create audit logs for each record
      for (const record of results) {
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
            records: results,
            bulk: true,
            count: results.length
          }
        });
      }

      return { data: results };
    } catch (error) {
      // Track error analytics
      if (this.analyticsEngine && !options?.skipAnalytics) {
        await this.analyticsEngine.trackEvent('bulk_create_error', {
          table,
          count: records.length,
          error: error.message,
          response_time: Date.now() - startTime
        }, context);
      }

      if (error instanceof DataError) {
        throw error;
      }
      return { data: null, error: error.message };
    }
  }

  /**
   * Search with full-text search and caching
   */
  async search<T = any>(
    table: string,
    searchTerm: string,
    context: TenantContext,
    options?: {
      fields?: string[];
      limit?: number;
      offset?: number;
      useCache?: boolean;
      cacheTTL?: number;
    }
  ): Promise<DataResult<T[]>> {
    const startTime = Date.now();
    
    try {
      // Try cache first
      if (this.cacheProvider && options?.useCache !== false) {
        const cacheKey = `search:${table}:${searchTerm}:${JSON.stringify(options)}:${context.tenant_id}`;
        const cachedResult = await this.cacheProvider.get<T[]>(cacheKey, context);
        
        if (cachedResult) {
          // Track cache hit
          if (this.analyticsEngine) {
            await this.analyticsEngine.trackEvent('search_cache_hit', {
              table,
              search_term: searchTerm,
              response_time: Date.now() - startTime
            }, context);
          }
          
          return { data: cachedResult };
        }
      }

      // Build search query (this is database-specific)
      const searchFields = options?.fields || ['name', 'description', 'title'];
      const searchQuery = searchFields.map(field => `${field} ILIKE ?`).join(' OR ');
      const searchValue = `%${searchTerm}%`;
      const searchParams = searchFields.map(() => searchValue);

      // Execute search
      const result = await this.databaseAdapter.query(
        `SELECT * FROM ${table} 
         WHERE tenant_id = ? AND (${searchQuery})
         ORDER BY updated_at DESC
         LIMIT ? OFFSET ?`,
        [context.tenant_id, ...searchParams, options?.limit || 50, options?.offset || 0]
      );

      // Cache the result
      if (result.data && this.cacheProvider && options?.useCache !== false) {
        const cacheKey = `search:${table}:${searchTerm}:${JSON.stringify(options)}:${context.tenant_id}`;
        await this.cacheProvider.set(
          cacheKey, 
          result.data, 
          context, 
          options?.cacheTTL || 300 // 5 minutes
        );
      }

      // Track analytics
      if (this.analyticsEngine) {
        await this.analyticsEngine.trackEvent('search_performed', {
          table,
          search_term: searchTerm,
          results_count: result.data?.length || 0,
          response_time: Date.now() - startTime
        }, context);

        await this.analyticsEngine.incrementCounter('searches_performed', context, 1, {
          table
        });
      }

      return result;
    } catch (error) {
      // Track error analytics
      if (this.analyticsEngine) {
        await this.analyticsEngine.trackEvent('search_error', {
          table,
          search_term: searchTerm,
          error: error.message,
          response_time: Date.now() - startTime
        }, context);
      }

      if (error instanceof DataError) {
        throw error;
      }
      return { data: null, error: error.message };
    }
  }

  /**
   * Invalidate related cache entries
   */
  private async invalidateRelatedCache(table: string, context: TenantContext): Promise<void> {
    if (!this.cacheProvider) return;

    try {
      // This would implement cache invalidation patterns
      // For now, we'll clear tenant-specific cache
      await this.cacheProvider.clearTenant(context.tenant_id);
    } catch (error) {
      console.warn('Failed to invalidate cache:', error.message);
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
