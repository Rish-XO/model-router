const express = require('express');
const router = express.Router();
const { logger } = require('../middleware/logging');
const { validateChatCompletion } = require('../middleware/validation');
const RouterEngine = require('../../router/RouterEngine');

// Create singleton RouterEngine instance
let routerEngine = null;
try {
  routerEngine = new RouterEngine();
} catch (error) {
  logger.error('Failed to initialize RouterEngine', error);
}

// POST /v1/chat/completions
router.post('/completions', validateChatCompletion, async (req, res) => {
  const startTime = Date.now();
  
  try {
    logger.info('Chat completion request received', {
      model: req.body.model,
      messages: req.body.messages?.length || 0
    });
    
    if (!routerEngine) {
      throw new Error('RouterEngine not available');
    }
    
    // For now, use default tenant (in Phase 4 we'll add authentication)
    const defaultTenant = {
      tenant_id: 'default',
      providers: {
        enabled: ['google-gemini'],
        routing_policy: 'balanced'
      }
    };
    
    // Route request through intelligent routing system
    const response = await routerEngine.routeRequest(req.body, defaultTenant);
    
    const duration = Date.now() - startTime;
    
    // Enhance response metadata
    if (response.routing_metadata) {
      response.routing_metadata.api_processing_time = duration;
      response.routing_metadata.timestamp = new Date().toISOString();
    }
    
    logger.info('Chat completion success', {
      duration,
      provider: response.routing_metadata?.primary_provider,
      attempts: response.routing_metadata?.attempts?.length || 1
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