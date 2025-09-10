import mysql from 'mysql2/promise';
import { v4 as uuidv4 } from 'uuid';
import { IDatabaseAdapter, ITransaction, Migration, DatabaseConfig } from '../../interfaces/IDatabaseAdapter';
import { QueryOptions, TenantContext, DataResult } from '../../types/data';
import { DataError, ErrorCodes } from '../../utils/errors';

/**
 * MySQL database adapter implementation
 */
export class MySQLAdapter implements IDatabaseAdapter {
  private pool: mysql.Pool;
  private config: DatabaseConfig;

  constructor(config: DatabaseConfig) {
    this.config = config;
    
    if (!config.host || !config.database || !config.username || !config.password) {
      throw new DataError(
        'MySQL connection parameters are required',
        ErrorCodes.CONFIGURATION_ERROR,
        400
      );
    }

    this.pool = mysql.createPool({
      host: config.host,
      port: config.port || 3306,
      database: config.database,
      user: config.username,
      password: config.password,
      ssl: config.ssl,
      connectionLimit: config.connectionLimit || 10,
      acquireTimeout: config.pool?.acquireTimeoutMillis || 30000,
      timeout: config.pool?.idleTimeoutMillis || 30000,
      charset: 'utf8mb4',
      timezone: 'Z'
    });
  }

  async initialize(): Promise<void> {
    try {
      // Test connection
      const isConnected = await this.testConnection();
      if (!isConnected) {
        throw new DataError(
          'Failed to connect to MySQL',
          ErrorCodes.DATABASE_ERROR,
          500
        );
      }

      // Set up session variables for tenant context
      await this.setupTenantContextSupport();
    } catch (error) {
      throw new DataError(
        'Failed to initialize MySQL adapter',
        ErrorCodes.DATABASE_ERROR,
        500,
        error
      );
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      const connection = await this.pool.getConnection();
      await connection.execute('SELECT 1');
      connection.release();
      return true;
    } catch (error) {
      return false;
    }
  }

  async query<T = any>(sql: string, params: any[] = []): Promise<DataResult<T[]>> {
    try {
      const [rows] = await this.pool.execute(sql, params);
      return { data: rows as T[] };
    } catch (error) {
      return { data: null, error: error.message };
    }
  }

  async create<T = any>(table: string, data: Partial<T>, context: TenantContext): Promise<DataResult<T>> {
    try {
      const recordData = {
        ...data,
        id: uuidv4(),
        tenant_id: context.tenant_id,
        created_at: new Date(),
        updated_at: new Date()
      };

      const columns = Object.keys(recordData);
      const values = Object.values(recordData);
      const placeholders = values.map(() => '?').join(', ');

      const sql = `
        INSERT INTO \`${this.escapeIdentifier(table)}\` (${columns.map(col => `\`${this.escapeIdentifier(col)}\``).join(', ')})
        VALUES (${placeholders})
      `;

      const [result] = await this.pool.execute(sql, values);
      
      // Get the inserted record
      const selectSql = `SELECT * FROM \`${this.escapeIdentifier(table)}\` WHERE id = ?`;
      const [selectResult] = await this.pool.execute(selectSql, [recordData.id]);
      const rows = selectResult as any[];
      
      if (rows.length === 0) {
        throw new DataError(
          'Failed to create record',
          ErrorCodes.DATABASE_ERROR,
          500
        );
      }

      return { data: rows[0] };
    } catch (error) {
      if (error instanceof DataError) {
        throw error;
      }
      return { data: null, error: error.message };
    }
  }

  async read<T = any>(table: string, options: QueryOptions, context: TenantContext): Promise<DataResult<T[]>> {
    try {
      let sql = `SELECT ${options.select || '*'} FROM \`${this.escapeIdentifier(table)}\` WHERE tenant_id = ?`;
      const params: any[] = [context.tenant_id];

      // Apply filters
      if (options.filter) {
        Object.entries(options.filter).forEach(([key, value]) => {
          sql += ` AND \`${this.escapeIdentifier(key)}\` = ?`;
          params.push(value);
        });
      }

      // Apply ordering
      if (options.order) {
        const direction = options.order.ascending ? 'ASC' : 'DESC';
        sql += ` ORDER BY \`${this.escapeIdentifier(options.order.column)}\` ${direction}`;
      }

      // Apply pagination
      if (options.limit) {
        sql += ` LIMIT ?`;
        params.push(options.limit);
      }

      if (options.offset) {
        sql += ` OFFSET ?`;
        params.push(options.offset);
      }

      const [rows] = await this.pool.execute(sql, params);

      // Get total count if needed
      let count: number | undefined;
      if (options.limit || options.offset) {
        let countSql = `SELECT COUNT(*) as count FROM \`${this.escapeIdentifier(table)}\` WHERE tenant_id = ?`;
        const countParams = [context.tenant_id];
        
        if (options.filter) {
          Object.entries(options.filter).forEach(([key, value]) => {
            countSql += ` AND \`${this.escapeIdentifier(key)}\` = ?`;
            countParams.push(value);
          });
        }
        
        const [countResult] = await this.pool.execute(countSql, countParams);
        const countRows = countResult as any[];
        count = countRows[0].count;
      }

      return { data: rows as T[], count };
    } catch (error) {
      return { data: null, error: error.message };
    }
  }

  async update<T = any>(table: string, id: string, updates: Partial<T>, context: TenantContext): Promise<DataResult<T>> {
    try {
      const updateData = {
        ...updates,
        updated_at: new Date()
      };

      const setClause = Object.keys(updateData)
        .map(key => `\`${this.escapeIdentifier(key)}\` = ?`)
        .join(', ');

      const sql = `
        UPDATE \`${this.escapeIdentifier(table)}\`
        SET ${setClause}
        WHERE id = ? AND tenant_id = ?
      `;

      const params = [...Object.values(updateData), id, context.tenant_id];
      const [result] = await this.pool.execute(sql, params);
      
      const updateResult = result as mysql.ResultSetHeader;
      if (updateResult.affectedRows === 0) {
        throw new DataError(
          'Record not found or update failed',
          ErrorCodes.RESOURCE_NOT_FOUND,
          404
        );
      }

      // Get the updated record
      const selectSql = `SELECT * FROM \`${this.escapeIdentifier(table)}\` WHERE id = ? AND tenant_id = ?`;
      const [selectResult] = await this.pool.execute(selectSql, [id, context.tenant_id]);
      const rows = selectResult as any[];

      return { data: rows[0] };
    } catch (error) {
      if (error instanceof DataError) {
        throw error;
      }
      return { data: null, error: error.message };
    }
  }

  async delete(table: string, id: string, context: TenantContext): Promise<DataResult<void>> {
    try {
      const sql = `DELETE FROM \`${this.escapeIdentifier(table)}\` WHERE id = ? AND tenant_id = ?`;
      const [result] = await this.pool.execute(sql, [id, context.tenant_id]);
      
      const deleteResult = result as mysql.ResultSetHeader;
      if (deleteResult.affectedRows === 0) {
        throw new DataError(
          'Record not found',
          ErrorCodes.RESOURCE_NOT_FOUND,
          404
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
      if (records.length === 0) {
        return { data: [] };
      }

      const recordsWithTenant = records.map(record => ({
        ...record,
        id: uuidv4(),
        tenant_id: context.tenant_id,
        created_at: new Date(),
        updated_at: new Date()
      }));

      const columns = Object.keys(recordsWithTenant[0]);
      const valuesClause = recordsWithTenant
        .map(() => `(${columns.map(() => '?').join(', ')})`)
        .join(', ');

      const sql = `
        INSERT INTO \`${this.escapeIdentifier(table)}\` (${columns.map(col => `\`${this.escapeIdentifier(col)}\``).join(', ')})
        VALUES ${valuesClause}
      `;

      const params = recordsWithTenant.flatMap(record => Object.values(record));
      await this.pool.execute(sql, params);

      // Get the inserted records
      const ids = recordsWithTenant.map(record => record.id);
      const selectSql = `
        SELECT * FROM \`${this.escapeIdentifier(table)}\` 
        WHERE id IN (${ids.map(() => '?').join(', ')}) AND tenant_id = ?
      `;
      
      const [selectResult] = await this.pool.execute(selectSql, [...ids, context.tenant_id]);

      return { data: selectResult as T[] };
    } catch (error) {
      return { data: null, error: error.message };
    }
  }

  async beginTransaction(): Promise<ITransaction> {
    const connection = await this.pool.getConnection();
    await connection.beginTransaction();
    return new MySQLTransaction(connection);
  }

  async setupTenantIsolation(tenantId: string): Promise<void> {
    try {
      // MySQL doesn't have RLS like PostgreSQL, so we implement tenant isolation
      // through application-level checks and views
      
      // Create tenant-specific views if they don't exist
      const tables = ['tenants', 'users', 'tenant_users']; // Add your tables here
      
      for (const table of tables) {
        const viewName = `${table}_tenant_view`;
        
        // Drop existing view if it exists
        await this.pool.execute(`DROP VIEW IF EXISTS \`${viewName}\``);
        
        // Create tenant-filtered view
        const sql = `
          CREATE VIEW \`${viewName}\` AS
          SELECT * FROM \`${this.escapeIdentifier(table)}\`
          WHERE tenant_id = @current_tenant_id
        `;
        
        await this.pool.execute(sql);
      }
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
      await this.pool.execute('SET @current_tenant_id = ?', [tenantId]);
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
    const connection = await this.pool.getConnection();
    
    try {
      await connection.beginTransaction();
      
      for (const migration of migrations) {
        // Check if migration already executed
        const [existingMigration] = await connection.execute(
          'SELECT id FROM migrations WHERE id = ?',
          [migration.id]
        );

        const rows = existingMigration as any[];
        if (rows.length === 0) {
          // Execute migration
          await connection.execute(migration.up);

          // Record migration
          await connection.execute(
            `INSERT INTO migrations (id, name, version, tenant_id, executed_at, rollback_sql)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
              migration.id,
              migration.name,
              migration.version,
              migration.tenant_id,
              new Date(),
              migration.down
            ]
          );
        }
      }
      
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw new DataError(
        'Failed to run migrations',
        ErrorCodes.DATABASE_ERROR,
        500,
        error
      );
    } finally {
      connection.release();
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
    await this.pool.end();
  }

  /**
   * Escape SQL identifiers to prevent injection
   */
  private escapeIdentifier(identifier: string): string {
    return identifier.replace(/`/g, '``');
  }

  /**
   * Set up tenant context support
   */
  private async setupTenantContextSupport(): Promise<void> {
    try {
      // Initialize session variable for tenant context
      await this.pool.execute('SET @current_tenant_id = NULL');
    } catch (error) {
      console.warn('Could not initialize tenant context support:', error.message);
    }
  }
}

/**
 * MySQL transaction implementation
 */
class MySQLTransaction implements ITransaction {
  constructor(private connection: mysql.PoolConnection) {}

  async query<T = any>(sql: string, params: any[] = []): Promise<DataResult<T[]>> {
    try {
      const [rows] = await this.connection.execute(sql, params);
      return { data: rows as T[] };
    } catch (error) {
      return { data: null, error: error.message };
    }
  }

  async commit(): Promise<void> {
    try {
      await this.connection.commit();
    } finally {
      this.connection.release();
    }
  }

  async rollback(): Promise<void> {
    try {
      await this.connection.rollback();
    } finally {
      this.connection.release();
    }
  }
}
