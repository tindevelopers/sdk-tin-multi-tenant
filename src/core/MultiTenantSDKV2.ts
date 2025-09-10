import { DatabaseAdapterFactory } from '../adapters/DatabaseAdapterFactory';
import { IDatabaseAdapter, DatabaseConfig } from '../interfaces/IDatabaseAdapter';
import { IAuthProvider, AuthProviderConfig } from '../interfaces/IAuthProvider';
import { IEventProvider, EventProviderConfig } from '../interfaces/IEventProvider';
import { TenantManagerV2 } from '../tenant/TenantManagerV2';
import { AuthManagerV2 } from '../auth/AuthManagerV2';
import { DataManagerV2 } from '../data/DataManagerV2';
import { EventManagerV2 } from '../events/EventManagerV2';
import { MigrationManager, MigrationConfig } from '../migration/MigrationManager';
import { SDKError, ErrorCodes } from '../utils/errors';

/**
 * Enhanced SDK configuration for Phase 2
 */
export interface SDKConfigV2 {
  // Database configuration
  database: DatabaseConfig;
  
  // Authentication configuration
  auth?: AuthProviderConfig;
  
  // Event system configuration
  events?: EventProviderConfig;
  
  // Migration configuration
  migrations?: MigrationConfig;
  
  // Feature flags
  features?: {
    enableEvents?: boolean;
    enableMigrations?: boolean;
    enableAuditLogs?: boolean;
    enableMetrics?: boolean;
  };
  
  // Work OS integration
  workOsIntegration?: {
    enabled: boolean;
    apiKey?: string;
    webhookUrl?: string;
    transformEvents?: boolean;
  };
  
  // Performance settings
  performance?: {
    connectionPoolSize?: number;
    queryTimeout?: number;
    cacheEnabled?: boolean;
    cacheTTL?: number;
  };
  
  // Security settings
  security?: {
    encryptionKey?: string;
    enableRLS?: boolean;
    auditLevel?: 'none' | 'basic' | 'detailed';
  };
}

/**
 * Multi-Tenant SDK Version 2 with database abstraction
 */
export class MultiTenantSDKV2 {
  private config: SDKConfigV2;
  private databaseAdapter: IDatabaseAdapter;
  private authProvider?: IAuthProvider;
  private eventProvider?: IEventProvider;
  private migrationManager?: MigrationManager;
  
  public readonly tenants: TenantManagerV2;
  public readonly auth: AuthManagerV2;
  public readonly data: DataManagerV2;
  public readonly events: EventManagerV2;
  public readonly migrations?: MigrationManager;

  constructor(config: SDKConfigV2) {
    this.config = this.validateConfig(config);
    
    // Initialize database adapter
    this.databaseAdapter = DatabaseAdapterFactory.createWithValidation(config.database);
    
    // Initialize optional providers
    if (config.auth) {
      // Auth provider would be created here based on config.auth.type
      // this.authProvider = AuthProviderFactory.create(config.auth);
    }
    
    if (config.events?.enabled !== false) {
      // Event provider would be created here based on config.events.type
      // this.eventProvider = EventProviderFactory.create(config.events);
    }
    
    // Initialize migration manager
    if (config.features?.enableMigrations !== false) {
      this.migrationManager = new MigrationManager(this.databaseAdapter, config.migrations);
      this.migrations = this.migrationManager;
    }
    
    // Initialize managers with adapters
    this.tenants = new TenantManagerV2(this.databaseAdapter, this.eventProvider);
    this.auth = new AuthManagerV2(this.databaseAdapter, this.authProvider, this.eventProvider);
    this.data = new DataManagerV2(this.databaseAdapter, this.eventProvider);
    this.events = new EventManagerV2(this.eventProvider);
  }

  /**
   * Initialize the SDK
   */
  async initialize(): Promise<void> {
    try {
      console.log('Initializing Multi-Tenant SDK V2...');
      
      // Initialize database adapter
      await this.databaseAdapter.initialize();
      console.log(`✓ Database adapter (${this.config.database.type}) initialized`);
      
      // Initialize auth provider
      if (this.authProvider) {
        await this.authProvider.initialize();
        console.log(`✓ Auth provider (${this.config.auth?.type}) initialized`);
      }
      
      // Initialize event provider
      if (this.eventProvider) {
        await this.eventProvider.initialize();
        console.log(`✓ Event provider (${this.config.events?.type || 'memory'}) initialized`);
      }
      
      // Initialize migration manager
      if (this.migrationManager) {
        await this.migrationManager.initialize();
        console.log('✓ Migration manager initialized');
      }
      
      console.log('✓ Multi-Tenant SDK V2 initialized successfully');
      
    } catch (error) {
      throw new SDKError(
        'Failed to initialize SDK',
        ErrorCodes.CONFIGURATION_ERROR,
        500,
        error
      );
    }
  }

  /**
   * Get comprehensive health status
   */
  async getHealth(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    services: {
      database: {
        connected: boolean;
        latency?: number;
        error?: string;
      };
      auth?: {
        connected: boolean;
        error?: string;
      };
      events?: {
        healthy: boolean;
        queueLength?: number;
      };
    };
    version: string;
    uptime: number;
  }> {
    const startTime = Date.now();
    
    const health = {
      status: 'healthy' as const,
      services: {
        database: await this.databaseAdapter.getHealth(),
        auth: this.authProvider ? await this.authProvider.getHealth() : undefined,
        events: this.eventProvider ? {
          healthy: this.eventProvider.isHealthy(),
          queueLength: this.eventProvider.getStats().queueLength
        } : undefined
      },
      version: '2.0.0',
      uptime: Date.now() - startTime
    };

    // Determine overall status
    const services = Object.values(health.services).filter(Boolean);
    const allHealthy = services.every(service => 
      'connected' in service ? service.connected : service.healthy
    );
    const anyHealthy = services.some(service => 
      'connected' in service ? service.connected : service.healthy
    );
    
    if (allHealthy) {
      health.status = 'healthy';
    } else if (anyHealthy) {
      health.status = 'degraded';
    } else {
      health.status = 'unhealthy';
    }

    return health;
  }

  /**
   * Get SDK metrics
   */
  async getMetrics(): Promise<{
    database: {
      type: string;
      connectionPool?: any;
      queryStats?: any;
    };
    events?: {
      stats: any;
    };
    tenants: {
      total: number;
      active: number;
    };
    users: {
      total: number;
      activeToday: number;
    };
  }> {
    try {
      // Get tenant metrics
      const { data: tenantStats } = await this.databaseAdapter.query(
        'SELECT status, COUNT(*) as count FROM tenants GROUP BY status'
      );
      
      const tenantCounts = tenantStats?.reduce((acc, stat) => {
        acc[stat.status] = stat.count;
        return acc;
      }, {} as Record<string, number>) || {};

      // Get user metrics
      const { data: userStats } = await this.databaseAdapter.query(
        'SELECT COUNT(*) as total FROM users'
      );
      
      const { data: activeUserStats } = await this.databaseAdapter.query(
        `SELECT COUNT(DISTINCT user_id) as active 
         FROM tenant_users 
         WHERE updated_at >= NOW() - INTERVAL '1 day'`
      );

      return {
        database: {
          type: this.config.database.type,
          connectionPool: {}, // Would include pool stats
          queryStats: {} // Would include query performance stats
        },
        events: this.eventProvider ? {
          stats: this.eventProvider.getStats()
        } : undefined,
        tenants: {
          total: Object.values(tenantCounts).reduce((sum, count) => sum + count, 0),
          active: tenantCounts.active || 0
        },
        users: {
          total: userStats?.[0]?.total || 0,
          activeToday: activeUserStats?.[0]?.active || 0
        }
      };
    } catch (error) {
      throw new SDKError(
        'Failed to get metrics',
        ErrorCodes.DATABASE_ERROR,
        500,
        error
      );
    }
  }

  /**
   * Switch database adapter (for migration scenarios)
   */
  async switchDatabase(newConfig: DatabaseConfig): Promise<void> {
    try {
      console.log(`Switching from ${this.config.database.type} to ${newConfig.type}...`);
      
      // Create new adapter
      const newAdapter = DatabaseAdapterFactory.createWithValidation(newConfig);
      await newAdapter.initialize();
      
      // Close old adapter
      await this.databaseAdapter.close();
      
      // Update configuration and adapter
      this.config.database = newConfig;
      this.databaseAdapter = newAdapter;
      
      // Reinitialize managers with new adapter
      // Note: This would require updating the managers to accept new adapters
      console.log(`✓ Successfully switched to ${newConfig.type}`);
      
    } catch (error) {
      throw new SDKError(
        'Failed to switch database',
        ErrorCodes.DATABASE_ERROR,
        500,
        error
      );
    }
  }

  /**
   * Export configuration for backup/migration
   */
  exportConfig(): Omit<SDKConfigV2, 'database'> & { 
    database: Omit<DatabaseConfig, 'password' | 'supabaseServiceKey'> 
  } {
    const { database, ...otherConfig } = this.config;
    const { password, supabaseServiceKey, ...safeDbConfig } = database;
    
    return {
      ...otherConfig,
      database: safeDbConfig
    };
  }

  /**
   * Gracefully shutdown the SDK
   */
  async shutdown(): Promise<void> {
    try {
      console.log('Shutting down Multi-Tenant SDK V2...');
      
      // Shutdown event provider
      if (this.eventProvider) {
        await this.eventProvider.shutdown();
        console.log('✓ Event provider shutdown');
      }
      
      // Close database connections
      await this.databaseAdapter.close();
      console.log('✓ Database connections closed');
      
      console.log('✓ Multi-Tenant SDK V2 shutdown complete');
      
    } catch (error) {
      console.error('Error during SDK shutdown:', error);
    }
  }

  /**
   * Validate SDK configuration
   */
  private validateConfig(config: SDKConfigV2): SDKConfigV2 {
    if (!config.database) {
      throw new SDKError(
        'Database configuration is required',
        ErrorCodes.CONFIGURATION_ERROR,
        400
      );
    }

    // Validate database config
    DatabaseAdapterFactory.validateConfig(config.database);

    // Set defaults
    const validatedConfig: SDKConfigV2 = {
      ...config,
      features: {
        enableEvents: true,
        enableMigrations: true,
        enableAuditLogs: true,
        enableMetrics: true,
        ...config.features
      },
      performance: {
        connectionPoolSize: 10,
        queryTimeout: 30000,
        cacheEnabled: false,
        cacheTTL: 300000,
        ...config.performance
      },
      security: {
        enableRLS: true,
        auditLevel: 'basic',
        ...config.security
      }
    };

    return validatedConfig;
  }
}
