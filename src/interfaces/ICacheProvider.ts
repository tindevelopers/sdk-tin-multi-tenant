import { TenantContext } from '../types/data';

/**
 * Abstract cache provider interface for tenant-aware caching
 */
export interface ICacheProvider {
  /**
   * Initialize the cache provider
   */
  initialize(): Promise<void>;

  /**
   * Get cached value with tenant isolation
   */
  get<T = any>(key: string, context: TenantContext): Promise<T | null>;

  /**
   * Set cached value with tenant isolation and TTL
   */
  set<T = any>(key: string, value: T, context: TenantContext, ttlSeconds?: number): Promise<void>;

  /**
   * Delete cached value
   */
  delete(key: string, context: TenantContext): Promise<void>;

  /**
   * Check if key exists in cache
   */
  exists(key: string, context: TenantContext): Promise<boolean>;

  /**
   * Increment numeric value atomically
   */
  increment(key: string, context: TenantContext, amount?: number): Promise<number>;

  /**
   * Set multiple values at once
   */
  mset(keyValues: Record<string, any>, context: TenantContext, ttlSeconds?: number): Promise<void>;

  /**
   * Get multiple values at once
   */
  mget<T = any>(keys: string[], context: TenantContext): Promise<(T | null)[]>;

  /**
   * Clear all cache entries for a tenant
   */
  clearTenant(tenantId: string): Promise<void>;

  /**
   * Get cache statistics
   */
  getStats(): Promise<CacheStats>;

  /**
   * Flush all cache entries (admin operation)
   */
  flush(): Promise<void>;

  /**
   * Close cache connections
   */
  close(): Promise<void>;
}

/**
 * Cache statistics interface
 */
export interface CacheStats {
  hits: number;
  misses: number;
  hitRate: number;
  totalKeys: number;
  memoryUsage?: number;
  connections?: number;
  uptime?: number;
}

/**
 * Cache configuration interface
 */
export interface CacheConfig {
  type: 'memory' | 'redis' | 'memcached';
  
  // Redis configuration
  redis?: {
    host?: string;
    port?: number;
    password?: string;
    db?: number;
    cluster?: {
      nodes: { host: string; port: number }[];
    };
    sentinel?: {
      sentinels: { host: string; port: number }[];
      name: string;
    };
  };
  
  // Memcached configuration
  memcached?: {
    servers: string[];
  };
  
  // Common settings
  defaultTTL?: number;
  keyPrefix?: string;
  maxMemory?: number;
  
  // Serialization
  serializer?: 'json' | 'msgpack' | 'custom';
  
  // Connection settings
  connectionTimeout?: number;
  retryAttempts?: number;
  retryDelay?: number;
}
