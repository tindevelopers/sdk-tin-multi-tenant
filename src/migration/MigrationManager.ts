import { IDatabaseAdapter, Migration } from '../interfaces/IDatabaseAdapter';
import { SDKError, ErrorCodes } from '../utils/errors';
import { validateSchema } from '../utils/validation';
import { z } from 'zod';

/**
 * Migration configuration schema
 */
const MigrationConfigSchema = z.object({
  migrationsPath: z.string().optional(),
  autoRun: z.boolean().default(false),
  createMigrationsTable: z.boolean().default(true),
  lockTimeout: z.number().default(30000),
  batchSize: z.number().default(10)
});

export type MigrationConfig = z.infer<typeof MigrationConfigSchema>;

/**
 * Migration status enum
 */
export enum MigrationStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  ROLLED_BACK = 'rolled_back'
}

/**
 * Migration execution result
 */
export interface MigrationResult {
  id: string;
  name: string;
  status: MigrationStatus;
  executedAt?: Date;
  duration?: number;
  error?: string;
}

/**
 * Migration manager for handling database migrations across different adapters
 */
export class MigrationManager {
  private adapter: IDatabaseAdapter;
  private config: MigrationConfig;
  private isLocked = false;

  constructor(adapter: IDatabaseAdapter, config: MigrationConfig = {}) {
    this.adapter = adapter;
    this.config = validateSchema(MigrationConfigSchema, config);
  }

  /**
   * Initialize migration system
   */
  async initialize(): Promise<void> {
    try {
      if (this.config.createMigrationsTable) {
        await this.createMigrationsTable();
      }
    } catch (error) {
      throw new SDKError(
        'Failed to initialize migration manager',
        ErrorCodes.DATABASE_ERROR,
        500,
        error
      );
    }
  }

  /**
   * Run pending migrations
   */
  async runMigrations(migrations: Migration[]): Promise<MigrationResult[]> {
    if (this.isLocked) {
      throw new SDKError(
        'Migration is already in progress',
        ErrorCodes.DATABASE_ERROR,
        409
      );
    }

    try {
      await this.acquireLock();
      
      const results: MigrationResult[] = [];
      const pendingMigrations = await this.getPendingMigrations(migrations);
      
      console.log(`Running ${pendingMigrations.length} pending migrations...`);
      
      for (const migration of pendingMigrations) {
        const result = await this.runSingleMigration(migration);
        results.push(result);
        
        if (result.status === MigrationStatus.FAILED) {
          console.error(`Migration ${migration.id} failed:`, result.error);
          break; // Stop on first failure
        }
      }
      
      return results;
    } finally {
      await this.releaseLock();
    }
  }

  /**
   * Rollback migrations to a specific version
   */
  async rollbackTo(targetVersion: string): Promise<MigrationResult[]> {
    if (this.isLocked) {
      throw new SDKError(
        'Migration is already in progress',
        ErrorCodes.DATABASE_ERROR,
        409
      );
    }

    try {
      await this.acquireLock();
      
      const results: MigrationResult[] = [];
      const migrationsToRollback = await this.getMigrationsToRollback(targetVersion);
      
      console.log(`Rolling back ${migrationsToRollback.length} migrations...`);
      
      // Rollback in reverse order
      for (const migration of migrationsToRollback.reverse()) {
        const result = await this.rollbackSingleMigration(migration);
        results.push(result);
        
        if (result.status === MigrationStatus.FAILED) {
          console.error(`Rollback of ${migration.id} failed:`, result.error);
          break; // Stop on first failure
        }
      }
      
      return results;
    } finally {
      await this.releaseLock();
    }
  }

  /**
   * Get migration status
   */
  async getMigrationStatus(): Promise<{
    total: number;
    executed: number;
    pending: number;
    failed: number;
  }> {
    try {
      const { data: executedMigrations } = await this.adapter.query(
        'SELECT status FROM migrations'
      );

      const statusCounts = executedMigrations?.reduce((acc, migration) => {
        acc[migration.status] = (acc[migration.status] || 0) + 1;
        return acc;
      }, {} as Record<string, number>) || {};

      return {
        total: executedMigrations?.length || 0,
        executed: statusCounts[MigrationStatus.COMPLETED] || 0,
        pending: statusCounts[MigrationStatus.PENDING] || 0,
        failed: statusCounts[MigrationStatus.FAILED] || 0
      };
    } catch (error) {
      throw new SDKError(
        'Failed to get migration status',
        ErrorCodes.DATABASE_ERROR,
        500,
        error
      );
    }
  }

  /**
   * Generate migration file template
   */
  generateMigrationTemplate(name: string, tenantId?: string): Migration {
    const timestamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0];
    const id = `${timestamp}_${name.toLowerCase().replace(/\s+/g, '_')}`;
    
    return {
      id,
      name,
      version: timestamp,
      tenant_id: tenantId,
      up: `-- Migration: ${name}\n-- Created: ${new Date().toISOString()}\n\n-- Add your migration SQL here\n`,
      down: `-- Rollback: ${name}\n-- Created: ${new Date().toISOString()}\n\n-- Add your rollback SQL here\n`
    };
  }

  /**
   * Validate migration
   */
  validateMigration(migration: Migration): void {
    if (!migration.id) {
      throw new SDKError(
        'Migration ID is required',
        ErrorCodes.CONFIGURATION_ERROR,
        400
      );
    }

    if (!migration.name) {
      throw new SDKError(
        'Migration name is required',
        ErrorCodes.CONFIGURATION_ERROR,
        400
      );
    }

    if (!migration.up) {
      throw new SDKError(
        'Migration up SQL is required',
        ErrorCodes.CONFIGURATION_ERROR,
        400
      );
    }

    if (!migration.down) {
      throw new SDKError(
        'Migration down SQL is required',
        ErrorCodes.CONFIGURATION_ERROR,
        400
      );
    }
  }

  /**
   * Create migrations table if it doesn't exist
   */
  private async createMigrationsTable(): Promise<void> {
    const sql = `
      CREATE TABLE IF NOT EXISTS migrations (
        id VARCHAR(255) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        version VARCHAR(255) NOT NULL,
        tenant_id VARCHAR(36),
        status VARCHAR(50) DEFAULT 'completed',
        executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        rollback_sql TEXT,
        error_message TEXT,
        duration_ms INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;

    await this.adapter.query(sql);
  }

  /**
   * Get pending migrations
   */
  private async getPendingMigrations(migrations: Migration[]): Promise<Migration[]> {
    const { data: executedMigrations } = await this.adapter.query(
      'SELECT id FROM migrations WHERE status = ?',
      [MigrationStatus.COMPLETED]
    );

    const executedIds = new Set(executedMigrations?.map(m => m.id) || []);
    
    return migrations.filter(migration => {
      this.validateMigration(migration);
      return !executedIds.has(migration.id);
    });
  }

  /**
   * Get migrations to rollback
   */
  private async getMigrationsToRollback(targetVersion: string): Promise<Migration[]> {
    const { data: migrationsToRollback } = await this.adapter.query(
      `SELECT * FROM migrations 
       WHERE version > ? AND status = ? 
       ORDER BY version DESC`,
      [targetVersion, MigrationStatus.COMPLETED]
    );

    return migrationsToRollback || [];
  }

  /**
   * Run a single migration
   */
  private async runSingleMigration(migration: Migration): Promise<MigrationResult> {
    const startTime = Date.now();
    
    try {
      // Mark as running
      await this.recordMigrationStart(migration);
      
      // Execute migration
      await this.adapter.query(migration.up);
      
      const duration = Date.now() - startTime;
      
      // Mark as completed
      await this.recordMigrationCompletion(migration, duration);
      
      console.log(`✓ Migration ${migration.id} completed in ${duration}ms`);
      
      return {
        id: migration.id,
        name: migration.name,
        status: MigrationStatus.COMPLETED,
        executedAt: new Date(),
        duration
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      
      // Mark as failed
      await this.recordMigrationFailure(migration, error.message, duration);
      
      return {
        id: migration.id,
        name: migration.name,
        status: MigrationStatus.FAILED,
        duration,
        error: error.message
      };
    }
  }

  /**
   * Rollback a single migration
   */
  private async rollbackSingleMigration(migration: any): Promise<MigrationResult> {
    const startTime = Date.now();
    
    try {
      // Execute rollback
      await this.adapter.query(migration.rollback_sql);
      
      const duration = Date.now() - startTime;
      
      // Remove from migrations table
      await this.adapter.query('DELETE FROM migrations WHERE id = ?', [migration.id]);
      
      console.log(`✓ Migration ${migration.id} rolled back in ${duration}ms`);
      
      return {
        id: migration.id,
        name: migration.name,
        status: MigrationStatus.ROLLED_BACK,
        executedAt: new Date(),
        duration
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      
      return {
        id: migration.id,
        name: migration.name,
        status: MigrationStatus.FAILED,
        duration,
        error: error.message
      };
    }
  }

  /**
   * Record migration start
   */
  private async recordMigrationStart(migration: Migration): Promise<void> {
    await this.adapter.query(
      `INSERT INTO migrations (id, name, version, tenant_id, status, rollback_sql)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        migration.id,
        migration.name,
        migration.version,
        migration.tenant_id,
        MigrationStatus.RUNNING,
        migration.down
      ]
    );
  }

  /**
   * Record migration completion
   */
  private async recordMigrationCompletion(migration: Migration, duration: number): Promise<void> {
    await this.adapter.query(
      `UPDATE migrations 
       SET status = ?, executed_at = ?, duration_ms = ?, updated_at = ?
       WHERE id = ?`,
      [
        MigrationStatus.COMPLETED,
        new Date(),
        duration,
        new Date(),
        migration.id
      ]
    );
  }

  /**
   * Record migration failure
   */
  private async recordMigrationFailure(migration: Migration, error: string, duration: number): Promise<void> {
    await this.adapter.query(
      `UPDATE migrations 
       SET status = ?, error_message = ?, duration_ms = ?, updated_at = ?
       WHERE id = ?`,
      [
        MigrationStatus.FAILED,
        error,
        duration,
        new Date(),
        migration.id
      ]
    );
  }

  /**
   * Acquire migration lock
   */
  private async acquireLock(): Promise<void> {
    // Simple in-memory lock for now
    // In production, you'd use database-level locking
    if (this.isLocked) {
      throw new SDKError(
        'Migration lock already acquired',
        ErrorCodes.DATABASE_ERROR,
        409
      );
    }
    
    this.isLocked = true;
    
    // Set timeout to release lock
    setTimeout(() => {
      this.isLocked = false;
    }, this.config.lockTimeout);
  }

  /**
   * Release migration lock
   */
  private async releaseLock(): Promise<void> {
    this.isLocked = false;
  }
}
