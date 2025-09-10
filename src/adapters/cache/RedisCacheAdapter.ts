import Redis from 'ioredis';
import { ICacheProvider, CacheStats, CacheConfig } from '../../interfaces/ICacheProvider';
import { TenantContext } from '../../types/data';
import { SDKError, ErrorCodes } from '../../utils/errors';

/**
 * Redis cache adapter with tenant isolation
 */
export class RedisCacheAdapter implements ICacheProvider {
  private redis: Redis;
  private config: CacheConfig;
  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    hitRate: 0,
    totalKeys: 0
  };

  constructor(config: CacheConfig) {
    this.config = config;
    
    if (!config.redis) {
      throw new SDKError(
        'Redis configuration is required',
        ErrorCodes.CONFIGURATION_ERROR,
        400
      );
    }

    // Initialize Redis client
    if (config.redis.cluster) {
      this.redis = new Redis.Cluster(config.redis.cluster.nodes, {
        redisOptions: {
          password: config.redis.password,
          connectTimeout: config.connectionTimeout || 10000,
          retryDelayOnFailover: config.retryDelay || 100
        }
      });
    } else if (config.redis.sentinel) {
      this.redis = new Redis({
        sentinels: config.redis.sentinel.sentinels,
        name: config.redis.sentinel.name,
        password: config.redis.password,
        db: config.redis.db || 0
      });
    } else {
      this.redis = new Redis({
        host: config.redis.host || 'localhost',
        port: config.redis.port || 6379,
        password: config.redis.password,
        db: config.redis.db || 0,
        connectTimeout: config.connectionTimeout || 10000,
        retryDelayOnFailover: config.retryDelay || 100
      });
    }
  }

  async initialize(): Promise<void> {
    try {
      await this.redis.ping();
      console.log('✓ Redis cache adapter initialized');
    } catch (error) {
      throw new SDKError(
        'Failed to initialize Redis cache',
        ErrorCodes.DATABASE_ERROR,
        500,
        error
      );
    }
  }

  async get<T = any>(key: string, context: TenantContext): Promise<T | null> {
    try {
      const tenantKey = this.getTenantKey(key, context.tenant_id);
      const value = await this.redis.get(tenantKey);
      
      if (value === null) {
        this.stats.misses++;
        return null;
      }
      
      this.stats.hits++;
      this.updateHitRate();
      
      return this.deserialize(value);
    } catch (error) {
      throw new SDKError(
        'Failed to get cache value',
        ErrorCodes.DATABASE_ERROR,
        500,
        error
      );
    }
  }

  async set<T = any>(key: string, value: T, context: TenantContext, ttlSeconds?: number): Promise<void> {
    try {
      const tenantKey = this.getTenantKey(key, context.tenant_id);
      const serializedValue = this.serialize(value);
      const ttl = ttlSeconds || this.config.defaultTTL || 3600;
      
      await this.redis.setex(tenantKey, ttl, serializedValue);
      this.stats.totalKeys++;
    } catch (error) {
      throw new SDKError(
        'Failed to set cache value',
        ErrorCodes.DATABASE_ERROR,
        500,
        error
      );
    }
  }

  async delete(key: string, context: TenantContext): Promise<void> {
    try {
      const tenantKey = this.getTenantKey(key, context.tenant_id);
      const deleted = await this.redis.del(tenantKey);
      
      if (deleted > 0) {
        this.stats.totalKeys = Math.max(0, this.stats.totalKeys - 1);
      }
    } catch (error) {
      throw new SDKError(
        'Failed to delete cache value',
        ErrorCodes.DATABASE_ERROR,
        500,
        error
      );
    }
  }

  async exists(key: string, context: TenantContext): Promise<boolean> {
    try {
      const tenantKey = this.getTenantKey(key, context.tenant_id);
      const exists = await this.redis.exists(tenantKey);
      return exists === 1;
    } catch (error) {
      throw new SDKError(
        'Failed to check cache key existence',
        ErrorCodes.DATABASE_ERROR,
        500,
        error
      );
    }
  }

  async increment(key: string, context: TenantContext, amount: number = 1): Promise<number> {
    try {
      const tenantKey = this.getTenantKey(key, context.tenant_id);
      return await this.redis.incrby(tenantKey, amount);
    } catch (error) {
      throw new SDKError(
        'Failed to increment cache value',
        ErrorCodes.DATABASE_ERROR,
        500,
        error
      );
    }
  }

  async mset(keyValues: Record<string, any>, context: TenantContext, ttlSeconds?: number): Promise<void> {
    try {
      const pipeline = this.redis.pipeline();
      const ttl = ttlSeconds || this.config.defaultTTL || 3600;
      
      Object.entries(keyValues).forEach(([key, value]) => {
        const tenantKey = this.getTenantKey(key, context.tenant_id);
        const serializedValue = this.serialize(value);
        pipeline.setex(tenantKey, ttl, serializedValue);
      });
      
      await pipeline.exec();
      this.stats.totalKeys += Object.keys(keyValues).length;
    } catch (error) {
      throw new SDKError(
        'Failed to set multiple cache values',
        ErrorCodes.DATABASE_ERROR,
        500,
        error
      );
    }
  }

  async mget<T = any>(keys: string[], context: TenantContext): Promise<(T | null)[]> {
    try {
      const tenantKeys = keys.map(key => this.getTenantKey(key, context.tenant_id));
      const values = await this.redis.mget(...tenantKeys);
      
      return values.map(value => {
        if (value === null) {
          this.stats.misses++;
          return null;
        }
        
        this.stats.hits++;
        return this.deserialize(value);
      });
    } finally {
      this.updateHitRate();
    }
  }

  async clearTenant(tenantId: string): Promise<void> {
    try {
      const pattern = this.getTenantKey('*', tenantId);
      const keys = await this.redis.keys(pattern);
      
      if (keys.length > 0) {
        await this.redis.del(...keys);
        this.stats.totalKeys = Math.max(0, this.stats.totalKeys - keys.length);
      }
    } catch (error) {
      throw new SDKError(
        'Failed to clear tenant cache',
        ErrorCodes.DATABASE_ERROR,
        500,
        error
      );
    }
  }

  async getStats(): Promise<CacheStats> {
    try {
      const info = await this.redis.info('memory');
      const memoryMatch = info.match(/used_memory:(\d+)/);
      const memoryUsage = memoryMatch ? parseInt(memoryMatch[1]) : undefined;
      
      const uptimeMatch = info.match(/uptime_in_seconds:(\d+)/);
      const uptime = uptimeMatch ? parseInt(uptimeMatch[1]) : undefined;
      
      return {
        ...this.stats,
        memoryUsage,
        uptime,
        connections: 1 // Single connection for now
      };
    } catch (error) {
      return this.stats;
    }
  }

  async flush(): Promise<void> {
    try {
      await this.redis.flushdb();
      this.stats = {
        hits: 0,
        misses: 0,
        hitRate: 0,
        totalKeys: 0
      };
    } catch (error) {
      throw new SDKError(
        'Failed to flush cache',
        ErrorCodes.DATABASE_ERROR,
        500,
        error
      );
    }
  }

  async close(): Promise<void> {
    try {
      await this.redis.quit();
    } catch (error) {
      // Ignore close errors
      console.warn('Redis close error:', error.message);
    }
  }

  /**
   * Generate tenant-specific cache key
   */
  private getTenantKey(key: string, tenantId: string): string {
    const prefix = this.config.keyPrefix || 'mt_sdk';
    return `${prefix}:tenant:${tenantId}:${key}`;
  }

  /**
   * Serialize value for storage
   */
  private serialize(value: any): string {
    switch (this.config.serializer) {
      case 'json':
      default:
        return JSON.stringify(value);
    }
  }

  /**
   * Deserialize value from storage
   */
  private deserialize<T>(value: string): T {
    switch (this.config.serializer) {
      case 'json':
      default:
        return JSON.parse(value);
    }
  }

  /**
   * Update hit rate statistics
   */
  private updateHitRate(): void {
    const total = this.stats.hits + this.stats.misses;
    this.stats.hitRate = total > 0 ? this.stats.hits / total : 0;
  }
}
