import { MultiTenantSDK } from '../core/MultiTenantSDK';

describe('MultiTenantSDK', () => {
  let sdk: MultiTenantSDK;

  beforeEach(() => {
    sdk = new MultiTenantSDK({
      supabaseUrl: 'https://test.supabase.co',
      supabaseAnonKey: 'test-anon-key',
      supabaseServiceKey: 'test-service-key',
      enableEvents: true,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('initialization', () => {
    it('should create SDK instance with valid configuration', () => {
      expect(sdk).toBeInstanceOf(MultiTenantSDK);
      expect(sdk.tenants).toBeDefined();
      expect(sdk.auth).toBeDefined();
      expect(sdk.data).toBeDefined();
      expect(sdk.events).toBeDefined();
    });

    it('should throw error with invalid configuration', () => {
      expect(() => {
        new MultiTenantSDK({
          supabaseUrl: '',
          supabaseAnonKey: 'test-anon-key',
          supabaseServiceKey: 'test-service-key',
        });
      }).toThrow();
    });
  });

  describe('health check', () => {
    it('should return health status', async () => {
      const health = await sdk.getHealth();
      
      expect(health).toHaveProperty('status');
      expect(health).toHaveProperty('timestamp');
      expect(health).toHaveProperty('services');
      expect(health.services).toHaveProperty('database');
      expect(health.services).toHaveProperty('auth');
      expect(health.services).toHaveProperty('events');
    });
  });

  describe('metrics', () => {
    it('should return performance metrics', async () => {
      const metrics = await sdk.getMetrics();
      
      expect(metrics).toHaveProperty('performance');
      expect(metrics).toHaveProperty('usage');
      expect(metrics).toHaveProperty('errors');
      expect(metrics.performance).toHaveProperty('responseTime');
      expect(metrics.usage).toHaveProperty('activeConnections');
    });
  });
});
