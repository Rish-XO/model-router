const BaseProvider = require('../../src/providers/BaseProvider');

class MockProvider extends BaseProvider {
  constructor(name, config = {}) {
    super({ name, ...config });
    this.shouldFail = config.shouldFail || false;
    this.latency = config.latency || 100;
    this.failureRate = config.failureRate || 0;
  }
  
  async makeRequest(openAIRequest) {
    // Simulate network latency
    await new Promise(resolve => setTimeout(resolve, this.latency));
    
    // Random failure based on failure rate
    if (this.failureRate > 0 && Math.random() < this.failureRate) {
      throw new Error(`Mock provider ${this.name} randomly failed`);
    }
    
    if (this.shouldFail) {
      throw new Error(`Mock provider ${this.name} failed`);
    }
    
    const userMessage = openAIRequest.messages?.find(m => m.role === 'user');
    const content = userMessage?.content || 'No content';
    
    return {
      id: `mock-${this.name}-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: openAIRequest.model || 'mock-model',
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: `Mock response from ${this.name}: ${content}`
        },
        finish_reason: 'stop'
      }],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 15,
        total_tokens: 25
      },
      system_fingerprint: `mock-${this.name}`
    };
  }
  
  async healthCheck() {
    await new Promise(resolve => setTimeout(resolve, 50));
    
    if (this.shouldFail) {
      return { 
        status: 'unhealthy', 
        error: 'Mock provider is configured to fail',
        latency: this.latency 
      };
    }
    
    return { 
      status: 'healthy', 
      latency: this.latency,
      timestamp: new Date().toISOString()
    };
  }
  
  transformRequest(openAIRequest) {
    return openAIRequest;
  }
  
  transformResponse(providerResponse) {
    return providerResponse;
  }
}

class MockGoogleProvider extends MockProvider {
  constructor(config = {}) {
    super('mock-google-gemini', config);
    this.type = 'google';
  }
}

class MockHuggingFaceProvider extends MockProvider {
  constructor(config = {}) {
    super('mock-hugging-face', config);
    this.type = 'huggingface';
  }
}

module.exports = {
  MockProvider,
  MockGoogleProvider,
  MockHuggingFaceProvider
};