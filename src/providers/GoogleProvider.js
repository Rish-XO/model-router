const BaseProvider = require('./BaseProvider');
const axios = require('axios');
const { logger } = require('../api/middleware/logging');

class GoogleProvider extends BaseProvider {
  constructor(config) {
    super(config);
    if (!this.apiKey) {
      throw new Error('GOOGLE_API_KEY environment variable is required');
    }
  }
  
  async makeRequest(openAIRequest) {
    logger.info('Making request to Google Gemini', {
      model: openAIRequest.model,
      provider: this.name
    });
    
    try {
      // Transform request
      const googleRequest = this.transformRequest(openAIRequest);
      
      // Make API call
      const response = await axios.post(
        `${this.endpoint}?key=${this.apiKey}`,
        googleRequest,
        {
          headers: {
            'Content-Type': 'application/json'
          },
          timeout: 10000 // 10 second timeout
        }
      );
      
      // Transform response
      return this.transformResponse(response.data, openAIRequest);
      
    } catch (error) {
      logger.error('Google Gemini request failed', {
        error: error.message,
        status: error.response?.status,
        provider: this.name
      });
      throw error;
    }
  }
  
  transformRequest(openAIRequest) {
    // Convert OpenAI format to Google Gemini format
    const userMessage = openAIRequest.messages.find(m => m.role === 'user');
    
    return {
      contents: [{
        parts: [{ text: userMessage.content }]
      }]
    };
  }
  
  transformResponse(googleResponse, originalRequest) {
    // Convert Google response to OpenAI format
    const content = googleResponse.candidates?.[0]?.content?.parts?.[0]?.text || 'No response';
    
    return {
      id: 'chatcmpl-' + Date.now(),
      object: 'chat.completion',
      model: originalRequest.model,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: content
        },
        finish_reason: 'stop'
      }],
      usage: {
        prompt_tokens: this.estimateTokens(originalRequest.messages[0].content),
        completion_tokens: this.estimateTokens(content),
        total_tokens: this.estimateTokens(originalRequest.messages[0].content + content)
      }
    };
  }
  
  estimateTokens(text) {
    // Rough token estimation (4 chars H 1 token)
    return Math.ceil(text.length / 4);
  }
}

module.exports = GoogleProvider;