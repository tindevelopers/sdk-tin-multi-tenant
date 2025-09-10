import { IDatabaseAdapter, DatabaseConfig } from '../interfaces/IDatabaseAdapter';
import { SupabaseAdapter } from './database/SupabaseAdapter';
import { PostgreSQLAdapter } from './database/PostgreSQLAdapter';
import { MySQLAdapter } from './database/MySQLAdapter';
import { SDKError, ErrorCodes } from '../utils/errors';

/**
 * Factory for creating database adapters
 */
export class DatabaseAdapterFactory {
  /**
   * Create a database adapter based on configuration
   */
  static create(config: DatabaseConfig): IDatabaseAdapter {
    switch (config.type) {
      case 'supabase':
        return new SupabaseAdapter(config);
      
      case 'postgresql':
        return new PostgreSQLAdapter(config);
      
      case 'mysql':
        return new MySQLAdapter(config);
      
      case 'sqlite':
        // SQLite adapter would be implemented here
        throw new SDKError(
          'SQLite adapter not yet implemented',
          ErrorCodes.CONFIGURATION_ERROR,
          500
        );
      
      default:
        throw new SDKError(
          `Unsupported database type: ${config.type}`,
          ErrorCodes.CONFIGURATION_ERROR,
          500
        );
    }
  }

  /**
   * Get supported database types
   */
  static getSupportedTypes(): string[] {
    return ['supabase', 'postgresql', 'mysql'];
  }

  /**
   * Validate database configuration
   */
  static validateConfig(config: DatabaseConfig): void {
    if (!config.type) {
      throw new SDKError(
        'Database type is required',
        ErrorCodes.CONFIGURATION_ERROR,
        400
      );
    }

    if (!this.getSupportedTypes().includes(config.type)) {
      throw new SDKError(
        `Unsupported database type: ${config.type}`,
        ErrorCodes.CONFIGURATION_ERROR,
        400
      );
    }

    // Type-specific validation
    switch (config.type) {
      case 'supabase':
        this.validateSupabaseConfig(config);
        break;
      
      case 'postgresql':
      case 'mysql':
        this.validateSQLConfig(config);
        break;
    }
  }

  /**
   * Validate Supabase configuration
   */
  private static validateSupabaseConfig(config: DatabaseConfig): void {
    if (!config.supabaseUrl) {
      throw new SDKError(
        'Supabase URL is required',
        ErrorCodes.CONFIGURATION_ERROR,
        400
      );
    }

    if (!config.supabaseAnonKey) {
      throw new SDKError(
        'Supabase anonymous key is required',
        ErrorCodes.CONFIGURATION_ERROR,
        400
      );
    }
  }

  /**
   * Validate SQL database configuration
   */
  private static validateSQLConfig(config: DatabaseConfig): void {
    if (!config.host) {
      throw new SDKError(
        'Database host is required',
        ErrorCodes.CONFIGURATION_ERROR,
        400
      );
    }

    if (!config.database) {
      throw new SDKError(
        'Database name is required',
        ErrorCodes.CONFIGURATION_ERROR,
        400
      );
    }

    if (!config.username) {
      throw new SDKError(
        'Database username is required',
        ErrorCodes.CONFIGURATION_ERROR,
        400
      );
    }

    if (!config.password) {
      throw new SDKError(
        'Database password is required',
        ErrorCodes.CONFIGURATION_ERROR,
        400
      );
    }
  }

  /**
   * Create database adapter with validation
   */
  static createWithValidation(config: DatabaseConfig): IDatabaseAdapter {
    this.validateConfig(config);
    return this.create(config);
  }
}
