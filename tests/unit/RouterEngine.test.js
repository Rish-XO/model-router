const RouterEngine = require('../../src/router/RouterEngine');
const PolicyEngine = require('../../src/router/PolicyEngine');
const HealthMonitor = require('../../src/router/HealthMonitor');
const { MockGoogleProvider, MockHuggingFaceProvider } = require('../mocks/mockProviders');

// Mock dependencies
jest.mock('../../src/router/HealthMonitor');
jest.mock('../../src/config/ConfigLoader');
jest.mock('../../src/api/middleware/logging', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn()
  }
}));

describe('RouterEngine', () => {
  let routerEngine;
  
  beforeEach(() => {
    jest.clearAllMocks();
    routerEngine = new RouterEngine();
  });
  
  afterEach(() => {
    if (routerEngine) {
      routerEngine.shutdown();
    }
  });
  
  describe('initialization', () => {
    test('should initialize with required components', () => {
      expect(routerEngine.policyEngine).toBeInstanceOf(PolicyEngine);
      expect(routerEngine.healthMonitor).toBeDefined();
      expect(routerEngine.providers).toBeInstanceOf(Map);
      expect(routerEngine.circuitBreakers).toBeInstanceOf(Map);
      expect(routerEngine.isInitialized).toBe(true);
    });
  });
  
  describe('provider management', () => {
    test('should load providers correctly', () => {
      const ConfigLoader = require('../../src/config/ConfigLoader');
      ConfigLoader.loadProviders = jest.fn().mockReturnValue({
        'google-gemini': {
          name: 'google-gemini',
          type: 'google',
          enabled: true
        },
        'hugging-face': {
          name: 'hugging-face',
          type: 'huggingface',
          enabled: true
        }
      });
      
      routerEngine.loadProviders();
      
      expect(routerEngine.providers.size).toBeGreaterThan(0);
      expect(routerEngine.circuitBreakers.size).toBeGreaterThan(0);
    });
    
    test('should get available providers', () => {
      routerEngine.providers.set('provider1', new MockGoogleProvider());
      routerEngine.providers.set('provider2', new MockHuggingFaceProvider());
      
      const available = routerEngine.getAvailableProviders();
      expect(available).toContain('provider1');
      expect(available).toContain('provider2');
    });
  });
  
  describe('circuit breaker', () => {
    test('should track provider failures', () => {
      const providerName = 'test-provider';
      routerEngine.circuitBreakers.set(providerName, {
        state: 'closed',
        failureCount: 0,
        lastFailureTime: null,
        nextAttemptTime: null,
        threshold: 5,
        timeout: 60000
      });
      
      // Record failures
      for (let i = 0; i < 5; i++) {
        routerEngine.recordCircuitBreakerFailure(providerName);
      }
      
      const breaker = routerEngine.circuitBreakers.get(providerName);
      expect(breaker.state).toBe('open');
      expect(breaker.failureCount).toBe(5);
    });
    
    test('should reset circuit breaker on success', () => {
      const providerName = 'test-provider';
      routerEngine.circuitBreakers.set(providerName, {
        state: 'half-open',
        failureCount: 3,
        lastFailureTime: Date.now(),
        nextAttemptTime: null,
        threshold: 5,
        timeout: 60000
      });
      
      routerEngine.recordCircuitBreakerSuccess(providerName);
      
      const breaker = routerEngine.circuitBreakers.get(providerName);
      expect(breaker.state).toBe('closed');
      expect(breaker.failureCount).toBe(0);
    });
    
    test('should check provider availability based on circuit breaker', () => {
      const providerName = 'test-provider';
      
      // Provider without circuit breaker should be available
      expect(routerEngine.isProviderAvailable('unknown-provider')).toBe(true);
      
      // Closed circuit should be available
      routerEngine.circuitBreakers.set(providerName, {
        state: 'closed',
        failureCount: 0,
        lastFailureTime: null,
        nextAttemptTime: null,
        threshold: 5,
        timeout: 60000
      });
      expect(routerEngine.isProviderAvailable(providerName)).toBe(true);
      
      // Open circuit with future retry time should not be available
      routerEngine.circuitBreakers.set(providerName, {
        state: 'open',
        failureCount: 5,
        lastFailureTime: Date.now(),
        nextAttemptTime: Date.now() + 60000,
        threshold: 5,
        timeout: 60000
      });
      expect(routerEngine.isProviderAvailable(providerName)).toBe(false);
      
      // Open circuit with past retry time should transition to half-open
      routerEngine.circuitBreakers.set(providerName, {
        state: 'open',
        failureCount: 5,
        lastFailureTime: Date.now() - 120000,
        nextAttemptTime: Date.now() - 60000,
        threshold: 5,
        timeout: 60000
      });
      expect(routerEngine.isProviderAvailable(providerName)).toBe(true);
    });
  });
  
  describe('request routing', () => {
    test('should execute request with timeout', async () => {
      const mockProvider = new MockGoogleProvider({ latency: 50 });
      const request = {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Test' }]
      };
      
      const response = await routerEngine.executeWithTimeout(mockProvider, request, 1000);
      
      expect(response).toHaveProperty('id');
      expect(response).toHaveProperty('choices');
      expect(response.choices[0].message.content).toContain('Mock response');
    });
    
    test('should timeout on slow providers', async () => {
      const mockProvider = new MockGoogleProvider({ latency: 2000 });
      const request = {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Test' }]
      };
      
      await expect(
        routerEngine.executeWithTimeout(mockProvider, request, 100)
      ).rejects.toThrow('Request timeout');
    });
  });
  
  describe('health status', () => {
    test('should get circuit breaker status', () => {
      routerEngine.circuitBreakers.set('provider1', {
        state: 'closed',
        failureCount: 0,
        lastFailureTime: null,
        nextAttemptTime: null,
        threshold: 5,
        timeout: 60000
      });
      
      routerEngine.circuitBreakers.set('provider2', {
        state: 'open',
        failureCount: 5,
        lastFailureTime: Date.now(),
        nextAttemptTime: Date.now() + 60000,
        threshold: 5,
        timeout: 60000
      });
      
      const status = routerEngine.getCircuitBreakerStatus();
      
      expect(status.provider1.state).toBe('closed');
      expect(status.provider2.state).toBe('open');
      expect(status.provider2.failureCount).toBe(5);
    });
  });
  
  describe('shutdown', () => {
    test('should clean up resources on shutdown', () => {
      routerEngine.providers.set('test', new MockGoogleProvider());
      routerEngine.circuitBreakers.set('test', {});
      
      routerEngine.shutdown();
      
      expect(routerEngine.providers.size).toBe(0);
      expect(routerEngine.circuitBreakers.size).toBe(0);
      expect(routerEngine.isInitialized).toBe(false);
    });
  });
});