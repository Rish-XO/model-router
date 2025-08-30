const axios = require('axios');

class BaseProvider {
  constructor(config) {
    this.name = config.name;
    this.endpoint = config.endpoint;
    this.apiKey = process.env[config.api_key_env];
    this.config = config;
  }

  async makeRequest(openAIRequest) {
    throw new Error('makeRequest must be implemented by provider');
  }

  transformRequest(openAIRequest) {
    throw new Error('transformRequest must be implemented by provider');
  }

  transformResponse(providerResponse, originalRequest) {
    throw new Error('transformResponse must be implemented by provider');
  }

  async healthCheck() {
    try {
      const testRequest = {
        model: 'test',
        messages: [{ role: 'user', content: 'test' }]
      };

      const start = Date.now();
      await this.makeRequest(testRequest);
      const latency = Date.now() - start;

      return { status: 'healthy', latency };
    } catch (error) {
      return { status: 'unhealthy', error: error.message };
    }
  }
}

module.exports = BaseProvider;
