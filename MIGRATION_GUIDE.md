# Migration Guide: Phase 1 to Phase 2

This guide helps you migrate from the Supabase-native Phase 1 implementation to the database-agnostic Phase 2 implementation.

## 🎯 Migration Overview

**Phase 1**: Supabase-native SDK with direct client integration  
**Phase 2**: Database-agnostic SDK with adapter pattern

**Key Benefits of Migration**:
- Database flexibility (PostgreSQL, MySQL, SQLite)
- Enhanced performance with connection pooling
- Advanced migration tools
- Better monitoring and metrics
- No vendor lock-in

## 📋 Pre-Migration Checklist

### 1. Backup Your Data
```bash
# Supabase backup
supabase db dump --file backup.sql

# Or use your preferred backup method
pg_dump -h your-supabase-host -U postgres your-db > backup.sql
```

### 2. Review Current Usage
```typescript
// Audit your current Phase 1 usage
import { MultiTenantSDK } from '@tin/multi-tenant-sdk';

const sdk = new MultiTenantSDK({
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY
});

// Document all your current operations
```

### 3. Install Phase 2 Dependencies
```bash
npm install pg mysql2 @types/pg
# or
yarn add pg mysql2 @types/pg
```

## 🔄 Migration Strategies

### Strategy 1: In-Place Migration (Recommended for Development)

#### Step 1: Update Configuration
```typescript
// Before (Phase 1)
const phase1Config = {
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
  supabaseServiceKey: process.env.SUPABASE_SERVICE_KEY
};

// After (Phase 2 - Supabase Adapter)
const phase2Config = {
  database: {
    type: 'supabase' as const,
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
    supabaseServiceKey: process.env.SUPABASE_SERVICE_KEY
  },
  features: {
    enableEvents: true,
    enableMigrations: true,
    enableAuditLogs: true
  }
};
```

#### Step 2: Update SDK Initialization
```typescript
// Before (Phase 1)
import { MultiTenantSDK } from '@tin/multi-tenant-sdk';
const sdk = new MultiTenantSDK(phase1Config);

// After (Phase 2)
import { MultiTenantSDKV2 } from '@tin/multi-tenant-sdk';
const sdk = new MultiTenantSDKV2(phase2Config);
```

#### Step 3: Update API Calls (Minimal Changes)
```typescript
// Most APIs remain the same!

// Tenant operations (unchanged)
const tenant = await sdk.tenants.createTenant({
  name: 'My Company',
  slug: 'my-company',
  owner_id: userId
});

// Data operations (enhanced)
const result = await sdk.data.create('projects', {
  name: 'New Project',
  description: 'Project description'
}, context);
```

### Strategy 2: Side-by-Side Migration (Recommended for Production)

#### Step 1: Set Up Parallel Systems
```typescript
// Keep Phase 1 running
const legacySDK = new MultiTenantSDK(phase1Config);

// Initialize Phase 2
const newSDK = new MultiTenantSDKV2({
  database: {
    type: 'postgresql', // Switch to PostgreSQL
    host: process.env.PG_HOST,
    database: process.env.PG_DATABASE,
    username: process.env.PG_USERNAME,
    password: process.env.PG_PASSWORD,
    port: 5432,
    ssl: true
  }
});
```

#### Step 2: Migrate Data
```typescript
async function migrateData() {
  // 1. Export from Supabase
  const tenants = await legacySDK.tenants.listTenants();
  
  // 2. Import to PostgreSQL
  for (const tenant of tenants.tenants) {
    await newSDK.tenants.createTenant({
      name: tenant.name,
      slug: tenant.slug,
      owner_id: tenant.owner_id,
      plan: tenant.plan
    });
  }
}
```

#### Step 3: Gradual Cutover
```typescript
// Feature flag approach
const useNewSDK = process.env.USE_NEW_SDK === 'true';
const sdk = useNewSDK ? newSDK : legacySDK;

// Or tenant-by-tenant migration
const getTenantSDK = (tenantId: string) => {
  const migratedTenants = ['tenant-1', 'tenant-2'];
  return migratedTenants.includes(tenantId) ? newSDK : legacySDK;
};
```

### Strategy 3: Database Switch (Same Infrastructure)

#### PostgreSQL Migration
```typescript
// 1. Set up PostgreSQL with same schema
const postgresConfig = {
  database: {
    type: 'postgresql' as const,
    host: 'localhost',
    database: 'multitenant_db',
    username: 'postgres',
    password: 'password',
    port: 5432
  }
};

// 2. Run schema migrations
const sdk = new MultiTenantSDKV2(postgresConfig);
await sdk.initialize();

// 3. Migrate data using pg_dump/restore
```

#### MySQL Migration
```typescript
const mysqlConfig = {
  database: {
    type: 'mysql' as const,
    host: 'localhost',
    database: 'multitenant_db',
    username: 'root',
    password: 'password',
    port: 3306
  }
};
```

## 🔧 API Changes and Compatibility

### Unchanged APIs (100% Compatible)
```typescript
// Tenant Management
await sdk.tenants.createTenant(data);
await sdk.tenants.getTenant(id);
await sdk.tenants.updateTenant(id, updates);
await sdk.tenants.listTenants(options);

// Authentication  
await sdk.auth.login(credentials);
await sdk.auth.logout();
await sdk.auth.getCurrentUser();

// Basic Data Operations
await sdk.data.create(table, data, context);
await sdk.data.read(table, options, context);
await sdk.data.update(table, id, updates, context);
await sdk.data.delete(table, id, context);
```

### Enhanced APIs (New Features)
```typescript
// Enhanced Health Monitoring
const health = await sdk.getHealth();
// Returns: { status, services: { database, auth, events }, version, uptime }

// Performance Metrics
const metrics = await sdk.getMetrics();
// Returns: { database, events, tenants, users }

// Migration Management
const migrationResults = await sdk.migrations?.runMigrations(migrations);
const status = await sdk.migrations?.getMigrationStatus();

// Transaction Support (PostgreSQL/MySQL)
const transaction = await sdk.data.beginTransaction();
try {
  await transaction.query('INSERT INTO ...');
  await transaction.commit();
} catch (error) {
  await transaction.rollback();
}
```

### Configuration Changes
```typescript
// Phase 1 Configuration
interface SDKConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseServiceKey?: string;
  enableEvents?: boolean;
  workOsIntegration?: {...};
}

// Phase 2 Configuration (Enhanced)
interface SDKConfigV2 {
  database: DatabaseConfig;        // Multi-database support
  auth?: AuthProviderConfig;       // Pluggable auth
  events?: EventProviderConfig;    // Enhanced events
  migrations?: MigrationConfig;    // Migration tools
  features?: FeatureFlags;         // Feature toggles
  performance?: PerformanceConfig; // Performance tuning
  security?: SecurityConfig;       // Security settings
}
```

## 🛠️ Database-Specific Migration

### Supabase to PostgreSQL

#### 1. Schema Migration
```sql
-- Export Supabase schema
pg_dump -h your-supabase-host -s -U postgres your-db > schema.sql

-- Import to PostgreSQL
psql -h localhost -U postgres -d multitenant_db < schema.sql
```

#### 2. Data Migration
```sql
-- Export data
pg_dump -h your-supabase-host -a -U postgres your-db > data.sql

-- Import data
psql -h localhost -U postgres -d multitenant_db < data.sql
```

#### 3. RLS Policy Migration
```typescript
// Supabase RLS policies are automatically recreated
await sdk.tenants.createTenant(tenantData); // Sets up RLS automatically
```

### Supabase to MySQL

#### 1. Schema Conversion
```sql
-- Convert PostgreSQL schema to MySQL
-- Note: Some data types need conversion (UUID -> CHAR(36), etc.)

CREATE TABLE tenants (
  id CHAR(36) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  slug VARCHAR(50) UNIQUE NOT NULL,
  status ENUM('active', 'suspended', 'pending', 'cancelled') DEFAULT 'active',
  -- ... other fields
);
```

#### 2. Data Migration
```typescript
// Use SDK for cross-database migration
async function migrateToMySQL() {
  const supabaseSDK = new MultiTenantSDKV2(supabaseConfig);
  const mysqlSDK = new MultiTenantSDKV2(mysqlConfig);
  
  // Migrate tenants
  const { tenants } = await supabaseSDK.tenants.listTenants({ limit: 1000 });
  for (const tenant of tenants) {
    await mysqlSDK.tenants.createTenant(tenant);
  }
}
```

## 🔍 Testing Your Migration

### 1. Unit Tests
```typescript
describe('Migration Tests', () => {
  it('should maintain API compatibility', async () => {
    const phase1SDK = new MultiTenantSDK(phase1Config);
    const phase2SDK = new MultiTenantSDKV2(phase2Config);
    
    // Test same operations produce same results
    const tenant1 = await phase1SDK.tenants.createTenant(testData);
    const tenant2 = await phase2SDK.tenants.createTenant(testData);
    
    expect(tenant1).toMatchObject(tenant2);
  });
});
```

### 2. Integration Tests
```typescript
describe('Database Integration', () => {
  it('should work with PostgreSQL adapter', async () => {
    const sdk = new MultiTenantSDKV2(postgresConfig);
    await sdk.initialize();
    
    const health = await sdk.getHealth();
    expect(health.services.database.connected).toBe(true);
  });
});
```

### 3. Performance Tests
```typescript
describe('Performance Tests', () => {
  it('should handle concurrent operations', async () => {
    const operations = Array(100).fill(null).map(() => 
      sdk.data.create('test_table', testData, context)
    );
    
    const results = await Promise.all(operations);
    expect(results.every(r => r.data)).toBe(true);
  });
});
```

## 🚨 Common Migration Issues

### Issue 1: UUID vs String IDs
```typescript
// Problem: Different databases handle UUIDs differently
// Solution: Use string representation consistently

// Phase 2 handles this automatically
const tenant = await sdk.tenants.createTenant(data);
// tenant.id is always a string, regardless of database
```

### Issue 2: Transaction Support
```typescript
// Problem: Supabase has limited transaction support
// Solution: Use adapter-specific transaction handling

if (sdk.data.beginTransaction) {
  // PostgreSQL/MySQL - full transaction support
  const tx = await sdk.data.beginTransaction();
  // ... use transaction
} else {
  // Supabase - use batch operations
  await sdk.data.bulkCreate(table, records, context);
}
```

### Issue 3: RLS vs Application-Level Filtering
```typescript
// Problem: MySQL doesn't support RLS
// Solution: SDK handles this transparently

// Same code works across all databases
const data = await sdk.data.read('projects', {}, context);
// Automatically filtered by tenant_id regardless of database
```

## 📊 Migration Validation

### Data Integrity Checks
```typescript
async function validateMigration() {
  // 1. Count records
  const oldCount = await legacySDK.data.read('tenants', {}, adminContext);
  const newCount = await newSDK.data.read('tenants', {}, adminContext);
  
  console.log(`Migrated ${newCount.data?.length} of ${oldCount.data?.length} tenants`);
  
  // 2. Spot check data
  const sampleTenant = oldCount.data?.[0];
  if (sampleTenant) {
    const migratedTenant = await newSDK.tenants.getTenant(sampleTenant.id);
    console.log('Sample tenant migrated correctly:', !!migratedTenant);
  }
  
  // 3. Test operations
  const testResult = await newSDK.data.create('test_table', testData, context);
  console.log('Operations working:', !!testResult.data);
}
```

## 🎯 Post-Migration Steps

### 1. Update Environment Variables
```bash
# Add new database configuration
DATABASE_TYPE=postgresql
PG_HOST=localhost
PG_DATABASE=multitenant_db
PG_USERNAME=postgres
PG_PASSWORD=password

# Keep Supabase config for gradual migration
SUPABASE_URL=...
SUPABASE_ANON_KEY=...
```

### 2. Monitor Performance
```typescript
// Set up monitoring
setInterval(async () => {
  const health = await sdk.getHealth();
  const metrics = await sdk.getMetrics();
  
  console.log('Health:', health.status);
  console.log('DB Latency:', health.services.database.latency);
  console.log('Active Tenants:', metrics.tenants.active);
}, 60000);
```

### 3. Clean Up Old Resources
```typescript
// After successful migration, clean up
await legacySDK.shutdown();

// Remove old environment variables
// Update deployment configurations
// Archive old database (don't delete immediately!)
```

## 🎉 Migration Success Checklist

- [ ] All data migrated successfully
- [ ] API compatibility verified
- [ ] Performance meets requirements
- [ ] Health monitoring operational
- [ ] Backup and rollback plan tested
- [ ] Team trained on new features
- [ ] Documentation updated
- [ ] Old system gracefully deprecated

## 🆘 Rollback Plan

If migration issues occur:

```typescript
// 1. Immediate rollback to Phase 1
const emergencySDK = new MultiTenantSDK(phase1Config);

// 2. Restore from backup if needed
// pg_restore backup.sql

// 3. Update configuration
process.env.USE_LEGACY_SDK = 'true';

// 4. Monitor and investigate
console.log('Rolled back to Phase 1 - investigating issues');
```

## 📞 Support and Resources

- **Documentation**: See `PHASE2_SUMMARY.md` for detailed architecture
- **Examples**: Check `/examples` directory for sample implementations
- **Issues**: Report migration issues on GitHub
- **Community**: Join our Discord for migration support

Migration to Phase 2 unlocks powerful new capabilities while maintaining the simplicity and reliability of the original SDK. Take your time, test thoroughly, and enjoy the enhanced flexibility!
