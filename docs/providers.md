# Provider Integration Guide

## Overview

The Model Router uses an adapter pattern to integrate with different LLM providers. Each provider implements a common interface while handling the specifics of their API format, authentication, and response transformation.

## Quick Start - Adding a New Provider

### 1. Create Provider Class

Create a new file in `src/providers/` that extends `BaseProvider`:

```javascript
// src/providers/AnthropicProvider.js
const BaseProvider = require('./BaseProvider');
const axios = require('axios');
const { logger } = require('../api/middleware/logging');

class AnthropicProvider extends BaseProvider {
  constructor(config) {
    super(config);
    if (!this.apiKey) {
      throw new Error('ANTHROPIC_API_KEY environment variable is required');
    }
  }
  
  async makeRequest(openAIRequest) {
    // Implementation details below...
  }
  
  async healthCheck() {
    // Health check implementation...
  }
}

module.exports = AnthropicProvider;
```

### 2. Register Provider

Add your provider to the RouterEngine:

```javascript
// src/router/RouterEngine.js
getProviderClass(type) {
  const providerMapping = {
    'google': require('../providers/GoogleProvider'),
    'groq': require('../providers/GroqProvider'),
    'anthropic': require('../providers/AnthropicProvider'), // Add this line
    // ... other providers
  };
  
  return providerMapping[type];
}
```

### 3. Add Configuration

Configure your provider in the JSON config files:

```json
// config/providers.json
{
  "anthropic": {
    "name": "anthropic",
    "type": "anthropic", 
    "enabled": true,
    "endpoint": "https://api.anthropic.com/v1/messages",
    "api_key_env": "ANTHROPIC_API_KEY",
    "capabilities": ["chat", "text-generation"],
    "limits": {
      "requests_per_minute": 60,
      "requests_per_day": 10000
    }
  }
}
```

```json
// config/tenants/default.json  
{
  "providers": {
    "enabled": ["anthropic", "groq", "google-gemini"],
    "routing_policy": "balanced"
  }
}
```

### 4. Add Environment Variable

```bash
# .env
ANTHROPIC_API_KEY=your-anthropic-api-key-here
```

That's it! Your provider is now integrated and will be included in the routing logic.

## BaseProvider Interface

All providers must extend `BaseProvider` and implement these methods:

### Required Methods

#### `makeRequest(openAIRequest)`
Convert OpenAI format request to provider format, make the API call, and return OpenAI-compatible response.

**Parameters:**
- `openAIRequest`: OpenAI-formatted request object

**Returns:** 
- OpenAI-compatible response object

#### `healthCheck()`
Check if the provider is healthy and responsive.

**Returns:**
```javascript
{
  status: 'healthy' | 'unhealthy',
  latency: number, // milliseconds
  error?: string   // if unhealthy
}
```

### Optional Methods

#### `transformRequest(openAIRequest)`
Transform OpenAI request format to provider-specific format.

#### `transformResponse(providerResponse, originalRequest)`
Transform provider response back to OpenAI format.

#### `estimateTokens(text)`
Estimate token count for cost calculations.

## Implementation Examples

### Example 1: Anthropic Claude

```javascript
const BaseProvider = require('./BaseProvider');
const axios = require('axios');
const { logger } = require('../api/middleware/logging');

class AnthropicProvider extends BaseProvider {
  constructor(config) {
    super(config);
    if (!this.apiKey) {
      throw new Error('ANTHROPIC_API_KEY environment variable is required');
    }
  }
  
  async makeRequest(openAIRequest) {
    logger.info('Making request to Anthropic', {
      model: openAIRequest.model,
      provider: this.name
    });
    
    try {
      // Transform request
      const anthropicRequest = this.transformRequest(openAIRequest);
      
      // Make API call
      const response = await axios.post(
        this.endpoint,
        anthropicRequest,
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            'anthropic-version': '2023-06-01'
          },
          timeout: 15000
        }
      );
      
      // Transform response
      return this.transformResponse(response.data, openAIRequest);
      
    } catch (error) {
      logger.error('Anthropic request failed', {
        error: error.message,
        status: error.response?.status,
        provider: this.name
      });
      
      // Handle specific Anthropic errors
      if (error.response?.status === 401) {
        throw new Error('Anthropic API key is invalid');
      }
      if (error.response?.status === 429) {
        throw new Error('Anthropic rate limit exceeded');
      }
      
      throw error;
    }
  }
  
  transformRequest(openAIRequest) {
    // Convert OpenAI messages to Anthropic format
    const messages = openAIRequest.messages;
    const systemMessage = messages.find(m => m.role === 'system');
    const userMessages = messages.filter(m => m.role !== 'system');
    
    return {
      model: 'claude-3-sonnet-20240229',
      max_tokens: openAIRequest.max_tokens || 1024,
      system: systemMessage?.content || '',
      messages: userMessages.map(msg => ({
        role: msg.role,
        content: msg.content
      })),
      temperature: openAIRequest.temperature || 0.7
    };
  }
  
  transformResponse(anthropicResponse, originalRequest) {
    const content = anthropicResponse.content[0]?.text || '';
    
    return {
      id: `chatcmpl-anthropic-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: anthropicResponse.model,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: content
        },
        finish_reason: anthropicResponse.stop_reason === 'end_turn' ? 'stop' : 'length'
      }],
      usage: {
        prompt_tokens: anthropicResponse.usage?.input_tokens || this.estimateTokens(
          originalRequest.messages.map(m => m.content).join(' ')
        ),
        completion_tokens: anthropicResponse.usage?.output_tokens || this.estimateTokens(content),
        total_tokens: (anthropicResponse.usage?.input_tokens || 0) + 
                     (anthropicResponse.usage?.output_tokens || 0)
      }
    };
  }
  
  async healthCheck() {
    try {
      const testRequest = {
        model: 'claude-3-sonnet-20240229',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Hello' }]
      };
      
      const start = Date.now();
      const response = await axios.post(
        this.endpoint,
        testRequest,
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            'anthropic-version': '2023-06-01'
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
  
  estimateTokens(text) {
    // Simple estimation: ~4 characters per token
    return Math.ceil(text.length / 4);
  }
}

module.exports = AnthropicProvider;
```

### Example 2: Cohere

```javascript
const BaseProvider = require('./BaseProvider');
const axios = require('axios');
const { logger } = require('../api/middleware/logging');

class CohereProvider extends BaseProvider {
  constructor(config) {
    super(config);
    if (!this.apiKey) {
      throw new Error('COHERE_API_KEY environment variable is required');
    }
  }
  
  async makeRequest(openAIRequest) {
    try {
      // Cohere uses different endpoint for chat
      const endpoint = this.endpoint.replace('/generate', '/chat');
      
      const cohereRequest = {
        model: 'command-r-plus',
        message: this.extractUserMessage(openAIRequest.messages),
        chat_history: this.buildChatHistory(openAIRequest.messages),
        max_tokens: openAIRequest.max_tokens || 1024,
        temperature: openAIRequest.temperature || 0.7
      };
      
      const response = await axios.post(endpoint, cohereRequest, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 15000
      });
      
      return this.transformResponse(response.data, openAIRequest);
      
    } catch (error) {
      logger.error('Cohere request failed', {
        error: error.message,
        status: error.response?.status
      });
      throw error;
    }
  }
  
  extractUserMessage(messages) {
    const userMessage = messages.findLast(m => m.role === 'user');
    return userMessage?.content || '';
  }
  
  buildChatHistory(messages) {
    return messages.slice(0, -1).map(msg => ({
      role: msg.role === 'assistant' ? 'CHATBOT' : 'USER',
      message: msg.content
    }));
  }
  
  transformResponse(cohereResponse, originalRequest) {
    return {
      id: `chatcmpl-cohere-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: 'command-r-plus',
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: cohereResponse.text
        },
        finish_reason: cohereResponse.finish_reason === 'COMPLETE' ? 'stop' : 'length'
      }],
      usage: {
        prompt_tokens: cohereResponse.meta?.tokens?.input_tokens || 0,
        completion_tokens: cohereResponse.meta?.tokens?.output_tokens || 0,
        total_tokens: (cohereResponse.meta?.tokens?.input_tokens || 0) + 
                     (cohereResponse.meta?.tokens?.output_tokens || 0)
      }
    };
  }
  
  async healthCheck() {
    try {
      const testRequest = {
        model: 'command-r-plus',
        message: 'Hello',
        max_tokens: 5
      };
      
      const start = Date.now();
      const response = await axios.post(
        this.endpoint.replace('/generate', '/chat'),
        testRequest,
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 5000
        }
      );
      
      return { status: 'healthy', latency: Date.now() - start };
      
    } catch (error) {
      return { status: 'unhealthy', error: error.message, latency: 999999 };
    }
  }
}

module.exports = CohereProvider;
```

## Provider Configuration Schema

### Provider JSON Schema

```json
{
  "provider-name": {
    "name": "string",           // Unique provider identifier
    "type": "string",           // Provider type (used for class mapping)  
    "enabled": "boolean",       // Whether provider is active
    "endpoint": "string",       // API endpoint URL
    "api_key_env": "string",    // Environment variable name for API key
    "capabilities": ["string"], // Supported capabilities
    "limits": {
      "requests_per_minute": "number",
      "requests_per_day": "number",
      "max_tokens_per_request": "number"
    },
    "cost_per_token": "number", // Cost in USD per token (optional)
    "health_check_interval": "number", // Override default health check interval
    "timeout": "number"         // Request timeout in milliseconds
  }
}
```

### Configuration Examples

**Text-only Provider**:
```json
{
  "textprovider": {
    "name": "textprovider",
    "type": "text",
    "enabled": true,
    "endpoint": "https://api.textprovider.com/v1/generate",
    "api_key_env": "TEXTPROVIDER_API_KEY",
    "capabilities": ["text-generation"],
    "limits": {
      "requests_per_minute": 30,
      "requests_per_day": 5000
    },
    "cost_per_token": 0.001
  }
}
```

**Chat Provider with Custom Limits**:
```json
{
  "chatprovider": {
    "name": "chatprovider", 
    "type": "chat",
    "enabled": true,
    "endpoint": "https://api.chatprovider.com/v1/chat",
    "api_key_env": "CHATPROVIDER_API_KEY",
    "capabilities": ["chat", "text-generation"],
    "limits": {
      "requests_per_minute": 100,
      "requests_per_day": 50000,
      "max_tokens_per_request": 4096
    },
    "timeout": 20000,
    "health_check_interval": 180000
  }
}
```

## Error Handling Best Practices

### 1. Standard Error Types
Map provider errors to standard error types:

```javascript
if (error.response?.status === 401) {
  throw new Error('Invalid API key');
}
if (error.response?.status === 429) {
  throw new Error('Rate limit exceeded');
}  
if (error.response?.status === 503) {
  throw new Error('Service temporarily unavailable');
}
```

### 2. Timeout Handling
Always set reasonable timeouts:

```javascript
const response = await axios.post(endpoint, data, {
  timeout: 15000 // 15 second timeout
});
```

### 3. Retry Logic
Let the RouterEngine handle retries - don't implement retry logic in providers.

### 4. Logging
Include structured logging for debugging:

```javascript
logger.error('Provider request failed', {
  provider: this.name,
  error: error.message,
  status: error.response?.status,
  endpoint: this.endpoint,
  duration: Date.now() - startTime
});
```

## Testing Your Provider

### 1. Unit Tests
Create unit tests for your provider:

```javascript
// tests/providers/AnthropicProvider.test.js
const AnthropicProvider = require('../../src/providers/AnthropicProvider');

describe('AnthropicProvider', () => {
  let provider;
  
  beforeEach(() => {
    provider = new AnthropicProvider({
      name: 'anthropic',
      endpoint: 'https://api.anthropic.com/v1/messages',
      api_key_env: 'ANTHROPIC_API_KEY'
    });
  });
  
  test('should transform OpenAI request correctly', () => {
    const openAIRequest = {
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: 'You are helpful' },
        { role: 'user', content: 'Hello' }
      ]
    };
    
    const result = provider.transformRequest(openAIRequest);
    
    expect(result.model).toBe('claude-3-sonnet-20240229');
    expect(result.system).toBe('You are helpful');
    expect(result.messages).toHaveLength(1);
  });
});
```

### 2. Integration Tests
Test with real API calls (use test API keys):

```javascript
describe('AnthropicProvider Integration', () => {
  test('should make successful API call', async () => {
    const provider = new AnthropicProvider(config);
    
    const request = {
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: 'Say hello' }]
    };
    
    const response = await provider.makeRequest(request);
    
    expect(response.choices[0].message.content).toBeTruthy();
    expect(response.usage.total_tokens).toBeGreaterThan(0);
  });
});
```

### 3. Manual Testing
Test your provider through the API:

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer ak-demo123" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-3.5-turbo",
    "messages": [{"role": "user", "content": "Test message"}]
  }'
```

## Provider Debugging

### 1. Enable Debug Logging
Set log level to debug in your environment:

```bash
LOG_LEVEL=debug npm run dev
```

### 2. Check Health Status
Monitor provider health:

```bash
curl -H "Authorization: Bearer ak-demo123" \
  http://localhost:3000/v1/health/providers
```

### 3. Review Routing Metadata
Check which providers are being selected:

```json
{
  "routing_metadata": {
    "primary_provider": "your-provider",
    "attempts": [
      {
        "provider": "your-provider",
        "status": "success",
        "duration": 1250
      }
    ]
  }
}
```

## Common Issues and Solutions

### 1. Provider Not Loading
- Check provider type is registered in RouterEngine
- Verify environment variable is set correctly
- Check for syntax errors in provider class

### 2. Authentication Errors
- Verify API key is valid and has correct permissions
- Check API key environment variable name matches config
- Ensure API key format is correct for the provider

### 3. Request Format Issues
- Compare your request format with provider documentation
- Check that required fields are included
- Validate data types match provider expectations

### 4. Response Format Issues
- Ensure response matches OpenAI format exactly
- Check that all required fields are included
- Verify token counts are accurate

### 5. Performance Issues
- Check timeout settings are appropriate
- Monitor provider response times in health checks
- Consider connection pooling for high-volume providers

## Advanced Provider Features

### 1. Streaming Support
For providers that support streaming:

```javascript
async makeRequest(openAIRequest) {
  if (openAIRequest.stream) {
    return this.handleStreamingRequest(openAIRequest);
  }
  return this.handleRegularRequest(openAIRequest);
}
```

### 2. Model-Specific Routing
Route different models to different endpoints:

```javascript
getEndpointForModel(model) {
  const modelMappings = {
    'gpt-3.5-turbo': 'https://api.provider.com/v1/chat',
    'gpt-4': 'https://api.provider.com/v1/premium-chat'
  };
  return modelMappings[model] || this.endpoint;
}
```

### 3. Custom Retry Logic
Implement provider-specific retry strategies:

```javascript
async makeRequestWithRetry(request, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      return await this.makeRequest(request);
    } catch (error) {
      if (i === retries - 1) throw error;
      if (!this.isRetryableError(error)) throw error;
      await this.delay(Math.pow(2, i) * 1000); // Exponential backoff
    }
  }
}
```

This guide should help you integrate any LLM provider into the Model Router system. The architecture is designed to be flexible and extensible while maintaining consistent behavior across all providers.