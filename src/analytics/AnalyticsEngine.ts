import { IDatabaseAdapter } from '../interfaces/IDatabaseAdapter';
import { ICacheProvider } from '../interfaces/ICacheProvider';
import { IEventProvider } from '../interfaces/IEventProvider';
import { TenantContext } from '../types/data';
import { EventType } from '../types/events';
import { SDKError, ErrorCodes } from '../utils/errors';
import { v4 as uuidv4 } from 'uuid';

/**
 * Analytics metric types
 */
export enum MetricType {
  COUNTER = 'counter',
  GAUGE = 'gauge',
  HISTOGRAM = 'histogram',
  TIMER = 'timer'
}

/**
 * Analytics event interface
 */
export interface AnalyticsEvent {
  id: string;
  tenant_id: string;
  user_id?: string;
  event_type: string;
  properties: Record<string, any>;
  timestamp: Date;
  session_id?: string;
  ip_address?: string;
  user_agent?: string;
}

/**
 * Metric definition interface
 */
export interface MetricDefinition {
  name: string;
  type: MetricType;
  description?: string;
  unit?: string;
  tags?: string[];
}

/**
 * Analytics query interface
 */
export interface AnalyticsQuery {
  tenant_id: string;
  metrics: string[];
  filters?: Record<string, any>;
  groupBy?: string[];
  timeRange: {
    start: Date;
    end: Date;
  };
  granularity?: 'hour' | 'day' | 'week' | 'month';
  limit?: number;
}

/**
 * Analytics result interface
 */
export interface AnalyticsResult {
  metric: string;
  data: {
    timestamp: Date;
    value: number;
    dimensions?: Record<string, string>;
  }[];
  total?: number;
  aggregations?: Record<string, number>;
}

/**
 * Built-in analytics and reporting engine
 */
export class AnalyticsEngine {
  private metrics: Map<string, MetricDefinition> = new Map();
  private eventBuffer: AnalyticsEvent[] = [];
  private flushInterval: NodeJS.Timeout | null = null;

  constructor(
    private databaseAdapter: IDatabaseAdapter,
    private cacheProvider?: ICacheProvider,
    private eventProvider?: IEventProvider,
    private config: {
      bufferSize?: number;
      flushIntervalMs?: number;
      enableRealTime?: boolean;
    } = {}
  ) {
    this.config = {
      bufferSize: 1000,
      flushIntervalMs: 30000, // 30 seconds
      enableRealTime: true,
      ...config
    };

    this.initializeBuiltInMetrics();
    this.startFlushTimer();
  }

  /**
   * Track an analytics event
   */
  async trackEvent(
    eventType: string,
    properties: Record<string, any>,
    context: TenantContext,
    metadata?: {
      session_id?: string;
      ip_address?: string;
      user_agent?: string;
    }
  ): Promise<void> {
    const event: AnalyticsEvent = {
      id: uuidv4(),
      tenant_id: context.tenant_id,
      user_id: context.user_id,
      event_type: eventType,
      properties,
      timestamp: new Date(),
      ...metadata
    };

    // Add to buffer
    this.eventBuffer.push(event);

    // Flush if buffer is full
    if (this.eventBuffer.length >= (this.config.bufferSize || 1000)) {
      await this.flushEvents();
    }

    // Emit real-time event if enabled
    if (this.config.enableRealTime && this.eventProvider) {
      await this.eventProvider.emit({
        id: uuidv4(),
        type: EventType.DATA_CREATED,
        tenant_id: context.tenant_id,
        user_id: context.user_id,
        timestamp: new Date().toISOString(),
        data: { analytics_event: event }
      });
    }
  }

  /**
   * Increment a counter metric
   */
  async incrementCounter(
    metricName: string,
    context: TenantContext,
    value: number = 1,
    tags?: Record<string, string>
  ): Promise<void> {
    await this.trackEvent('metric_increment', {
      metric: metricName,
      value,
      tags
    }, context);

    // Update cached counter if cache is available
    if (this.cacheProvider) {
      const cacheKey = `metric:${metricName}:${JSON.stringify(tags || {})}`;
      await this.cacheProvider.increment(cacheKey, context, value);
    }
  }

  /**
   * Set a gauge metric value
   */
  async setGauge(
    metricName: string,
    value: number,
    context: TenantContext,
    tags?: Record<string, string>
  ): Promise<void> {
    await this.trackEvent('metric_gauge', {
      metric: metricName,
      value,
      tags
    }, context);

    // Update cached gauge if cache is available
    if (this.cacheProvider) {
      const cacheKey = `metric:${metricName}:${JSON.stringify(tags || {})}`;
      await this.cacheProvider.set(cacheKey, value, context, 3600); // 1 hour TTL
    }
  }

  /**
   * Record a timer metric
   */
  async recordTimer(
    metricName: string,
    durationMs: number,
    context: TenantContext,
    tags?: Record<string, string>
  ): Promise<void> {
    await this.trackEvent('metric_timer', {
      metric: metricName,
      duration_ms: durationMs,
      tags
    }, context);
  }

  /**
   * Query analytics data
   */
  async query(query: AnalyticsQuery): Promise<AnalyticsResult[]> {
    try {
      const results: AnalyticsResult[] = [];

      for (const metricName of query.metrics) {
        const result = await this.queryMetric(metricName, query);
        results.push(result);
      }

      return results;
    } catch (error) {
      throw new SDKError(
        'Failed to query analytics data',
        ErrorCodes.DATABASE_ERROR,
        500,
        error
      );
    }
  }

  /**
   * Get real-time metrics dashboard data
   */
  async getDashboardData(
    tenantId: string,
    timeRange: { start: Date; end: Date }
  ): Promise<{
    overview: {
      totalEvents: number;
      activeUsers: number;
      topEvents: { event_type: string; count: number }[];
    };
    metrics: {
      userActivity: AnalyticsResult;
      eventVolume: AnalyticsResult;
      errorRate: AnalyticsResult;
    };
  }> {
    const context: TenantContext = {
      tenant_id: tenantId,
      user_id: 'system',
      role: 'admin',
      permissions: []
    };

    // Get overview data
    const totalEventsQuery = await this.query({
      tenant_id: tenantId,
      metrics: ['event_count'],
      timeRange,
      granularity: 'day'
    });

    const activeUsersQuery = await this.query({
      tenant_id: tenantId,
      metrics: ['unique_users'],
      timeRange,
      granularity: 'day'
    });

    // Get top events
    const topEventsResult = await this.databaseAdapter.query(`
      SELECT event_type, COUNT(*) as count
      FROM analytics_events 
      WHERE tenant_id = ? AND timestamp >= ? AND timestamp <= ?
      GROUP BY event_type 
      ORDER BY count DESC 
      LIMIT 10
    `, [tenantId, timeRange.start, timeRange.end]);

    // Get metrics data
    const userActivityQuery = await this.query({
      tenant_id: tenantId,
      metrics: ['user_sessions'],
      timeRange,
      granularity: 'hour'
    });

    const eventVolumeQuery = await this.query({
      tenant_id: tenantId,
      metrics: ['event_count'],
      timeRange,
      granularity: 'hour'
    });

    const errorRateQuery = await this.query({
      tenant_id: tenantId,
      metrics: ['error_rate'],
      timeRange,
      granularity: 'hour'
    });

    return {
      overview: {
        totalEvents: totalEventsQuery[0]?.total || 0,
        activeUsers: activeUsersQuery[0]?.total || 0,
        topEvents: topEventsResult.data || []
      },
      metrics: {
        userActivity: userActivityQuery[0],
        eventVolume: eventVolumeQuery[0],
        errorRate: errorRateQuery[0]
      }
    };
  }

  /**
   * Generate analytics report
   */
  async generateReport(
    tenantId: string,
    reportType: 'daily' | 'weekly' | 'monthly',
    date: Date
  ): Promise<{
    summary: Record<string, number>;
    charts: AnalyticsResult[];
    insights: string[];
  }> {
    const timeRange = this.getTimeRangeForReport(reportType, date);
    
    const query: AnalyticsQuery = {
      tenant_id: tenantId,
      metrics: [
        'event_count',
        'unique_users',
        'user_sessions',
        'error_rate',
        'response_time'
      ],
      timeRange,
      granularity: reportType === 'daily' ? 'hour' : 'day'
    };

    const results = await this.query(query);
    
    // Calculate summary metrics
    const summary = results.reduce((acc, result) => {
      acc[result.metric] = result.total || 0;
      return acc;
    }, {} as Record<string, number>);

    // Generate insights
    const insights = this.generateInsights(results, reportType);

    return {
      summary,
      charts: results,
      insights
    };
  }

  /**
   * Register a custom metric
   */
  registerMetric(definition: MetricDefinition): void {
    this.metrics.set(definition.name, definition);
  }

  /**
   * Get registered metrics
   */
  getMetrics(): MetricDefinition[] {
    return Array.from(this.metrics.values());
  }

  /**
   * Flush buffered events to database
   */
  async flushEvents(): Promise<void> {
    if (this.eventBuffer.length === 0) return;

    try {
      const events = [...this.eventBuffer];
      this.eventBuffer = [];

      // Bulk insert events
      const context: TenantContext = {
        tenant_id: 'system',
        user_id: 'system',
        role: 'admin',
        permissions: []
      };

      await this.databaseAdapter.bulkCreate('analytics_events', events, context);
      
      console.log(`✓ Flushed ${events.length} analytics events`);
    } catch (error) {
      console.error('Failed to flush analytics events:', error);
      // Re-add events to buffer for retry
      this.eventBuffer.unshift(...this.eventBuffer);
    }
  }

  /**
   * Shutdown analytics engine
   */
  async shutdown(): Promise<void> {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }
    
    await this.flushEvents();
  }

  /**
   * Initialize built-in metrics
   */
  private initializeBuiltInMetrics(): void {
    const builtInMetrics: MetricDefinition[] = [
      {
        name: 'event_count',
        type: MetricType.COUNTER,
        description: 'Total number of events',
        unit: 'count'
      },
      {
        name: 'unique_users',
        type: MetricType.GAUGE,
        description: 'Number of unique users',
        unit: 'count'
      },
      {
        name: 'user_sessions',
        type: MetricType.COUNTER,
        description: 'Number of user sessions',
        unit: 'count'
      },
      {
        name: 'error_rate',
        type: MetricType.GAUGE,
        description: 'Error rate percentage',
        unit: 'percent'
      },
      {
        name: 'response_time',
        type: MetricType.HISTOGRAM,
        description: 'API response time',
        unit: 'milliseconds'
      }
    ];

    builtInMetrics.forEach(metric => {
      this.metrics.set(metric.name, metric);
    });
  }

  /**
   * Start flush timer
   */
  private startFlushTimer(): void {
    this.flushInterval = setInterval(
      () => this.flushEvents(),
      this.config.flushIntervalMs || 30000
    );
  }

  /**
   * Query a specific metric
   */
  private async queryMetric(metricName: string, query: AnalyticsQuery): Promise<AnalyticsResult> {
    // This is a simplified implementation
    // In a real system, you'd have more sophisticated querying logic
    
    const result = await this.databaseAdapter.query(`
      SELECT 
        DATE_TRUNC('${query.granularity || 'day'}', timestamp) as timestamp,
        COUNT(*) as value
      FROM analytics_events 
      WHERE tenant_id = ? 
        AND timestamp >= ? 
        AND timestamp <= ?
        AND properties->>'metric' = ?
      GROUP BY DATE_TRUNC('${query.granularity || 'day'}', timestamp)
      ORDER BY timestamp
    `, [query.tenant_id, query.timeRange.start, query.timeRange.end, metricName]);

    return {
      metric: metricName,
      data: result.data?.map(row => ({
        timestamp: new Date(row.timestamp),
        value: parseInt(row.value)
      })) || [],
      total: result.data?.reduce((sum, row) => sum + parseInt(row.value), 0) || 0
    };
  }

  /**
   * Get time range for report type
   */
  private getTimeRangeForReport(reportType: string, date: Date): { start: Date; end: Date } {
    const start = new Date(date);
    const end = new Date(date);

    switch (reportType) {
      case 'daily':
        start.setHours(0, 0, 0, 0);
        end.setHours(23, 59, 59, 999);
        break;
      case 'weekly':
        start.setDate(date.getDate() - date.getDay());
        start.setHours(0, 0, 0, 0);
        end.setDate(start.getDate() + 6);
        end.setHours(23, 59, 59, 999);
        break;
      case 'monthly':
        start.setDate(1);
        start.setHours(0, 0, 0, 0);
        end.setMonth(start.getMonth() + 1);
        end.setDate(0);
        end.setHours(23, 59, 59, 999);
        break;
    }

    return { start, end };
  }

  /**
   * Generate insights from analytics data
   */
  private generateInsights(results: AnalyticsResult[], reportType: string): string[] {
    const insights: string[] = [];

    // Example insights generation
    const eventCount = results.find(r => r.metric === 'event_count');
    const uniqueUsers = results.find(r => r.metric === 'unique_users');
    
    if (eventCount && eventCount.total) {
      insights.push(`Total events: ${eventCount.total.toLocaleString()}`);
    }
    
    if (uniqueUsers && uniqueUsers.total) {
      insights.push(`Active users: ${uniqueUsers.total.toLocaleString()}`);
    }

    // Add more sophisticated insights based on data patterns
    
    return insights;
  }
}
