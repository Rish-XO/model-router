const rateLimit = require('express-rate-limit');
const { logger } = require('./logging');

// In-memory store for demo (use Redis in production)
const rateLimitStore = new Map();

const createRateLimiter = () => {
  return rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
    max: (req) => {
      // Get tenant-specific limits
      const tenant = req.tenant;
      if (tenant && tenant.quotas) {
        return tenant.quotas.rate_limit_per_minute || 100;
      }
      return 100; // Default limit
    },
    keyGenerator: (req) => {
      // Rate limit per tenant
      return req.tenant?.tenant_id || req.ip;
    },
    message: (req) => {
      const tenant = req.tenant;
      const limit = tenant?.quotas?.rate_limit_per_minute || 100;
      
      return {
        error: {
          message: `Rate limit exceeded. Maximum ${limit} requests per minute per tenant.`,
          type: 'rate_limit_error'
        }
      };
    },
    onLimitReached: (req) => {
      logger.warn('Rate limit exceeded', {
        tenant_id: req.tenant?.tenant_id,
        ip: req.ip
      });
    },
    store: {
      // Custom store implementation for tenant-based limits
      incr: (key) => {
        const now = Date.now();
        const windowMs = 15 * 60 * 1000;
        const current = rateLimitStore.get(key) || { count: 0, resetTime: now + windowMs };
        
        if (now > current.resetTime) {
          current.count = 0;
          current.resetTime = now + windowMs;
        }
        
        current.count++;
        rateLimitStore.set(key, current);
        
        // Cleanup expired entries to prevent memory leak
        for (const [storeKey, value] of rateLimitStore.entries()) {
          if (now > value.resetTime) {
            rateLimitStore.delete(storeKey);
          }
        }
        
        return Promise.resolve({
          totalHits: current.count,
          resetTime: new Date(current.resetTime)
        });
      }
    }
  });
};

module.exports = { createRateLimiter };