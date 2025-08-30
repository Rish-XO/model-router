const BaseProvider = require('./BaseProvider');
const axios = require('axios');
const { logger } = require('../api/middleware/logging');

class GroqProvider extends BaseProvider {
  constructor(config) {
    super(config);
    if (!this.apiKey) {
      throw new Error('GROQ_API_KEY environment variable is required');
    }
  }

  async makeRequest(openAIRequest) {
    logger.info('🚀 GroqProvider.makeRequest - ENTRY', {
      model: openAIRequest.model,
      provider: this.name,
      endpoint: this.endpoint,
      hasApiKey: !!this.apiKey
    });

    try {
      // Groq uses OpenAI-compatible format, so minimal transformation needed
      const groqRequest = {
        model: 'llama3-8b-8192', // Groq's fast model
        messages: openAIRequest.messages,
        max_tokens: openAIRequest.max_tokens || 1024,
        temperature: openAIRequest.temperature || 0.7,
        stream: false
      };

      logger.info('🚀 Making request to Groq API...', {
        model: groqRequest.model,
        messagesCount: groqRequest.messages.length
      });

      const response = await axios.post(
        this.endpoint,
        groqRequest,
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 10000 // 10 second timeout
        }
      );

      logger.info('✅ Groq response received', {
        status: response.status,
        hasData: !!response.data,
        usage: response.data.usage
      });

      // Groq returns OpenAI-compatible format, so return directly
      return response.data;

    } catch (error) {
      logger.error('❌ Groq request failed', {
        error: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        provider: this.name
      });

      // Handle specific Groq errors
      if (error.response?.status === 401) {
        throw new Error('Groq API key is invalid or expired');
      }
      if (error.response?.status === 429) {
        throw new Error('Groq rate limit exceeded');
      }

      throw error;
    }
  }

  async healthCheck() {
    try {
      const testRequest = {
        model: 'llama3-8b-8192',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 10
      };

      const start = Date.now();
      const response = await axios.post(
        this.endpoint,
        testRequest,
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 5000
        }
      );

      const latency = Date.now() - start;
      return { status: 'healthy', latency };

    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
        latency: 999999
      };
    }
  }
}

module.exports = GroqProvider;
