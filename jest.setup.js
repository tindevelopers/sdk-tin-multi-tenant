// Jest setup file for global test configuration

// Increase timeout for integration tests
jest.setTimeout(30000);

// Mock console methods in tests to reduce noise
global.console = {
  ...console,
  // Uncomment to ignore specific console methods in tests
  // log: jest.fn(),
  // debug: jest.fn(),
  // info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

// Global test utilities
global.testUtils = {
  // Mock tenant context for tests
  createMockTenantContext: (tenantId = 'test-tenant-123', userId = 'test-user-456') => ({
    tenant_id: tenantId,
    user_id: userId,
  }),

  // Mock database config for tests
  createMockDatabaseConfig: () => ({
    type: 'postgresql',
    host: 'localhost',
    port: 5432,
    database: 'test_db',
    username: 'test_user',
    password: 'test_password',
  }),

  // Wait for async operations in tests
  wait: (ms = 100) => new Promise(resolve => setTimeout(resolve, ms)),
};

// Environment variables for testing
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';
