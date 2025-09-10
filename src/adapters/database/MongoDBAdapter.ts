import { MongoClient, Db, Collection, ClientSession } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import { IDatabaseAdapter, ITransaction, Migration, DatabaseConfig } from '../../interfaces/IDatabaseAdapter';
import { QueryOptions, TenantContext, DataResult } from '../../types/data';
import { DataError, ErrorCodes } from '../../utils/errors';

/**
 * MongoDB database adapter implementation
 */
export class MongoDBAdapter implements IDatabaseAdapter {
  private client: MongoClient;
  private db: Db;
  private config: DatabaseConfig;

  constructor(config: DatabaseConfig) {
    this.config = config;
    
    if (!config.mongoUrl && (!config.host || !config.database)) {
      throw new DataError(
        'MongoDB URL or host/database is required',
        ErrorCodes.CONFIGURATION_ERROR,
        400
      );
    }

    const connectionString = config.mongoUrl || 
      `mongodb://${config.username ? `${config.username}:${config.password}@` : ''}${config.host}:${config.port || 27017}/${config.database}`;

    this.client = new MongoClient(connectionString, {
      maxPoolSize: config.connectionLimit || 10,
      serverSelectionTimeoutMS: config.connectionTimeout || 30000,
      socketTimeoutMS: config.queryTimeout || 30000,
      ssl: config.ssl
    });
  }

  async initialize(): Promise<void> {
    try {
      await this.client.connect();
      this.db = this.client.db(this.config.database);
      
      // Test connection
      await this.db.admin().ping();
      
      // Create indexes for tenant isolation
      await this.setupTenantIndexes();
      
      console.log('✓ MongoDB adapter initialized');
    } catch (error) {
      throw new DataError(
        'Failed to initialize MongoDB adapter',
        ErrorCodes.DATABASE_ERROR,
        500,
        error
      );
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.db.admin().ping();
      return true;
    } catch (error) {
      return false;
    }
  }

  async query<T = any>(aggregation: any[], collection?: string): Promise<DataResult<T[]>> {
    try {
      if (!collection) {
        throw new DataError(
          'Collection name is required for MongoDB queries',
          ErrorCodes.INVALID_QUERY,
          400
        );
      }

      const coll = this.db.collection(collection);
      const cursor = coll.aggregate(aggregation);
      const data = await cursor.toArray();
      
      return { data: data as T[] };
    } catch (error) {
      return { data: null, error: error.message };
    }
  }

  async create<T = any>(table: string, data: Partial<T>, context: TenantContext): Promise<DataResult<T>> {
    try {
      const collection = this.db.collection(table);
      
      const document = {
        _id: uuidv4(),
        ...data,
        tenant_id: context.tenant_id,
        created_at: new Date(),
        updated_at: new Date()
      };

      const result = await collection.insertOne(document);
      
      if (!result.acknowledged) {
        throw new DataError(
          'Failed to create document',
          ErrorCodes.DATABASE_ERROR,
          500
        );
      }

      // Convert MongoDB _id to id for consistency
      const createdDoc = { ...document, id: document._id };
      delete createdDoc._id;

      return { data: createdDoc as T };
    } catch (error) {
      if (error instanceof DataError) {
        throw error;
      }
      return { data: null, error: error.message };
    }
  }

  async read<T = any>(table: string, options: QueryOptions, context: TenantContext): Promise<DataResult<T[]>> {
    try {
      const collection = this.db.collection(table);
      
      // Build MongoDB query
      const query: any = { tenant_id: context.tenant_id };
      
      // Apply filters
      if (options.filter) {
        Object.entries(options.filter).forEach(([key, value]) => {
          query[key] = value;
        });
      }

      // Build aggregation pipeline
      const pipeline: any[] = [{ $match: query }];

      // Apply sorting
      if (options.order) {
        const sort: any = {};
        sort[options.order.column] = options.order.ascending ? 1 : -1;
        pipeline.push({ $sort: sort });
      }

      // Apply pagination
      if (options.offset) {
        pipeline.push({ $skip: options.offset });
      }

      if (options.limit) {
        pipeline.push({ $limit: options.limit });
      }

      // Apply field selection
      if (options.select && options.select !== '*') {
        const projection: any = {};
        options.select.split(',').forEach(field => {
          projection[field.trim()] = 1;
        });
        pipeline.push({ $project: projection });
      }

      // Execute query
      const cursor = collection.aggregate(pipeline);
      const documents = await cursor.toArray();

      // Convert MongoDB _id to id for consistency
      const data = documents.map(doc => {
        const converted = { ...doc, id: doc._id };
        delete converted._id;
        return converted;
      });

      // Get count if needed
      let count: number | undefined;
      if (options.limit || options.offset) {
        const countResult = await collection.countDocuments(query);
        count = countResult;
      }

      return { data: data as T[], count };
    } catch (error) {
      return { data: null, error: error.message };
    }
  }

  async update<T = any>(table: string, id: string, updates: Partial<T>, context: TenantContext): Promise<DataResult<T>> {
    try {
      const collection = this.db.collection(table);
      
      const updateDoc = {
        $set: {
          ...updates,
          updated_at: new Date()
        }
      };

      const result = await collection.findOneAndUpdate(
        { _id: id, tenant_id: context.tenant_id },
        updateDoc,
        { returnDocument: 'after' }
      );

      if (!result.value) {
        throw new DataError(
          'Document not found or update failed',
          ErrorCodes.RESOURCE_NOT_FOUND,
          404
        );
      }

      // Convert MongoDB _id to id for consistency
      const updatedDoc = { ...result.value, id: result.value._id };
      delete updatedDoc._id;

      return { data: updatedDoc as T };
    } catch (error) {
      if (error instanceof DataError) {
        throw error;
      }
      return { data: null, error: error.message };
    }
  }

  async delete(table: string, id: string, context: TenantContext): Promise<DataResult<void>> {
    try {
      const collection = this.db.collection(table);
      
      const result = await collection.deleteOne({
        _id: id,
        tenant_id: context.tenant_id
      });

      if (result.deletedCount === 0) {
        throw new DataError(
          'Document not found',
          ErrorCodes.RESOURCE_NOT_FOUND,
          404
        );
      }

      return { data: undefined };
    } catch (error) {
      if (error instanceof DataError) {
        throw error;
      }
      return { data: null, error: error.message };
    }
  }

  async bulkCreate<T = any>(table: string, records: Partial<T>[], context: TenantContext): Promise<DataResult<T[]>> {
    try {
      if (records.length === 0) {
        return { data: [] };
      }

      const collection = this.db.collection(table);
      
      const documents = records.map(record => ({
        _id: uuidv4(),
        ...record,
        tenant_id: context.tenant_id,
        created_at: new Date(),
        updated_at: new Date()
      }));

      const result = await collection.insertMany(documents);
      
      if (!result.acknowledged) {
        throw new DataError(
          'Bulk create failed',
          ErrorCodes.DATABASE_ERROR,
          500
        );
      }

      // Convert MongoDB _id to id for consistency
      const createdDocs = documents.map(doc => {
        const converted = { ...doc, id: doc._id };
        delete converted._id;
        return converted;
      });

      return { data: createdDocs as T[] };
    } catch (error) {
      return { data: null, error: error.message };
    }
  }

  async beginTransaction(): Promise<ITransaction> {
    const session = this.client.startSession();
    session.startTransaction();
    return new MongoDBTransaction(session, this.db);
  }

  async setupTenantIsolation(tenantId: string): Promise<void> {
    try {
      // MongoDB uses application-level tenant isolation
      // Create indexes for efficient tenant-based queries
      const collections = ['tenants', 'users', 'tenant_users']; // Add your collections here
      
      for (const collectionName of collections) {
        const collection = this.db.collection(collectionName);
        
        // Create compound index with tenant_id as first field
        await collection.createIndex(
          { tenant_id: 1, _id: 1 },
          { background: true }
        );
        
        // Create index for tenant_id queries
        await collection.createIndex(
          { tenant_id: 1 },
          { background: true }
        );
      }
      
      console.log(`✓ Tenant isolation setup completed for tenant: ${tenantId}`);
    } catch (error) {
      throw new DataError(
        'Failed to setup tenant isolation',
        ErrorCodes.DATABASE_ERROR,
        500,
        error
      );
    }
  }

  async setTenantContext(tenantId: string): Promise<void> {
    // MongoDB doesn't have session variables like SQL databases
    // Tenant context is handled at the application level
    console.log(`Tenant context set for: ${tenantId}`);
  }

  async runMigrations(migrations: Migration[]): Promise<void> {
    const session = this.client.startSession();
    
    try {
      await session.withTransaction(async () => {
        const migrationsCollection = this.db.collection('migrations');
        
        for (const migration of migrations) {
          // Check if migration already executed
          const existingMigration = await migrationsCollection.findOne(
            { _id: migration.id },
            { session }
          );

          if (!existingMigration) {
            // Execute migration (MongoDB migrations are typically JavaScript functions)
            try {
              // In a real implementation, you'd execute the migration logic here
              console.log(`Executing migration: ${migration.name}`);
              
              // Record migration
              await migrationsCollection.insertOne({
                _id: migration.id,
                name: migration.name,
                version: migration.version,
                tenant_id: migration.tenant_id,
                executed_at: new Date(),
                rollback_info: migration.down
              }, { session });
              
            } catch (migrationError) {
              throw new DataError(
                `Migration ${migration.id} failed: ${migrationError.message}`,
                ErrorCodes.DATABASE_ERROR,
                500,
                migrationError
              );
            }
          }
        }
      });
    } finally {
      await session.endSession();
    }
  }

  async getHealth(): Promise<{ connected: boolean; latency?: number; error?: string }> {
    try {
      const startTime = Date.now();
      await this.db.admin().ping();
      const latency = Date.now() - startTime;

      return {
        connected: true,
        latency
      };
    } catch (error) {
      return {
        connected: false,
        error: error.message
      };
    }
  }

  async close(): Promise<void> {
    await this.client.close();
  }

  /**
   * Set up tenant-specific indexes
   */
  private async setupTenantIndexes(): Promise<void> {
    try {
      // Create migrations collection if it doesn't exist
      const migrationsCollection = this.db.collection('migrations');
      await migrationsCollection.createIndex({ _id: 1 }, { unique: true });
      await migrationsCollection.createIndex({ tenant_id: 1 });
      
    } catch (error) {
      console.warn('Could not create tenant indexes:', error.message);
    }
  }
}

/**
 * MongoDB transaction implementation
 */
class MongoDBTransaction implements ITransaction {
  constructor(
    private session: ClientSession,
    private db: Db
  ) {}

  async query<T = any>(aggregation: any[], collection: string): Promise<DataResult<T[]>> {
    try {
      const coll = this.db.collection(collection);
      const cursor = coll.aggregate(aggregation, { session: this.session });
      const data = await cursor.toArray();
      
      return { data: data as T[] };
    } catch (error) {
      return { data: null, error: error.message };
    }
  }

  async commit(): Promise<void> {
    try {
      await this.session.commitTransaction();
    } finally {
      await this.session.endSession();
    }
  }

  async rollback(): Promise<void> {
    try {
      await this.session.abortTransaction();
    } finally {
      await this.session.endSession();
    }
  }
}
