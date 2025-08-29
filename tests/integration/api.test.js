const request = require('supertest');
const app = require('../../src/app');

// Mock the TenantManager to avoid file system dependencies
jest.mock('../../src/config/TenantManager', () => {
  class MockTenantManager {
    constructor() {
      this.tenantCache = new Map();
      this.usageData = new Map();
      
      // Add test tenants
      this.tenantCache.set('default', {
        tenant_id: 'default',
        api_keys: ['ak-demo123'],
        providers: {
          enabled: ['google-gemini', 'hugging-face'],
          routing_policy: 'balanced'
        },
        quotas: {
          daily_requests: 1000,
          rate_limit_per_minute: 60
        }
      });
      
      this.tenantCache.set('test-limited', {
        tenant_id: 'test-limited',
        api_keys: ['ak-limited'],
        providers: {
          enabled: ['google-gemini'],
          routing_policy: 'cost_optimized'
        },
        quotas: {
          daily_requests: 5,
          rate_limit_per_minute: 2
        }
      });
    }
    
    findTenantByAPIKey(apiKey) {
      for (const [tenantId, tenant] of this.tenantCache) {
        if (tenant.api_keys && tenant.api_keys.includes(apiKey)) {
          return tenant;
        }
      }
      return null;
    }
    
    checkQuota(tenantId, quotaType) {
      const tenant = this.tenantCache.get(tenantId);
      if (!tenant || !tenant.quotas) {
        return { allowed: true, remaining: Infinity, limit: Infinity };
      }
      
      const usage = this.getUsage(tenantId);
      const limit = tenant.quotas[quotaType] || 1000;
      const used = usage[quotaType] || 0;
      const remaining = Math.max(0, limit - used);
      
      return {
        allowed: remaining > 0,
        remaining: remaining,
        limit: limit,
        used: used
      };
    }
    
    trackUsage(tenantId, usage) {
      if (!this.usageData.has(tenantId)) {
        this.usageData.set(tenantId, {
          daily_requests: 0,
          monthly_requests: 0,
          total_tokens: 0,
          estimated_cost: 0
        });
      }
      
      const tenantUsage = this.usageData.get(tenantId);
      tenantUsage.daily_requests += 1;
      tenantUsage.total_tokens += usage.total_tokens || 0;
    }
    
    getUsage(tenantId) {
      return this.usageData.get(tenantId) || {
        daily_requests: 0,
        monthly_requests: 0,
        total_tokens: 0,
        estimated_cost: 0
      };
    }
  }
  
  return MockTenantManager;
});

// Mock RouterEngine to avoid provider initialization
jest.mock('../../src/router/RouterEngine', () => {
  return jest.fn().mockImplementation(() => ({
    isInitialized: true,
    routeRequest: jest.fn().mockResolvedValue({
      id: 'mock-response-id',
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: 'gpt-4',
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: 'Mock response from RouterEngine'
        },
        finish_reason: 'stop'
      }],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 15,
        total_tokens: 25
      },
      routing_metadata: {
        primary_provider: 'mock-provider',
        attempts: [{ provider: 'mock-provider', status: 'success', duration: 100 }],
        total_processing_time: 100,
        policy_used: 'intelligent_routing'
      }
    }),
    getHealthStatus: jest.fn().mockReturnValue({
      'mock-provider': { status: 'healthy', uptime: 1000 }
    }),
    getAvailableProviders: jest.fn().mockReturnValue(['mock-provider']),
    shutdown: jest.fn()
  }));
});

describe('Chat API Integration Tests', () => {
  const validAPIKey = 'ak-demo123';
  
  describe('Authentication', () => {
    test('should accept valid API key', async () => {
      const response = await request(app)
        .post('/v1/chat/completions')
        .set('Authorization', `Bearer ${validAPIKey}`)
        .send({
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'Hello, test!' }]
        });
      
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('id');
      expect(response.body).toHaveProperty('choices');
      expect(response.body.choices[0]).toHaveProperty('message');
    });
    
    test('should reject invalid API key', async () => {
      const response = await request(app)
        .post('/v1/chat/completions')
        .set('Authorization', 'Bearer invalid-key')
        .send({
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'Hello' }]
        });
      
      expect(response.status).toBe(401);
      expect(response.body.error.type).toBe('authentication_error');
      expect(response.body.error.message).toContain('Invalid API key');
    });
    
    test('should reject missing authorization header', async () => {
      const response = await request(app)
        .post('/v1/chat/completions')
        .send({
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'Hello' }]
        });
      
      expect(response.status).toBe(401);
      expect(response.body.error.type).toBe('authentication_error');
      expect(response.body.error.message).toContain('Missing or invalid authorization header');
    });
  });
  
  describe('Request Validation', () => {
    test('should reject request without messages', async () => {
      const response = await request(app)
        .post('/v1/chat/completions')
        .set('Authorization', `Bearer ${validAPIKey}`)
        .send({
          model: 'gpt-4'
        });
      
      expect(response.status).toBe(400);
      expect(response.body.error.type).toBe('validation_error');
    });
    
    test('should reject request with invalid message format', async () => {
      const response = await request(app)
        .post('/v1/chat/completions')
        .set('Authorization', `Bearer ${validAPIKey}`)
        .send({
          model: 'gpt-4',
          messages: 'invalid format'
        });
      
      expect(response.status).toBe(400);
      expect(response.body.error.type).toBe('validation_error');
    });
    
    test('should accept request with optional parameters', async () => {
      const response = await request(app)
        .post('/v1/chat/completions')
        .set('Authorization', `Bearer ${validAPIKey}`)
        .send({
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'Test' }],
          temperature: 0.7,
          max_tokens: 100,
          stream: false
        });
      
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('choices');
    });
  });
  
  describe('Health Endpoints', () => {
    test('should return basic health status', async () => {
      const response = await request(app)
        .get('/health');
      
      expect(response.status).toBe(200);
      expect(response.body.status).toBe('healthy');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body.service).toBe('model-router');
    });
    
    test('should return detailed health status', async () => {
      const response = await request(app)
        .get('/health/detailed');
      
      expect(response.status).toBe(200);
      expect(response.body.status).toBe('healthy');
      expect(response.body).toHaveProperty('memory');
      expect(response.body).toHaveProperty('uptime');
      expect(response.body).toHaveProperty('routing');
    });
    
    test('should handle /api/health redirect', async () => {
      const response = await request(app)
        .get('/api/health');
      
      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/health');
    });
  });
  
  describe('Response Format', () => {
    test('should return OpenAI-compatible response format', async () => {
      const response = await request(app)
        .post('/v1/chat/completions')
        .set('Authorization', `Bearer ${validAPIKey}`)
        .send({
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'Test message' }]
        });
      
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('id');
      expect(response.body).toHaveProperty('object', 'chat.completion');
      expect(response.body).toHaveProperty('created');
      expect(response.body).toHaveProperty('model');
      expect(response.body).toHaveProperty('choices');
      expect(response.body).toHaveProperty('usage');
      
      // Check choices structure
      expect(response.body.choices).toBeInstanceOf(Array);
      expect(response.body.choices[0]).toHaveProperty('index');
      expect(response.body.choices[0]).toHaveProperty('message');
      expect(response.body.choices[0]).toHaveProperty('finish_reason');
      
      // Check usage structure
      expect(response.body.usage).toHaveProperty('prompt_tokens');
      expect(response.body.usage).toHaveProperty('completion_tokens');
      expect(response.body.usage).toHaveProperty('total_tokens');
      
      // Check routing metadata
      expect(response.body).toHaveProperty('routing_metadata');
      expect(response.body.routing_metadata).toHaveProperty('primary_provider');
      expect(response.body.routing_metadata).toHaveProperty('attempts');
    });
  });
});