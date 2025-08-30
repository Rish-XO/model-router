const TenantManager = require('../../config/TenantManager');
const { logger } = require('./logging');

const tenantManager = new TenantManager();

class AuthMiddleware {
  async authenticateAPIKey(req, res, next) {
    try {
      const authHeader = req.headers.authorization;

      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
          error: {
            message: 'Missing or invalid authorization header',
            type: 'authentication_error'
          }
        });
      }

      const apiKey = authHeader.split(' ')[1];

      // Find tenant by API key using TenantManager
      const tenant = tenantManager.findTenantByAPIKey(apiKey);

      if (!tenant) {
        return res.status(401).json({
          error: {
            message: 'Invalid API key',
            type: 'authentication_error'
          }
        });
      }

      // Add tenant info to request
      req.tenant = tenant;

      logger.info('Request authenticated', {
        tenant_id: tenant.tenant_id,
        api_key: apiKey.substring(0, 8) + '...' // Log partial key for debugging
      });

      next();

    } catch (error) {
      logger.error('Authentication error', error);
      return res.status(500).json({
        error: {
          message: 'Authentication service error',
          type: 'api_error'
        }
      });
    }
  }

}

module.exports = new AuthMiddleware();
