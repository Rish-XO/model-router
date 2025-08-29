const express = require('express');
const router = express.Router();
const { logger } = require('../middleware/logging');
const { validateChatCompletion } = require('../middleware/validation');
const ConfigLoader = require('../../config/ConfigLoader');
const GoogleProvider = require('../../providers/GoogleProvider');

// POST /v1/chat/completions
router.post('/completions', validateChatCompletion, async (req, res) => {
  try {
    logger.info('Chat completion request received', {
      model: req.body.model,
      messages: req.body.messages?.length || 0
    });
    
    // Load provider configuration and create provider instance
    const providerConfig = ConfigLoader.loadProvider('google');
    const provider = new GoogleProvider(providerConfig);
    
    // Make request to Google Gemini
    const response = await provider.makeRequest(req.body);
    
    res.json(response);
  } catch (error) {
    logger.error('Chat completion error', error);
    res.status(500).json({
      error: {
        message: error.message,
        type: 'api_error'
      }
    });
  }
});

module.exports = router;