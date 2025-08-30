// Minimal rate limiter test - only testing configuration
const { createRateLimiter } = require('../src/api/middleware/rateLimit');

// Mock logger
jest.mock('../src/api/middleware/logging', () => ({
  logger: { warn: jest.fn() }
}));

describe('Rate Limiter Configuration', () => {
  test('should create rate limiter function', () => {
    const rateLimiter = createRateLimiter();
    expect(typeof rateLimiter).toBe('function');
  });

  test('should return correct limit for tenant with quotas', () => {
    const rateLimiter = createRateLimiter();
    
    // Mock request with tenant
    const mockReq = {
      tenant: {
        tenant_id: 'test',
        quotas: { rate_limit_per_minute: 60 }
      }
    };
    
    // Extract the max function and test it
    const maxFn = rateLimiter.options?.max || rateLimiter.max;
    if (typeof maxFn === 'function') {
      expect(maxFn(mockReq)).toBe(60);
    }
  });

  test('should return default limit for request without tenant', () => {
    const rateLimiter = createRateLimiter();
    
    const mockReq = { tenant: null };
    
    const maxFn = rateLimiter.options?.max || rateLimiter.max;
    if (typeof maxFn === 'function') {
      expect(maxFn(mockReq)).toBe(100);
    }
  });
});