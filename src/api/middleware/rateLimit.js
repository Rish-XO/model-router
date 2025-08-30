const rateLimit = require('express-rate-limit');
const { logger } = require('./logging');

// In-memory store for demo (use Redis in production)
const rateLimitStore = new Map();

const createRateLimiter = () => {
  return rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60 * 1000, // 1 minute
    max: (req) => {
      // Get tenant-specific limits
      const tenant = req.tenant;
      if (tenant && tenant.quotas) {
        return tenant.quotas.rate_limit_per_minute || 100;
      }
      return 100; // Default limit
    },
    keyGenerator: (req, res) => {
      // Rate limit per tenant
      if (req.tenant?.tenant_id) {
        return `tenant:${req.tenant.tenant_id}`;
      }
      // Use standard express-rate-limit default key generator for IP handling
      return undefined; // Let express-rate-limit handle IP automatically
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
    handler: (req, res) => {
      logger.warn('Rate limit exceeded', {
        tenant_id: req.tenant?.tenant_id,
        ip: req.ip
      });
      
      const tenant = req.tenant;
      const limit = tenant?.quotas?.rate_limit_per_minute || 100;
      
      res.status(429).json({
        error: {
          message: `Rate limit exceeded. Maximum ${limit} requests per minute per tenant.`,
          type: 'rate_limit_error'
        }
      });
    }
    // Removed custom store - using express-rate-limit's default memory store
  });
};

module.exports = { createRateLimiter };