import { SupabaseClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import { Tenant, CreateTenant, UpdateTenant, TenantStatus, TenantSchema, CreateTenantSchema, UpdateTenantSchema } from '../types/tenant';
import { EventManager } from '../events/EventManager';
import { EventType } from '../types/events';
import { TenantError, ErrorCodes } from '../utils/errors';
import { validateSchema, validateTenantSlug } from '../utils/validation';

export class TenantManager {
  constructor(
    private supabase: SupabaseClient,
    private serviceSupabase: SupabaseClient | undefined,
    private events: EventManager
  ) {}

  /**
   * Create a new tenant with proper isolation setup
   */
  async createTenant(tenantData: CreateTenant): Promise<Tenant> {
    // Validate input
    const validatedData = validateSchema(CreateTenantSchema, tenantData);
    
    if (!validateTenantSlug(validatedData.slug)) {
      throw new TenantError(
        'Invalid tenant slug format',
        ErrorCodes.TENANT_SLUG_EXISTS,
        400
      );
    }

    // Check if slug already exists
    const { data: existingTenant } = await this.supabase
      .from('tenants')
      .select('id')
      .eq('slug', validatedData.slug)
      .single();

    if (existingTenant) {
      throw new TenantError(
        'Tenant slug already exists',
        ErrorCodes.TENANT_SLUG_EXISTS,
        409
      );
    }

    const tenantId = uuidv4();
    const now = new Date().toISOString();

    const tenant: Tenant = {
      id: tenantId,
      name: validatedData.name,
      slug: validatedData.slug,
      status: TenantStatus.ACTIVE,
      plan: validatedData.plan,
      settings: validatedData.settings || {},
      metadata: validatedData.metadata || {},
      created_at: now,
      updated_at: now,
      owner_id: validatedData.owner_id
    };

    try {
      // Insert tenant record
      const { error: insertError } = await this.supabase
        .from('tenants')
        .insert(tenant);

      if (insertError) {
        throw new TenantError(
          'Failed to create tenant',
          ErrorCodes.DATABASE_ERROR,
          500,
          insertError
        );
      }

      // Set up tenant-specific RLS policies and schemas
      await this.setupTenantIsolation(tenantId);

      // Create tenant-user relationship for owner
      await this.addUserToTenant(tenantId, validatedData.owner_id, 'owner');

      // Emit event
      this.events.emit({
        id: uuidv4(),
        type: EventType.TENANT_CREATED,
        tenant_id: tenantId,
        user_id: validatedData.owner_id,
        timestamp: now,
        data: { tenant }
      });

      return tenant;

    } catch (error) {
      // Cleanup on failure
      await this.cleanupFailedTenant(tenantId);
      throw error;
    }
  }

  /**
   * Get tenant by ID or slug
   */
  async getTenant(identifier: string): Promise<Tenant | null> {
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(identifier);
    
    const { data, error } = await this.supabase
      .from('tenants')
      .select('*')
      .eq(isUUID ? 'id' : 'slug', identifier)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw new TenantError(
        'Failed to fetch tenant',
        ErrorCodes.DATABASE_ERROR,
        500,
        error
      );
    }

    return data ? validateSchema(TenantSchema, data) : null;
  }

  /**
   * Update tenant information
   */
  async updateTenant(tenantId: string, updates: UpdateTenant): Promise<Tenant> {
    const validatedUpdates = validateSchema(UpdateTenantSchema, updates);
    
    // Check if tenant exists
    const existingTenant = await this.getTenant(tenantId);
    if (!existingTenant) {
      throw new TenantError(
        'Tenant not found',
        ErrorCodes.TENANT_NOT_FOUND,
        404
      );
    }

    const updatedData = {
      ...validatedUpdates,
      updated_at: new Date().toISOString()
    };

    const { data, error } = await this.supabase
      .from('tenants')
      .update(updatedData)
      .eq('id', tenantId)
      .select()
      .single();

    if (error) {
      throw new TenantError(
        'Failed to update tenant',
        ErrorCodes.DATABASE_ERROR,
        500,
        error
      );
    }

    const updatedTenant = validateSchema(TenantSchema, data);

    // Emit event
    this.events.emit({
      id: uuidv4(),
      type: EventType.TENANT_UPDATED,
      tenant_id: tenantId,
      timestamp: new Date().toISOString(),
      data: { 
        tenant: updatedTenant,
        changes: validatedUpdates
      }
    });

    return updatedTenant;
  }

  /**
   * Suspend a tenant (soft delete)
   */
  async suspendTenant(tenantId: string, reason?: string): Promise<void> {
    await this.updateTenant(tenantId, { 
      status: TenantStatus.SUSPENDED,
      metadata: { suspension_reason: reason }
    });

    this.events.emit({
      id: uuidv4(),
      type: EventType.TENANT_SUSPENDED,
      tenant_id: tenantId,
      timestamp: new Date().toISOString(),
      data: { reason }
    });
  }

  /**
   * Activate a suspended tenant
   */
  async activateTenant(tenantId: string): Promise<void> {
    await this.updateTenant(tenantId, { 
      status: TenantStatus.ACTIVE,
      metadata: { suspension_reason: null }
    });

    this.events.emit({
      id: uuidv4(),
      type: EventType.TENANT_ACTIVATED,
      tenant_id: tenantId,
      timestamp: new Date().toISOString(),
      data: {}
    });
  }

  /**
   * List tenants with pagination
   */
  async listTenants(options: {
    limit?: number;
    offset?: number;
    status?: TenantStatus;
  } = {}): Promise<{ tenants: Tenant[]; total: number }> {
    let query = this.supabase.from('tenants').select('*', { count: 'exact' });

    if (options.status) {
      query = query.eq('status', options.status);
    }

    if (options.limit) {
      query = query.limit(options.limit);
    }

    if (options.offset) {
      query = query.range(options.offset, (options.offset + (options.limit || 10)) - 1);
    }

    const { data, error, count } = await query;

    if (error) {
      throw new TenantError(
        'Failed to list tenants',
        ErrorCodes.DATABASE_ERROR,
        500,
        error
      );
    }

    return {
      tenants: data?.map(tenant => validateSchema(TenantSchema, tenant)) || [],
      total: count || 0
    };
  }

  /**
   * Set up tenant isolation using Supabase RLS
   */
  private async setupTenantIsolation(tenantId: string): Promise<void> {
    if (!this.serviceSupabase) {
      throw new TenantError(
        'Service key required for tenant isolation setup',
        ErrorCodes.CONFIGURATION_ERROR,
        500
      );
    }

    try {
      // Create tenant-specific RLS policies
      // This would typically involve SQL commands to set up RLS policies
      // For now, we'll log the setup
      console.log(`Setting up tenant isolation for tenant: ${tenantId}`);
      
      // In a real implementation, you would execute SQL like:
      // CREATE POLICY tenant_isolation ON table_name FOR ALL TO authenticated 
      // USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
      
    } catch (error) {
      throw new TenantError(
        'Failed to setup tenant isolation',
        ErrorCodes.DATABASE_ERROR,
        500,
        error
      );
    }
  }

  /**
   * Add user to tenant with specific role
   */
  private async addUserToTenant(tenantId: string, userId: string, role: string): Promise<void> {
    const { error } = await this.supabase
      .from('tenant_users')
      .insert({
        id: uuidv4(),
        tenant_id: tenantId,
        user_id: userId,
        role: role,
        joined_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

    if (error) {
      throw new TenantError(
        'Failed to add user to tenant',
        ErrorCodes.DATABASE_ERROR,
        500,
        error
      );
    }
  }

  /**
   * Cleanup failed tenant creation
   */
  private async cleanupFailedTenant(tenantId: string): Promise<void> {
    try {
      await this.supabase.from('tenants').delete().eq('id', tenantId);
      await this.supabase.from('tenant_users').delete().eq('tenant_id', tenantId);
    } catch (error) {
      console.error('Failed to cleanup failed tenant:', error);
    }
  }
}
