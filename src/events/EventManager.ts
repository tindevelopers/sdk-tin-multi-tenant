import EventEmitter from 'eventemitter3';
import { SDKEvent, EventType, EventHandler } from '../types/events';
import { SDKError, ErrorCodes } from '../utils/errors';

export interface EventManagerConfig {
  enabled?: boolean;
  webhookUrl?: string;
  workOsIntegration?: {
    enabled: boolean;
    apiKey?: string;
    webhookUrl?: string;
  };
  retryAttempts?: number;
  retryDelay?: number;
}

export class EventManager {
  private emitter: EventEmitter;
  private config: EventManagerConfig;
  private eventQueue: SDKEvent[] = [];
  private isProcessing = false;
  private webhookRetries = new Map<string, number>();

  constructor(config: EventManagerConfig = {}) {
    this.config = {
      enabled: true,
      retryAttempts: 3,
      retryDelay: 1000,
      ...config
    };
    
    this.emitter = new EventEmitter();
    
    if (this.config.enabled) {
      this.startEventProcessor();
    }
  }

  /**
   * Initialize the event system
   */
  async initialize(): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    try {
      // Test webhook connectivity if configured
      if (this.config.webhookUrl) {
        await this.testWebhookConnection(this.config.webhookUrl);
      }

      // Test Work OS integration if configured
      if (this.config.workOsIntegration?.enabled && this.config.workOsIntegration.webhookUrl) {
        await this.testWebhookConnection(this.config.workOsIntegration.webhookUrl);
      }

      console.log('Event system initialized successfully');

    } catch (error) {
      console.warn('Event system initialization warning:', error);
      // Don't throw - allow SDK to continue without events
    }
  }

  /**
   * Emit an event
   */
  emit(event: SDKEvent): void {
    if (!this.config.enabled) {
      return;
    }

    // Emit to local listeners
    this.emitter.emit(event.type, event);
    this.emitter.emit('*', event); // Wildcard listener

    // Queue for external delivery
    this.eventQueue.push(event);
    
    if (!this.isProcessing) {
      this.processEventQueue();
    }
  }

  /**
   * Subscribe to events
   */
  on<T extends SDKEvent>(eventType: EventType | '*', handler: EventHandler<T>): void {
    this.emitter.on(eventType, handler as any);
  }

  /**
   * Unsubscribe from events
   */
  off<T extends SDKEvent>(eventType: EventType | '*', handler: EventHandler<T>): void {
    this.emitter.off(eventType, handler as any);
  }

  /**
   * Subscribe to events once
   */
  once<T extends SDKEvent>(eventType: EventType, handler: EventHandler<T>): void {
    this.emitter.once(eventType, handler as any);
  }

  /**
   * Get event statistics
   */
  getStats(): {
    queueLength: number;
    isProcessing: boolean;
    totalListeners: number;
    listenersByType: Record<string, number>;
  } {
    const listenersByType: Record<string, number> = {};
    
    for (const eventName of this.emitter.eventNames()) {
      listenersByType[eventName as string] = this.emitter.listenerCount(eventName);
    }

    return {
      queueLength: this.eventQueue.length,
      isProcessing: this.isProcessing,
      totalListeners: Object.values(listenersByType).reduce((sum, count) => sum + count, 0),
      listenersByType
    };
  }

  /**
   * Check if event system is healthy
   */
  isHealthy(): boolean {
    return this.config.enabled && this.eventQueue.length < 1000; // Arbitrary threshold
  }

  /**
   * Gracefully shutdown the event system
   */
  async shutdown(): Promise<void> {
    this.config.enabled = false;
    
    // Process remaining events
    if (this.eventQueue.length > 0) {
      console.log(`Processing ${this.eventQueue.length} remaining events...`);
      await this.processEventQueue();
    }
    
    // Remove all listeners
    this.emitter.removeAllListeners();
    
    console.log('Event system shutdown complete');
  }

  /**
   * Process the event queue
   */
  private async processEventQueue(): Promise<void> {
    if (this.isProcessing || this.eventQueue.length === 0) {
      return;
    }

    this.isProcessing = true;

    try {
      while (this.eventQueue.length > 0) {
        const event = this.eventQueue.shift();
        if (event) {
          await this.deliverEvent(event);
        }
      }
    } catch (error) {
      console.error('Error processing event queue:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Deliver event to external systems
   */
  private async deliverEvent(event: SDKEvent): Promise<void> {
    const deliveryPromises: Promise<void>[] = [];

    // Deliver to webhook if configured
    if (this.config.webhookUrl) {
      deliveryPromises.push(
        this.deliverToWebhook(event, this.config.webhookUrl, 'webhook')
      );
    }

    // Deliver to Work OS if configured
    if (this.config.workOsIntegration?.enabled && this.config.workOsIntegration.webhookUrl) {
      deliveryPromises.push(
        this.deliverToWorkOS(event)
      );
    }

    // Wait for all deliveries (but don't fail if some fail)
    await Promise.allSettled(deliveryPromises);
  }

  /**
   * Deliver event to webhook
   */
  private async deliverToWebhook(
    event: SDKEvent, 
    webhookUrl: string, 
    type: string
  ): Promise<void> {
    const retryKey = `${type}-${event.id}`;
    const currentRetries = this.webhookRetries.get(retryKey) || 0;

    if (currentRetries >= (this.config.retryAttempts || 3)) {
      console.error(`Max retries exceeded for ${type} delivery:`, event.id);
      this.webhookRetries.delete(retryKey);
      return;
    }

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Event-Type': event.type,
          'X-Event-ID': event.id,
          'X-Tenant-ID': event.tenant_id
        },
        body: JSON.stringify(event)
      });

      if (!response.ok) {
        throw new Error(`Webhook delivery failed: ${response.status} ${response.statusText}`);
      }

      // Success - remove from retry tracking
      this.webhookRetries.delete(retryKey);

    } catch (error) {
      console.error(`${type} delivery failed (attempt ${currentRetries + 1}):`, error);
      
      // Increment retry count
      this.webhookRetries.set(retryKey, currentRetries + 1);
      
      // Schedule retry
      setTimeout(() => {
        this.deliverToWebhook(event, webhookUrl, type);
      }, (this.config.retryDelay || 1000) * Math.pow(2, currentRetries));
    }
  }

  /**
   * Deliver event to Work OS
   */
  private async deliverToWorkOS(event: SDKEvent): Promise<void> {
    if (!this.config.workOsIntegration?.webhookUrl) {
      return;
    }

    // Transform event for Work OS format
    const workOsEvent = {
      event_type: event.type,
      event_id: event.id,
      tenant_id: event.tenant_id,
      user_id: event.user_id,
      timestamp: event.timestamp,
      payload: event.data,
      metadata: {
        source: 'multi-tenant-sdk',
        version: '1.0.0',
        ...event.metadata
      }
    };

    await this.deliverToWebhook(
      { ...event, data: workOsEvent }, 
      this.config.workOsIntegration.webhookUrl, 
      'work-os'
    );
  }

  /**
   * Test webhook connection
   */
  private async testWebhookConnection(webhookUrl: string): Promise<void> {
    try {
      const testEvent = {
        event_type: 'system.health_check',
        timestamp: new Date().toISOString(),
        source: 'multi-tenant-sdk'
      };

      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Event-Type': 'system.health_check'
        },
        body: JSON.stringify(testEvent)
      });

      if (!response.ok) {
        throw new Error(`Webhook test failed: ${response.status}`);
      }

    } catch (error) {
      throw new SDKError(
        `Webhook connection test failed: ${error.message}`,
        ErrorCodes.NETWORK_ERROR,
        500,
        error
      );
    }
  }

  /**
   * Start the event processor
   */
  private startEventProcessor(): void {
    // Process events every second
    setInterval(() => {
      if (!this.isProcessing && this.eventQueue.length > 0) {
        this.processEventQueue();
      }
    }, 1000);
  }
}
