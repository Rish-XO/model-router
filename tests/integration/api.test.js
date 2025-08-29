const request = require('supertest');
const app = require('../../src/app');

// Mock RouterEngine to avoid real provider calls
jest.mock('../../src/router/RouterEngine', () => {
  return jest.fn().mockImplementation(() => ({
    isInitialized: true,
    routeRequest: jest.fn().mockResolvedValue({
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: 'gpt-4',
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: 'This is a mock response from the RouterEngine.'
        },
        finish_reason: 'stop'
      }],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 15,
        total_tokens: 25
      },
      routing_metadata: {
        primary_provider: 'google-gemini',
        attempts: [{ provider: 'google-gemini', status: 'success', duration: 100 }],
        total_processing_time: 100,
        policy_used: 'intelligent_routing',
        api_processing_time: 50,
        timestamp: new Date().toISOString(),
        tenant_id: 'default'
      }
    }),
    getHealthStatus: jest.fn().mockReturnValue({
      'google-gemini': { status: 'healthy', uptime: 0.95 },
      'hugging-face': { status: 'healthy', uptime: 0.90 }
    }),
    getAvailableProviders: jest.fn().mockReturnValue(['google-gemini', 'hugging-face']),
    shutdown: jest.fn()
  }));
});

// Mock TenantManager
jest.mock('../../src/config/TenantManager', () => {
  return jest.fn().mockImplementation(() => ({
    findTenantByAPIKey: jest.fn().mockImplementation((apiKey) => {
      const tenants = {
        'ak-demo123': {
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
        },
        'sk-ent-12345678901234567890123456789012': {
          tenant_id: 'enterprise',
          api_keys: ['sk-ent-12345678901234567890123456789012'],
          providers: {
            enabled: ['google-gemini', 'hugging-face'],
            routing_policy: 'performance_first'
          },
          quotas: {
            daily_requests: 10000,
            rate_limit_per_minute: 500
          }
        }
      };
      return tenants[apiKey] || null;
    }),
    
    checkQuota: jest.fn().mockReturnValue({
      allowed: true,
      remaining: 950,
      limit: 1000,
      used: 50
    }),
    
    trackUsage: jest.fn(),
    
    getUsage: jest.fn().mockReturnValue({
      daily_requests: 50,
      monthly_requests: 1500,
      total_tokens: 25000,
      estimated_cost: 50.0
    })
  }));
});

// Mock MetricsCollector 
jest.mock('../../src/monitoring/MetricsCollector', () => ({
  getMetrics: jest.fn().mockResolvedValue('# Mock Prometheus metrics\nhttp_requests_total 100\n'),
  getMetricsAsJSON: jest.fn().mockResolvedValue([
    { name: 'http_requests_total', value: 100 },
    { name: 'provider_requests_total', value: 50 }
  ])
}));

describe('Chat API Integration Tests', () => {
  const validAPIKey = 'ak-demo123';
  const enterpriseAPIKey = 'sk-ent-12345678901234567890123456789012';
  
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
      expect(response.body).toHaveProperty('routing_metadata');
      expect(response.body.routing_metadata).toHaveProperty('primary_provider');
    });
    
    test('should accept enterprise API key', async () => {
      const response = await request(app)
        .post('/v1/chat/completions')
        .set('Authorization', `Bearer ${enterpriseAPIKey}`)
        .send({
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'Hello, enterprise!' }]
        });
      
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('id');
      expect(response.body).toHaveProperty('routing_metadata');
    });
    
    test('should reject invalid API key', async () => {
      const response = await request(app)
        .post('/v1/chat/completions')
        .set('Authorization', 'Bearer invalid-key-12345')
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
    
    test('should reject malformed authorization header', async () => {
      const response = await request(app)
        .post('/v1/chat/completions')
        .set('Authorization', 'InvalidFormat ak-demo123')
        .send({
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'Hello' }]
        });
      
      expect(response.status).toBe(401);
      expect(response.body.error.type).toBe('authentication_error');
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
      expect(response.body.error.message).toContain('messages');
    });
    
    test('should reject request with empty messages array', async () => {
      const response = await request(app)
        .post('/v1/chat/completions')
        .set('Authorization', `Bearer ${validAPIKey}`)
        .send({
          model: 'gpt-4',
          messages: []
        });
      
      expect(response.status).toBe(400);
      expect(response.body.error.type).toBe('validation_error');
    });
    
    test('should reject request without model', async () => {
      const response = await request(app)
        .post('/v1/chat/completions')
        .set('Authorization', `Bearer ${validAPIKey}`)
        .send({
          messages: [{ role: 'user', content: 'Hello' }]
        });
      
      expect(response.status).toBe(400);
      expect(response.body.error.type).toBe('validation_error');
      expect(response.body.error.message).toContain('model');
    });
    
    test('should reject invalid message format', async () => {
      const response = await request(app)
        .post('/v1/chat/completions')
        .set('Authorization', `Bearer ${validAPIKey}`)
        .send({
          model: 'gpt-4',
          messages: [{ role: 'invalid_role', content: 'Hello' }]
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
          messages: [{ role: 'user', content: 'Test with options' }],
          temperature: 0.7,
          max_tokens: 150,
          top_p: 0.9
        });
      
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('choices');
      expect(response.body.choices[0].message.content).toContain('mock response');
    });
    
    test('should reject invalid temperature', async () => {
      const response = await request(app)
        .post('/v1/chat/completions')
        .set('Authorization', `Bearer ${validAPIKey}`)
        .send({
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'Hello' }],
          temperature: 5.0 // Invalid: > 2.0
        });
      
      expect(response.status).toBe(400);
      expect(response.body.error.type).toBe('validation_error');
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
      expect(response.body.routing.status).toBe('operational');
    });
    
    test('should handle /api/health redirect', async () => {
      const response = await request(app)
        .get('/api/health');
      
      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/health');
    });
    
    test('should handle /api/health/detailed redirect', async () => {
      const response = await request(app)
        .get('/api/health/detailed');
      
      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/health/detailed');
    });
  });
  
  describe('Metrics Endpoints', () => {
    test('should return Prometheus metrics', async () => {
      const response = await request(app)
        .get('/metrics');
      
      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toBe('text/plain; charset=utf-8');
      expect(response.text).toContain('http_requests_total');
    });
    
    test('should return JSON metrics', async () => {
      const response = await request(app)
        .get('/metrics/json');
      
      expect(response.status).toBe(200);
      expect(response.body).toBeInstanceOf(Array);
      expect(response.body.length).toBeGreaterThan(0);
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
      
      // Check required OpenAI fields
      expect(response.body).toHaveProperty('id');
      expect(response.body).toHaveProperty('object', 'chat.completion');
      expect(response.body).toHaveProperty('created');
      expect(response.body).toHaveProperty('model', 'gpt-4');
      expect(response.body).toHaveProperty('choices');
      expect(response.body).toHaveProperty('usage');
      
      // Check choices structure
      expect(response.body.choices).toBeInstanceOf(Array);
      expect(response.body.choices).toHaveLength(1);
      expect(response.body.choices[0]).toHaveProperty('index', 0);
      expect(response.body.choices[0]).toHaveProperty('message');
      expect(response.body.choices[0]).toHaveProperty('finish_reason', 'stop');
      expect(response.body.choices[0].message).toHaveProperty('role', 'assistant');
      expect(response.body.choices[0].message).toHaveProperty('content');
      
      // Check usage structure
      expect(response.body.usage).toHaveProperty('prompt_tokens');
      expect(response.body.usage).toHaveProperty('completion_tokens');
      expect(response.body.usage).toHaveProperty('total_tokens');
      
      // Check routing metadata (custom extension)
      expect(response.body).toHaveProperty('routing_metadata');
      expect(response.body.routing_metadata).toHaveProperty('primary_provider');
      expect(response.body.routing_metadata).toHaveProperty('attempts');
      expect(response.body.routing_metadata).toHaveProperty('api_processing_time');
      expect(response.body.routing_metadata).toHaveProperty('tenant_id');
    });
  });
  
  describe('Error Handling', () => {
    test('should handle large payloads gracefully', async () => {
      const largeContent = 'A'.repeat(50000); // 50KB content
      
      const response = await request(app)
        .post('/v1/chat/completions')
        .set('Authorization', `Bearer ${validAPIKey}`)
        .send({
          model: 'gpt-4',
          messages: [{ role: 'user', content: largeContent }]
        });
      
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('choices');
    });
    
    test('should handle malformed JSON', async () => {
      const response = await request(app)
        .post('/v1/chat/completions')
        .set('Authorization', `Bearer ${validAPIKey}`)
        .set('Content-Type', 'application/json')
        .send('{ "model": "gpt-4", "messages": [ invalid json }');
      
      expect(response.status).toBe(400);
    });
    
    test('should handle unsupported HTTP methods', async () => {
      const response = await request(app)
        .put('/v1/chat/completions')
        .set('Authorization', `Bearer ${validAPIKey}`)
        .send({
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'Hello' }]
        });
      
      expect(response.status).toBe(404);
    });
  });
  
  describe('Rate Limiting', () => {
    test('should handle requests within rate limit', async () => {
      // Make several requests that should all succeed
      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(
          request(app)
            .post('/v1/chat/completions')
            .set('Authorization', `Bearer ${validAPIKey}`)
            .send({
              model: 'gpt-4',
              messages: [{ role: 'user', content: `Message ${i}` }]
            })
        );
      }
      
      const responses = await Promise.all(promises);
      
      // All should succeed since we're under the limit
      responses.forEach(response => {
        expect(response.status).toBe(200);
      });
    });
  });
});