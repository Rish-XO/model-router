const BaseProvider = require('./BaseProvider');
const axios = require('axios');
const { logger } = require('../api/middleware/logging');

class HuggingFaceProvider extends BaseProvider {
  constructor(config) {
    super(config);
    if (!this.apiKey) {
      throw new Error('HUGGINGFACE_API_TOKEN environment variable is required');
    }
  }
  
  async makeRequest(openAIRequest) {
    logger.info('Making request to HuggingFace', {
      model: openAIRequest.model,
      provider: this.name
    });
    
    try {
      // Transform request
      const hfRequest = this.transformRequest(openAIRequest);
      
      // Make API call
      const response = await axios.post(
        this.endpoint,
        hfRequest,
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 12000 // 12 second timeout
        }
      );
      
      // Transform response
      return this.transformResponse(response.data, openAIRequest);
      
    } catch (error) {
      logger.error('HuggingFace request failed', {
        error: error.message,
        status: error.response?.status,
        provider: this.name
      });
      
      // Handle specific HF errors
      if (error.response?.status === 503) {
        throw new Error('Model is loading, please retry in a few minutes');
      }
      
      throw error;
    }
  }
  
  transformRequest(openAIRequest) {
    // Convert OpenAI format to HuggingFace format
    const userMessage = openAIRequest.messages.find(m => m.role === 'user');
    
    return {
      inputs: userMessage.content,
      parameters: {
        max_new_tokens: openAIRequest.max_tokens || 100,
        temperature: openAIRequest.temperature || 0.7,
        return_full_text: false
      }
    };
  }
  
  transformResponse(hfResponse, originalRequest) {
    // Handle different HF response formats
    let content = '';
    
    if (Array.isArray(hfResponse)) {
      // Text generation format
      content = hfResponse[0]?.generated_text || 'No response';
    } else if (hfResponse.generated_text) {
      // Direct text format
      content = hfResponse.generated_text;
    } else if (hfResponse[0]?.generated_text) {
      // Nested format
      content = hfResponse[0].generated_text;
    } else {
      content = 'No response available';
    }
    
    // Clean up response (remove input text if included)
    const userMessage = originalRequest.messages.find(m => m.role === 'user')?.content || '';
    if (content.startsWith(userMessage)) {
      content = content.substring(userMessage.length).trim();
    }
    
    return {
      id: 'chatcmpl-hf-' + Date.now(),
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
        prompt_tokens: this.estimateTokens(userMessage),
        completion_tokens: this.estimateTokens(content),
        total_tokens: this.estimateTokens(userMessage + content)
      }
    };
  }
  
  estimateTokens(text) {
    return Math.ceil(text.length / 4);
  }
  
  async healthCheck() {
    try {
      const testRequest = {
        inputs: "Hello",
        parameters: { max_new_tokens: 10 }
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

module.exports = HuggingFaceProvider;