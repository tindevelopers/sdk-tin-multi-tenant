import { z } from 'zod';
import { validateSchema, safeValidateSchema, validateTenantSlug, validateEmail } from '../../utils/validation';

describe('Validation Utils', () => {
  const testSchema = z.object({
    name: z.string().min(1),
    age: z.number().min(0),
  });

  describe('validateSchema', () => {
    it('should validate valid data successfully', () => {
      const validData = { name: 'John', age: 30 };
      const result = validateSchema(testSchema, validData);
      
      expect(result).toEqual(validData);
    });

    it('should throw ValidationError for invalid data', () => {
      const invalidData = { name: '', age: -1 };
      
      expect(() => validateSchema(testSchema, invalidData)).toThrow('Validation failed');
    });
  });

  describe('safeValidateSchema', () => {
    it('should return success result for valid data', () => {
      const validData = { name: 'John', age: 30 };
      const result = safeValidateSchema(testSchema, validData);
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(validData);
      }
    });

    it('should return error result for invalid data', () => {
      const invalidData = { name: '', age: -1 };
      const result = safeValidateSchema(testSchema, invalidData);
      
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBeDefined();
      }
    });
  });

  describe('validateTenantSlug', () => {
    it('should validate correct tenant slugs', () => {
      expect(validateTenantSlug('valid-slug')).toBe(true);
      expect(validateTenantSlug('company123')).toBe(true);
      expect(validateTenantSlug('test-org-2024')).toBe(true);
    });

    it('should reject invalid tenant slugs', () => {
      expect(validateTenantSlug('')).toBe(false);
      expect(validateTenantSlug('a')).toBe(false); // too short
      expect(validateTenantSlug('invalid_slug')).toBe(false); // underscore
      expect(validateTenantSlug('Invalid-Slug')).toBe(false); // uppercase
      expect(validateTenantSlug('slug with spaces')).toBe(false); // spaces
      expect(validateTenantSlug('slug@domain')).toBe(false); // special chars
    });
  });

  describe('validateEmail', () => {
    it('should validate correct email addresses', () => {
      expect(validateEmail('user@example.com')).toBe(true);
      expect(validateEmail('test.email+tag@domain.co.uk')).toBe(true);
      expect(validateEmail('user123@test-domain.org')).toBe(true);
    });

    it('should reject invalid email addresses', () => {
      expect(validateEmail('')).toBe(false);
      expect(validateEmail('invalid-email')).toBe(false);
      expect(validateEmail('user@')).toBe(false);
      expect(validateEmail('@domain.com')).toBe(false);
      expect(validateEmail('user@domain')).toBe(false);
      expect(validateEmail('user space@domain.com')).toBe(false);
    });
  });
});
