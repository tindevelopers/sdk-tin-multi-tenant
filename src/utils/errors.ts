// Custom Error Classes for Multi-Tenant SDK

export class SDKError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly details?: any;

  constructor(message: string, code: string, statusCode: number = 500, details?: any) {
    super(message);
    this.name = 'SDKError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export class TenantError extends SDKError {
  constructor(message: string, code: string, statusCode: number = 400, details?: any) {
    super(message, code, statusCode, details);
    this.name = 'TenantError';
  }
}

export class AuthError extends SDKError {
  constructor(message: string, code: string, statusCode: number = 401, details?: any) {
    super(message, code, statusCode, details);
    this.name = 'AuthError';
  }
}

export class DataError extends SDKError {
  constructor(message: string, code: string, statusCode: number = 400, details?: any) {
    super(message, code, statusCode, details);
    this.name = 'DataError';
  }
}

export class ValidationError extends SDKError {
  constructor(message: string, details?: any) {
    super(message, 'VALIDATION_ERROR', 400, details);
    this.name = 'ValidationError';
  }
}

// Error Codes
export const ErrorCodes = {
  // Tenant Errors
  TENANT_NOT_FOUND: 'TENANT_NOT_FOUND',
  TENANT_SLUG_EXISTS: 'TENANT_SLUG_EXISTS',
  TENANT_SUSPENDED: 'TENANT_SUSPENDED',
  TENANT_LIMIT_EXCEEDED: 'TENANT_LIMIT_EXCEEDED',
  
  // Auth Errors
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  INSUFFICIENT_PERMISSIONS: 'INSUFFICIENT_PERMISSIONS',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  INVALID_TOKEN: 'INVALID_TOKEN',
  
  // Data Errors
  RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
  DUPLICATE_RESOURCE: 'DUPLICATE_RESOURCE',
  INVALID_QUERY: 'INVALID_QUERY',
  
  // System Errors
  DATABASE_ERROR: 'DATABASE_ERROR',
  NETWORK_ERROR: 'NETWORK_ERROR',
  CONFIGURATION_ERROR: 'CONFIGURATION_ERROR'
} as const;

export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes];
