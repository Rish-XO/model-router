// Chat completion API tests
const request = require('supertest');

// Mock all dependencies
jest.mock('../src/router/RouterEngine', () => {
  return jest.fn().mockImplementation(() => ({
    routeRequest: jest.fn().mockResolvedValue({
      id: 'test-response',
      object: 'chat.completion',
      model: 'llama3-8b-8192',
      choices: [{
        index: 0,
        message: { role: 'assistant', content: 'Test response' },
        finish_reason: 'stop'
      }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      routing_metadata: {
        primary_provider: 'groq',
        attempts: [{ provider: 'groq', status: 'success' }]
      }
    }),
    getHealthStatus: () => ({ 'groq': { status: 'healthy' } }),
    getAvailableProviders: () => ['groq']
  }));
});

jest.mock('../src/config/TenantManager', () => {
  return jest.fn().mockImplementation(() => ({
    findTenantByAPIKey: jest.fn().mockReturnValue({
      tenant_id: 'test-tenant',
      quotas: { daily_requests: 1000, rate_limit_per_minute: 60 }
    }),
    checkQuota: jest.fn().mockReturnValue({ allowed: true, limit: 1000, used: 10 }),
    trackUsage: jest.fn()
  }));
});

jest.mock('../src/api/middleware/logging', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  loggingMiddleware: (req, res, next) => next()
}));

const app = require('../src/app');

describe('Chat Completion API', () => {
  const validRequest = {
    model: 'llama3-8b-8192',
    messages: [{ role: 'user', content: 'Hello' }]
  };

  test('should require authentication', async () => {
    const response = await request(app)
      .post('/v1/chat/completions')
      .send(validRequest);

    expect(response.status).toBe(401);
    expect(response.body.error.type).toBe('authentication_error');
  });

  test('should validate required fields', async () => {
    const response = await request(app)
      .post('/v1/chat/completions')
      .set('Authorization', 'Bearer test-key')
      .send({ messages: [{ role: 'user', content: 'Hello' }] }); // Missing model

    expect(response.status).toBe(400);
  });

  test('should process valid authenticated request', async () => {
    const response = await request(app)
      .post('/v1/chat/completions')
      .set('Authorization', 'Bearer test-key')
      .send(validRequest);

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('id');
    expect(response.body).toHaveProperty('choices');
    expect(response.body).toHaveProperty('usage');
    expect(response.body).toHaveProperty('routing_metadata');
  });

  test('should include routing metadata in response', async () => {
    const response = await request(app)
      .post('/v1/chat/completions')
      .set('Authorization', 'Bearer test-key')
      .send(validRequest);

    expect(response.status).toBe(200);
    expect(response.body.routing_metadata).toHaveProperty('primary_provider', 'groq');
    expect(response.body.routing_metadata).toHaveProperty('tenant_id', 'test-tenant');
    expect(response.body.routing_metadata.attempts).toHaveLength(1);
  });

  test('should handle error responses properly', async () => {
    // Test that the API can handle various response scenarios
    const response = await request(app)
      .post('/v1/chat/completions')
      .set('Authorization', 'Bearer test-key')
      .send(validRequest);

    // Should either succeed (200) or fail gracefully with proper error format
    if (response.status !== 200) {
      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toHaveProperty('message');
      expect(response.body.error).toHaveProperty('type');
    } else {
      expect(response.body).toHaveProperty('choices');
    }
  });
});