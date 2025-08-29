const express = require('express');
const router = express.Router();
const { logger } = require('../middleware/logging');
const { validateChatCompletion } = require('../middleware/validation');
const authMiddleware = require('../middleware/auth');
const { createRateLimiter } = require('../middleware/rateLimit');
const RouterEngine = require('../../router/RouterEngine');
const TenantManager = require('../../config/TenantManager');

// Create singleton instances
let routerEngine = null;
let tenantManager = null;

try {
  routerEngine = new RouterEngine();
  tenantManager = new TenantManager();
} catch (error) {
  logger.error('Failed to initialize RouterEngine or TenantManager', error);
}

const rateLimiter = createRateLimiter();

// Apply middleware to all routes
router.use(authMiddleware.authenticateAPIKey);
router.use(rateLimiter);

// POST /v1/chat/completions
router.post('/completions', validateChatCompletion, async (req, res) => {
  const startTime = Date.now();
  
  try {
    logger.info('🔄 Chat completion request received - ENTRY', {
      tenant: req.tenant?.tenant_id,
      model: req.body.model,
      messages: req.body.messages?.length || 0,
      hasRouterEngine: !!routerEngine,
      hasTenantManager: !!tenantManager
    });
    
    if (!routerEngine || !tenantManager) {
      throw new Error('RouterEngine or TenantManager not available');
    }
    
    // Check tenant quota
    logger.info('🔍 Checking tenant quota...');
    const quotaCheck = tenantManager.checkQuota(req.tenant.tenant_id, 'daily_requests');
    logger.info('✅ Quota check complete', { quotaCheck });
    
    if (!quotaCheck.allowed) {
      logger.warn('❌ Quota exceeded', { quotaCheck });
      return res.status(429).json({
        error: {
          message: `Daily quota exceeded. Limit: ${quotaCheck.limit}, Used: ${quotaCheck.used}`,
          type: 'quota_exceeded',
          quota_status: quotaCheck
        }
      });
    }
    
    // Route request through intelligent routing system with authenticated tenant
    logger.info('🚀 Calling RouterEngine.routeRequest...');
    const response = await routerEngine.routeRequest(req.body, req.tenant);
    logger.info('✅ RouterEngine.routeRequest completed', { 
      provider: response.routing_metadata?.primary_provider,
      attempts: response.routing_metadata?.attempts?.length
    });
    
    const duration = Date.now() - startTime;
    
    // Track usage
    tenantManager.trackUsage(req.tenant.tenant_id, {
      total_tokens: response.usage?.total_tokens || 0,
      duration,
      model: req.body.model,
      estimated_cost: (response.usage?.total_tokens || 0) * 0.002 // $0.002 per token
    });
    
    // Enhance response metadata
    if (response.routing_metadata) {
      response.routing_metadata.api_processing_time = duration;
      response.routing_metadata.timestamp = new Date().toISOString();
      response.routing_metadata.tenant_id = req.tenant.tenant_id;
    }
    
    logger.info('Chat completion success', {
      tenant: req.tenant.tenant_id,
      duration,
      provider: response.routing_metadata?.primary_provider,
      attempts: response.routing_metadata?.attempts?.length || 1,
      tokens: response.usage?.total_tokens
    });
    
    res.json(response);
    
  } catch (error) {
    const duration = Date.now() - startTime;
    
    logger.error('Chat completion error', {
      error: error.message,
      duration,
      attempts: error.attempts?.length,
      providers_attempted: error.providersAttempted
    });
    
    // Determine appropriate error code
    let statusCode = 500;
    let errorType = 'api_error';
    
    if (error.message.includes('No providers available')) {
      statusCode = 503;
      errorType = 'service_unavailable';
    } else if (error.message.includes('All providers failed')) {
      statusCode = 502;
      errorType = 'bad_gateway';
    }
    
    res.status(statusCode).json({
      error: {
        message: error.message,
        type: errorType,
        details: {
          attempts: error.attempts || [],
          providers_attempted: error.providersAttempted || 0,
          processing_time_ms: duration
        }
      }
    });
  }
});

module.exports = router;