import { User, AuthContext, LoginRequest } from '../types/auth';

/**
 * Abstract authentication provider interface
 * Supports different auth providers (Supabase, Auth0, Firebase, etc.)
 */
export interface IAuthProvider {
  /**
   * Initialize the authentication provider
   */
  initialize(): Promise<void>;

  /**
   * Authenticate user with credentials
   */
  signIn(credentials: LoginRequest): Promise<AuthSession>;

  /**
   * Sign out current user
   */
  signOut(): Promise<void>;

  /**
   * Get current authenticated user
   */
  getCurrentUser(): Promise<User | null>;

  /**
   * Get current session
   */
  getSession(): Promise<AuthSession | null>;

  /**
   * Refresh authentication token
   */
  refreshToken(refreshToken: string): Promise<AuthSession>;

  /**
   * Create a new user account
   */
  createUser(userData: CreateUserRequest): Promise<User>;

  /**
   * Update user profile
   */
  updateUser(userId: string, updates: Partial<User>): Promise<User>;

  /**
   * Delete user account
   */
  deleteUser(userId: string): Promise<void>;

  /**
   * Send password reset email
   */
  resetPassword(email: string): Promise<void>;

  /**
   * Verify email address
   */
  verifyEmail(token: string): Promise<boolean>;

  /**
   * Get user by email
   */
  getUserByEmail(email: string): Promise<User | null>;

  /**
   * Get user by ID
   */
  getUserById(userId: string): Promise<User | null>;

  /**
   * Check if user exists
   */
  userExists(email: string): Promise<boolean>;

  /**
   * Generate invitation token
   */
  generateInviteToken(email: string, tenantId: string): Promise<string>;

  /**
   * Accept invitation and create user
   */
  acceptInvitation(token: string, userData: AcceptInviteRequest): Promise<User>;

  /**
   * Set up authentication event listeners
   */
  onAuthStateChange(callback: (event: AuthEvent, session: AuthSession | null) => void): () => void;

  /**
   * Get provider health status
   */
  getHealth(): Promise<{
    connected: boolean;
    error?: string;
  }>;
}

/**
 * Authentication session interface
 */
export interface AuthSession {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  user: User;
}

/**
 * Create user request interface
 */
export interface CreateUserRequest {
  email: string;
  password: string;
  name: string;
  avatar_url?: string;
  metadata?: Record<string, any>;
}

/**
 * Accept invitation request interface
 */
export interface AcceptInviteRequest {
  password: string;
  name: string;
  avatar_url?: string;
}

/**
 * Authentication event types
 */
export type AuthEvent = 
  | 'SIGNED_IN'
  | 'SIGNED_OUT'
  | 'TOKEN_REFRESHED'
  | 'USER_UPDATED'
  | 'PASSWORD_RECOVERY';

/**
 * Authentication provider configuration
 */
export interface AuthProviderConfig {
  type: 'supabase' | 'auth0' | 'firebase' | 'custom';
  
  // Supabase
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  
  // Auth0
  auth0Domain?: string;
  auth0ClientId?: string;
  auth0ClientSecret?: string;
  
  // Firebase
  firebaseConfig?: {
    apiKey: string;
    authDomain: string;
    projectId: string;
  };
  
  // Custom provider
  customConfig?: Record<string, any>;
  
  // Common settings
  redirectUrl?: string;
  sessionTimeout?: number;
  enableRefreshToken?: boolean;
}
