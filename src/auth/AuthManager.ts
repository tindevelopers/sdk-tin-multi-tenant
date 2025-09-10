import { SupabaseClient, User as SupabaseUser } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import { User, TenantUser, AuthContext, LoginRequest, InviteUser, UserRole, UserStatus } from '../types/auth';
import { EventManager } from '../events/EventManager';
import { EventType } from '../types/events';
import { AuthError, ErrorCodes } from '../utils/errors';
import { validateSchema, validateEmail } from '../utils/validation';

export class AuthManager {
  constructor(
    private supabase: SupabaseClient,
    private events: EventManager
  ) {}

  /**
   * Authenticate user with tenant context
   */
  async login(credentials: LoginRequest): Promise<AuthContext> {
    const validatedCredentials = validateSchema(
      LoginRequest.schema || LoginRequest, 
      credentials
    );

    try {
      // Authenticate with Supabase
      const { data: authData, error: authError } = await this.supabase.auth.signInWithPassword({
        email: validatedCredentials.email,
        password: validatedCredentials.password
      });

      if (authError || !authData.user) {
        throw new AuthError(
          'Invalid credentials',
          ErrorCodes.INVALID_CREDENTIALS,
          401
        );
      }

      // Get user profile
      const user = await this.getUserProfile(authData.user.id);
      if (!user) {
        throw new AuthError(
          'User profile not found',
          ErrorCodes.USER_NOT_FOUND,
          404
        );
      }

      // Get tenant context
      let tenantContext;
      if (validatedCredentials.tenant_slug) {
        tenantContext = await this.getTenantContext(user.id, validatedCredentials.tenant_slug);
      } else {
        // Get default tenant for user
        tenantContext = await this.getDefaultTenantContext(user.id);
      }

      if (!tenantContext) {
        throw new AuthError(
          'No tenant access found',
          ErrorCodes.INSUFFICIENT_PERMISSIONS,
          403
        );
      }

      // Set tenant context in Supabase session
      await this.setTenantContext(tenantContext.id);

      const authContext: AuthContext = {
        user,
        tenant: {
          id: tenantContext.id,
          slug: tenantContext.slug,
          role: tenantContext.role,
          permissions: tenantContext.permissions || []
        },
        session: {
          access_token: authData.session.access_token,
          refresh_token: authData.session.refresh_token,
          expires_at: authData.session.expires_at || 0
        }
      };

      // Emit login event
      this.events.emit({
        id: uuidv4(),
        type: EventType.USER_LOGGED_IN,
        tenant_id: tenantContext.id,
        user_id: user.id,
        timestamp: new Date().toISOString(),
        data: { tenant_slug: tenantContext.slug }
      });

      return authContext;

    } catch (error) {
      if (error instanceof AuthError) {
        throw error;
      }
      throw new AuthError(
        'Authentication failed',
        ErrorCodes.INVALID_CREDENTIALS,
        401,
        error
      );
    }
  }

  /**
   * Logout user and invalidate session
   */
  async logout(): Promise<void> {
    const { error } = await this.supabase.auth.signOut();
    
    if (error) {
      throw new AuthError(
        'Logout failed',
        ErrorCodes.SESSION_EXPIRED,
        500,
        error
      );
    }

    // Emit logout event
    this.events.emit({
      id: uuidv4(),
      type: EventType.USER_LOGGED_OUT,
      tenant_id: '', // Will be set by context
      timestamp: new Date().toISOString(),
      data: {}
    });
  }

  /**
   * Get current authenticated user
   */
  async getCurrentUser(): Promise<User | null> {
    const { data: { user } } = await this.supabase.auth.getUser();
    
    if (!user) {
      return null;
    }

    return await this.getUserProfile(user.id);
  }

  /**
   * Invite user to tenant
   */
  async inviteUser(inviteData: InviteUser): Promise<void> {
    const validatedData = validateSchema(InviteUser.schema || InviteUser, inviteData);

    if (!validateEmail(validatedData.email)) {
      throw new AuthError(
        'Invalid email format',
        ErrorCodes.INVALID_CREDENTIALS,
        400
      );
    }

    try {
      // Check if user already exists
      const { data: existingUser } = await this.supabase
        .from('users')
        .select('id')
        .eq('email', validatedData.email)
        .single();

      if (existingUser) {
        // Add existing user to tenant
        await this.addUserToTenant(
          validatedData.tenant_id,
          existingUser.id,
          validatedData.role,
          validatedData.permissions
        );
      } else {
        // Send invitation email (would integrate with email service)
        await this.sendInvitationEmail(validatedData);
      }

      // Emit invitation event
      this.events.emit({
        id: uuidv4(),
        type: EventType.USER_INVITED,
        tenant_id: validatedData.tenant_id,
        timestamp: new Date().toISOString(),
        data: {
          email: validatedData.email,
          role: validatedData.role,
          invited_by: '' // Would get from current user context
        }
      });

    } catch (error) {
      throw new AuthError(
        'Failed to invite user',
        ErrorCodes.DATABASE_ERROR,
        500,
        error
      );
    }
  }

  /**
   * Update user role in tenant
   */
  async updateUserRole(
    tenantId: string, 
    userId: string, 
    role: UserRole, 
    permissions?: string[]
  ): Promise<void> {
    const { error } = await this.supabase
      .from('tenant_users')
      .update({
        role,
        permissions,
        updated_at: new Date().toISOString()
      })
      .eq('tenant_id', tenantId)
      .eq('user_id', userId);

    if (error) {
      throw new AuthError(
        'Failed to update user role',
        ErrorCodes.DATABASE_ERROR,
        500,
        error
      );
    }

    // Emit role change event
    this.events.emit({
      id: uuidv4(),
      type: EventType.USER_ROLE_CHANGED,
      tenant_id: tenantId,
      user_id: userId,
      timestamp: new Date().toISOString(),
      data: { role, permissions }
    });
  }

  /**
   * Remove user from tenant
   */
  async removeUserFromTenant(tenantId: string, userId: string): Promise<void> {
    const { error } = await this.supabase
      .from('tenant_users')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('user_id', userId);

    if (error) {
      throw new AuthError(
        'Failed to remove user from tenant',
        ErrorCodes.DATABASE_ERROR,
        500,
        error
      );
    }

    // Emit user removal event
    this.events.emit({
      id: uuidv4(),
      type: EventType.USER_REMOVED,
      tenant_id: tenantId,
      user_id: userId,
      timestamp: new Date().toISOString(),
      data: {}
    });
  }

  /**
   * List tenant users
   */
  async getTenantUsers(tenantId: string): Promise<TenantUser[]> {
    const { data, error } = await this.supabase
      .from('tenant_users')
      .select(`
        *,
        users:user_id (
          id,
          email,
          name,
          avatar_url,
          status
        )
      `)
      .eq('tenant_id', tenantId);

    if (error) {
      throw new AuthError(
        'Failed to fetch tenant users',
        ErrorCodes.DATABASE_ERROR,
        500,
        error
      );
    }

    return data || [];
  }

  /**
   * Check if user has permission
   */
  async hasPermission(
    tenantId: string, 
    userId: string, 
    permission: string
  ): Promise<boolean> {
    const { data } = await this.supabase
      .from('tenant_users')
      .select('role, permissions')
      .eq('tenant_id', tenantId)
      .eq('user_id', userId)
      .single();

    if (!data) {
      return false;
    }

    // Owner and admin have all permissions
    if (data.role === UserRole.OWNER || data.role === UserRole.ADMIN) {
      return true;
    }

    // Check specific permissions
    return data.permissions?.includes(permission) || false;
  }

  /**
   * Get user profile
   */
  private async getUserProfile(userId: string): Promise<User | null> {
    const { data, error } = await this.supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();

    if (error) {
      return null;
    }

    return data;
  }

  /**
   * Get tenant context for user
   */
  private async getTenantContext(userId: string, tenantSlug: string) {
    const { data } = await this.supabase
      .from('tenant_users')
      .select(`
        role,
        permissions,
        tenants:tenant_id (
          id,
          slug,
          status
        )
      `)
      .eq('user_id', userId)
      .eq('tenants.slug', tenantSlug)
      .single();

    return data ? {
      id: data.tenants.id,
      slug: data.tenants.slug,
      role: data.role,
      permissions: data.permissions
    } : null;
  }

  /**
   * Get default tenant for user
   */
  private async getDefaultTenantContext(userId: string) {
    const { data } = await this.supabase
      .from('tenant_users')
      .select(`
        role,
        permissions,
        tenants:tenant_id (
          id,
          slug,
          status
        )
      `)
      .eq('user_id', userId)
      .eq('tenants.status', 'active')
      .order('joined_at', { ascending: true })
      .limit(1)
      .single();

    return data ? {
      id: data.tenants.id,
      slug: data.tenants.slug,
      role: data.role,
      permissions: data.permissions
    } : null;
  }

  /**
   * Set tenant context in Supabase session
   */
  private async setTenantContext(tenantId: string): Promise<void> {
    // This would set the tenant context for RLS policies
    // In Supabase, this might involve setting a custom claim or session variable
    await this.supabase.rpc('set_tenant_context', { tenant_id: tenantId });
  }

  /**
   * Add user to tenant
   */
  private async addUserToTenant(
    tenantId: string,
    userId: string,
    role: UserRole,
    permissions?: string[]
  ): Promise<void> {
    const { error } = await this.supabase
      .from('tenant_users')
      .insert({
        id: uuidv4(),
        tenant_id: tenantId,
        user_id: userId,
        role,
        permissions,
        joined_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

    if (error) {
      throw new AuthError(
        'Failed to add user to tenant',
        ErrorCodes.DATABASE_ERROR,
        500,
        error
      );
    }
  }

  /**
   * Send invitation email
   */
  private async sendInvitationEmail(inviteData: InviteUser): Promise<void> {
    // This would integrate with an email service
    // For now, we'll just log the invitation
    console.log(`Sending invitation to ${inviteData.email} for tenant ${inviteData.tenant_id}`);
  }
}
