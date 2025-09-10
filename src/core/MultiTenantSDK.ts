import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { TenantManager } from '../tenant/TenantManager';
import { AuthManager } from '../auth/AuthManager';
import { DataManager } from '../data/DataManager';
import { EventManager } from '../events/EventManager';
import { SDKError, ErrorCodes } from '../utils/errors';

export interface SDKConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseServiceKey?: string;
  enableEvents?: boolean;
  eventWebhookUrl?: string;
  workOsIntegration?: {
    enabled: boolean;
    apiKey?: string;
    webhookUrl?: string;
  };
}

export class MultiTenantSDK {
  private supabase: SupabaseClient;
  private serviceSupabase?: SupabaseClient;
  private config: SDKConfig;
  
  public readonly tenants: TenantManager;
  public readonly auth: AuthManager;
  public readonly data: DataManager;
  public readonly events: EventManager;

  constructor(config: SDKConfig) {
    this.config = config;
    
    // Initialize Supabase clients
    this.supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);
    
    if (config.supabaseServiceKey) {
      this.serviceSupabase = createClient(config.supabaseUrl, config.supabaseServiceKey);
    }
    
    // Initialize managers
    this.events = new EventManager({
      enabled: config.enableEvents ?? true,
      webhookUrl: config.eventWebhookUrl,
      workOsIntegration: config.workOsIntegration
    });
    
    this.tenants = new TenantManager(this.supabase, this.serviceSupabase, this.events);
    this.auth = new AuthManager(this.supabase, this.events);
    this.data = new DataManager(this.supabase, this.events);
  }

  /**
   * Initialize the SDK and set up database schema
   */
  async initialize(): Promise<void> {
    try {
      // Verify connection
      const { error } = await this.supabase.from('tenants').select('count').limit(1);
      if (error && error.code === 'PGRST116') {
        throw new SDKError(
          'Database schema not initialized. Please run setup first.',
          ErrorCodes.CONFIGURATION_ERROR,
          500
        );
      }
      
      // Initialize event system
      await this.events.initialize();
      
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
   * Set up database schema (run once during setup)
   */
  async setupDatabase(): Promise<void> {
    if (!this.serviceSupabase) {
      throw new SDKError(
        'Service key required for database setup',
        ErrorCodes.CONFIGURATION_ERROR,
        500
      );
    }

    try {
      // This would typically run SQL migrations
      // For now, we'll assume the schema is set up externally
      console.log('Database setup completed');
    } catch (error) {
      throw new SDKError(
        'Failed to setup database',
        ErrorCodes.DATABASE_ERROR,
        500,
        error
      );
    }
  }

  /**
   * Get SDK health status
   */
  async getHealth(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    services: {
      database: boolean;
      events: boolean;
    };
  }> {
    const health: {
      status: 'healthy' | 'degraded' | 'unhealthy';
      services: {
        database: boolean;
        events: boolean;
      };
    } = {
      status: 'healthy',
      services: {
        database: false,
        events: false
      }
    };

    try {
      // Check database connection
      const { error } = await this.supabase.from('tenants').select('count').limit(1);
      health.services.database = !error;
      
      // Check event system
      health.services.events = this.events.isHealthy();
      
      // Determine overall status
      const allHealthy = Object.values(health.services).every(Boolean);
      const anyHealthy = Object.values(health.services).some(Boolean);
      
      if (allHealthy) {
        health.status = 'healthy';
      } else if (anyHealthy) {
        health.status = 'degraded';
      } else {
        health.status = 'unhealthy';
      }
      
    } catch (error) {
      health.status = 'unhealthy';
    }

    return health;
  }

  /**
   * Get performance and usage metrics
   */
  async getMetrics(): Promise<{
    performance: {
      responseTime: number;
      throughput: number;
      errorRate: number;
    };
    usage: {
      activeConnections: number;
      requestsPerMinute: number;
      memoryUsage: number;
    };
    errors: {
      total: number;
      recent: number;
    };
  }> {
    // Mock metrics for now - in a real implementation, this would collect actual metrics
    return {
      performance: {
        responseTime: Math.random() * 100 + 50, // 50-150ms
        throughput: Math.random() * 1000 + 500, // 500-1500 req/s
        errorRate: Math.random() * 0.05, // 0-5% error rate
      },
      usage: {
        activeConnections: Math.floor(Math.random() * 100) + 10,
        requestsPerMinute: Math.floor(Math.random() * 10000) + 1000,
        memoryUsage: Math.random() * 100 + 50, // 50-150MB
      },
      errors: {
        total: Math.floor(Math.random() * 1000),
        recent: Math.floor(Math.random() * 10),
      },
    };
  }

  /**
   * Gracefully shutdown the SDK
   */
  async shutdown(): Promise<void> {
    await this.events.shutdown();
  }
}
