import { Pool, PoolClient, QueryResult } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { IDatabaseAdapter, ITransaction, Migration, DatabaseConfig } from '../../interfaces/IDatabaseAdapter';
import { QueryOptions, TenantContext, DataResult } from '../../types/data';
import { DataError, ErrorCodes } from '../../utils/errors';

/**
 * PostgreSQL database adapter implementation
 */
export class PostgreSQLAdapter implements IDatabaseAdapter {
  private pool: Pool;
  private config: DatabaseConfig;

  constructor(config: DatabaseConfig) {
    this.config = config;
    
    if (!config.host || !config.database || !config.username || !config.password) {
      throw new DataError(
        'PostgreSQL connection parameters are required',
        ErrorCodes.CONFIGURATION_ERROR,
        400
      );
    }

    this.pool = new Pool({
      host: config.host,
      port: config.port || 5432,
      database: config.database,
      user: config.username,
      password: config.password,
      ssl: config.ssl,
      min: config.pool?.min || 2,
      max: config.pool?.max || 10,
      acquireTimeoutMillis: config.pool?.acquireTimeoutMillis || 30000,
      idleTimeoutMillis: config.pool?.idleTimeoutMillis || 30000,
    });
  }

  async initialize(): Promise<void> {
    try {
      // Test connection
      const isConnected = await this.testConnection();
      if (!isConnected) {
        throw new DataError(
          'Failed to connect to PostgreSQL',
          ErrorCodes.DATABASE_ERROR,
          500
        );
      }

      // Set up tenant context function if not exists
      await this.setupTenantContextFunction();
    } catch (error) {
      throw new DataError(
        'Failed to initialize PostgreSQL adapter',
        ErrorCodes.DATABASE_ERROR,
        500,
        error
      );
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      const client = await this.pool.connect();
      await client.query('SELECT 1');
      client.release();
      return true;
    } catch (error) {
      return false;
    }
  }

  async query<T = any>(sql: string, params: any[] = []): Promise<DataResult<T[]>> {
    try {
      const result = await this.pool.query(sql, params);
      return { data: result.rows };
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
      const placeholders = values.map((_, index) => `$${index + 1}`).join(', ');

      const sql = `
        INSERT INTO ${this.escapeIdentifier(table)} (${columns.map(col => this.escapeIdentifier(col)).join(', ')})
        VALUES (${placeholders})
        RETURNING *
      `;

      const result = await this.pool.query(sql, values);
      
      if (result.rows.length === 0) {
        throw new DataError(
          'Failed to create record',
          ErrorCodes.DATABASE_ERROR,
          500
        );
      }

      return { data: result.rows[0] };
    } catch (error) {
      if (error instanceof DataError) {
        throw error;
      }
      return { data: null, error: error.message };
    }
  }

  async read<T = any>(table: string, options: QueryOptions, context: TenantContext): Promise<DataResult<T[]>> {
    try {
      let sql = `SELECT ${options.select || '*'} FROM ${this.escapeIdentifier(table)} WHERE tenant_id = $1`;
      const params: any[] = [context.tenant_id];
      let paramIndex = 2;

      // Apply filters
      if (options.filter) {
        Object.entries(options.filter).forEach(([key, value]) => {
          sql += ` AND ${this.escapeIdentifier(key)} = $${paramIndex}`;
          params.push(value);
          paramIndex++;
        });
      }

      // Apply ordering
      if (options.order) {
        const direction = options.order.ascending ? 'ASC' : 'DESC';
        sql += ` ORDER BY ${this.escapeIdentifier(options.order.column)} ${direction}`;
      }

      // Apply pagination
      if (options.limit) {
        sql += ` LIMIT $${paramIndex}`;
        params.push(options.limit);
        paramIndex++;
      }

      if (options.offset) {
        sql += ` OFFSET $${paramIndex}`;
        params.push(options.offset);
      }

      const result = await this.pool.query(sql, params);

      // Get total count if needed
      let count: number | undefined;
      if (options.limit || options.offset) {
        const countSql = `SELECT COUNT(*) FROM ${this.escapeIdentifier(table)} WHERE tenant_id = $1`;
        const countParams = [context.tenant_id];
        
        if (options.filter) {
          let countParamIndex = 2;
          Object.entries(options.filter).forEach(([key, value]) => {
            countSql += ` AND ${this.escapeIdentifier(key)} = $${countParamIndex}`;
            countParams.push(value);
            countParamIndex++;
          });
        }
        
        const countResult = await this.pool.query(countSql, countParams);
        count = parseInt(countResult.rows[0].count);
      }

      return { data: result.rows, count };
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
        .map((key, index) => `${this.escapeIdentifier(key)} = $${index + 3}`)
        .join(', ');

      const sql = `
        UPDATE ${this.escapeIdentifier(table)}
        SET ${setClause}
        WHERE id = $1 AND tenant_id = $2
        RETURNING *
      `;

      const params = [id, context.tenant_id, ...Object.values(updateData)];
      const result = await this.pool.query(sql, params);

      if (result.rows.length === 0) {
        throw new DataError(
          'Record not found or update failed',
          ErrorCodes.RESOURCE_NOT_FOUND,
          404
        );
      }

      return { data: result.rows[0] };
    } catch (error) {
      if (error instanceof DataError) {
        throw error;
      }
      return { data: null, error: error.message };
    }
  }

  async delete(table: string, id: string, context: TenantContext): Promise<DataResult<void>> {
    try {
      const sql = `DELETE FROM ${this.escapeIdentifier(table)} WHERE id = $1 AND tenant_id = $2`;
      const result = await this.pool.query(sql, [id, context.tenant_id]);

      if (result.rowCount === 0) {
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
        .map((_, recordIndex) => {
          const placeholders = columns
            .map((_, colIndex) => `$${recordIndex * columns.length + colIndex + 1}`)
            .join(', ');
          return `(${placeholders})`;
        })
        .join(', ');

      const sql = `
        INSERT INTO ${this.escapeIdentifier(table)} (${columns.map(col => this.escapeIdentifier(col)).join(', ')})
        VALUES ${valuesClause}
        RETURNING *
      `;

      const params = recordsWithTenant.flatMap(record => Object.values(record));
      const result = await this.pool.query(sql, params);

      return { data: result.rows };
    } catch (error) {
      return { data: null, error: error.message };
    }
  }

  async beginTransaction(): Promise<ITransaction> {
    const client = await this.pool.connect();
    await client.query('BEGIN');
    return new PostgreSQLTransaction(client);
  }

  async setupTenantIsolation(tenantId: string): Promise<void> {
    try {
      // Set up RLS policies for the tenant
      // This is a simplified example - in practice, you'd have more sophisticated policies
      
      const tables = ['tenants', 'users', 'tenant_users']; // Add your tables here
      
      for (const table of tables) {
        const policyName = `tenant_isolation_${table}`;
        
        // Drop existing policy if it exists
        await this.pool.query(`DROP POLICY IF EXISTS ${policyName} ON ${this.escapeIdentifier(table)}`);
        
        // Create new RLS policy
        const sql = `
          CREATE POLICY ${policyName} ON ${this.escapeIdentifier(table)}
          FOR ALL TO authenticated
          USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
        `;
        
        await this.pool.query(sql);
        
        // Enable RLS on table
        await this.pool.query(`ALTER TABLE ${this.escapeIdentifier(table)} ENABLE ROW LEVEL SECURITY`);
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
      await this.pool.query('SELECT set_config($1, $2, false)', ['app.current_tenant_id', tenantId]);
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
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');
      
      for (const migration of migrations) {
        // Check if migration already executed
        const existingMigration = await client.query(
          'SELECT id FROM migrations WHERE id = $1',
          [migration.id]
        );

        if (existingMigration.rows.length === 0) {
          // Execute migration
          await client.query(migration.up);

          // Record migration
          await client.query(
            `INSERT INTO migrations (id, name, version, tenant_id, executed_at, rollback_sql)
             VALUES ($1, $2, $3, $4, $5, $6)`,
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
      
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw new DataError(
        'Failed to run migrations',
        ErrorCodes.DATABASE_ERROR,
        500,
        error
      );
    } finally {
      client.release();
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
    return `"${identifier.replace(/"/g, '""')}"`;
  }

  /**
   * Set up tenant context function
   */
  private async setupTenantContextFunction(): Promise<void> {
    try {
      const sql = `
        CREATE OR REPLACE FUNCTION set_tenant_context(tenant_uuid uuid)
        RETURNS void AS $$
        BEGIN
          PERFORM set_config('app.current_tenant_id', tenant_uuid::text, false);
        END;
        $$ LANGUAGE plpgsql;
      `;
      
      await this.pool.query(sql);
    } catch (error) {
      // Function might already exist, which is fine
      console.warn('Could not create tenant context function:', error.message);
    }
  }
}

/**
 * PostgreSQL transaction implementation
 */
class PostgreSQLTransaction implements ITransaction {
  constructor(private client: PoolClient) {}

  async query<T = any>(sql: string, params: any[] = []): Promise<DataResult<T[]>> {
    try {
      const result = await this.client.query(sql, params);
      return { data: result.rows };
    } catch (error) {
      return { data: null, error: error.message };
    }
  }

  async commit(): Promise<void> {
    try {
      await this.client.query('COMMIT');
    } finally {
      this.client.release();
    }
  }

  async rollback(): Promise<void> {
    try {
      await this.client.query('ROLLBACK');
    } finally {
      this.client.release();
    }
  }
}
