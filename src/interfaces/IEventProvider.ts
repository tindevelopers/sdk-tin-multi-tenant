import { SDKEvent, EventType, EventHandler } from '../types/events';

/**
 * Abstract event provider interface
 * Supports different event delivery mechanisms
 */
export interface IEventProvider {
  /**
   * Initialize the event provider
   */
  initialize(): Promise<void>;

  /**
   * Emit an event
   */
  emit(event: SDKEvent): Promise<void>;

  /**
   * Subscribe to events locally
   */
  on<T extends SDKEvent>(eventType: EventType | '*', handler: EventHandler<T>): void;

  /**
   * Unsubscribe from events
   */
  off<T extends SDKEvent>(eventType: EventType | '*', handler: EventHandler<T>): void;

  /**
   * Subscribe to events once
   */
  once<T extends SDKEvent>(eventType: EventType, handler: EventHandler<T>): void;

  /**
   * Deliver event to external systems
   */
  deliver(event: SDKEvent, destinations: EventDestination[]): Promise<DeliveryResult[]>;

  /**
   * Get event statistics
   */
  getStats(): EventStats;

  /**
   * Check provider health
   */
  isHealthy(): boolean;

  /**
   * Shutdown the event provider
   */
  shutdown(): Promise<void>;
}

/**
 * Event destination interface
 */
export interface EventDestination {
  type: 'webhook' | 'work_os' | 'queue' | 'stream';
  url?: string;
  headers?: Record<string, string>;
  authentication?: {
    type: 'bearer' | 'api_key' | 'basic';
    token?: string;
    username?: string;
    password?: string;
  };
  retryConfig?: {
    maxRetries: number;
    retryDelay: number;
    backoffMultiplier: number;
  };
  filterEvents?: EventType[];
  transformPayload?: boolean;
}

/**
 * Event delivery result
 */
export interface DeliveryResult {
  destination: EventDestination;
  success: boolean;
  statusCode?: number;
  error?: string;
  retryCount: number;
  deliveredAt: Date;
}

/**
 * Event statistics
 */
export interface EventStats {
  queueLength: number;
  isProcessing: boolean;
  totalListeners: number;
  listenersByType: Record<string, number>;
  deliveryStats: {
    totalDelivered: number;
    totalFailed: number;
    averageLatency: number;
    successRate: number;
  };
}

/**
 * Event provider configuration
 */
export interface EventProviderConfig {
  type: 'memory' | 'redis' | 'rabbitmq' | 'kafka';
  enabled?: boolean;
  
  // Memory provider (default)
  queueSize?: number;
  processingInterval?: number;
  
  // Redis
  redisUrl?: string;
  redisOptions?: {
    host?: string;
    port?: number;
    password?: string;
    db?: number;
  };
  
  // RabbitMQ
  rabbitmqUrl?: string;
  exchangeName?: string;
  
  // Kafka
  kafkaConfig?: {
    brokers: string[];
    clientId?: string;
    groupId?: string;
  };
  
  // Delivery settings
  defaultRetryConfig?: {
    maxRetries: number;
    retryDelay: number;
    backoffMultiplier: number;
  };
  
  // Destinations
  destinations?: EventDestination[];
  
  // Work OS integration
  workOsIntegration?: {
    enabled: boolean;
    apiKey?: string;
    webhookUrl?: string;
    transformEvents?: boolean;
  };
}
