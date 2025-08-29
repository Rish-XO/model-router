const RouterEngine = require('../../src/router/RouterEngine');

// Mock all dependencies before importing RouterEngine
jest.mock('../../src/router/PolicyEngine', () => {
  return jest.fn().mockImplementation(() => ({
    selectProviders: jest.fn().mockReturnValue(['google-gemini', 'hugging-face'])
  }));
});

jest.mock('../../src/router/HealthMonitor', () => {
  return jest.fn().mockImplementation(() => ({
    startMonitoring: jest.fn(),
    stopMonitoring: jest.fn(),
    getProviderHealth: jest.fn().mockReturnValue({
      'google-gemini': { status: 'healthy', uptime: 0.95, avg_latency: 200 },
      'hugging-face': { status: 'healthy', uptime: 0.90, avg_latency: 300 }
    }),
    getProviderHealthSummary: jest.fn().mockReturnValue({
      'google-gemini': { status: 'healthy' },
      'hugging-face': { status: 'healthy' }
    })
  }));
});

jest.mock('../../src/config/ConfigLoader', () => ({
  loadProvidersSync: jest.fn().mockReturnValue({
    'google-gemini': {
      name: 'google-gemini',
      type: 'google',
      enabled: true,
      endpoint: 'https://api.google.com/test',
      api_key_env: 'GOOGLE_API_KEY'
    },
    'hugging-face': {
      name: 'hugging-face',
      type: 'huggingface',
      enabled: true,
      endpoint: 'https://api.huggingface.co/test',
      api_key_env: 'HUGGINGFACE_API_TOKEN'
    }
  }),
  loadTenantSync: jest.fn().mockReturnValue({
    tenant_id: 'default',
    providers: {
      enabled: ['google-gemini', 'hugging-face'],
      routing_policy: 'balanced'
    }
  })
}));

jest.mock('../../src/providers/GoogleProvider', () => {
  return jest.fn().mockImplementation((config) => ({
    name: config.name,
    makeRequest: jest.fn().mockResolvedValue({
      id: 'test-response',
      choices: [{ message: { content: 'Test response' } }],
      usage: { total_tokens: 25 }
    })
  }));
});

jest.mock('../../src/providers/HuggingFaceProvider', () => {
  return jest.fn().mockImplementation((config) => ({
    name: config.name,
    makeRequest: jest.fn().mockResolvedValue({
      id: 'test-response',
      choices: [{ message: { content: 'Test response' } }],
      usage: { total_tokens: 25 }
    })
  }));
});

jest.mock('../../src/api/middleware/logging', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
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
      expect(routerEngine.policyEngine).toBeDefined();
      expect(routerEngine.healthMonitor).toBeDefined();
      expect(routerEngine.providers).toBeInstanceOf(Map);
      expect(routerEngine.circuitBreakers).toBeInstanceOf(Map);
      expect(routerEngine.isInitialized).toBe(true);
    });
    
    test('should load providers during initialization', () => {
      expect(routerEngine.providers.size).toBe(2);
      expect(routerEngine.circuitBreakers.size).toBe(2);
      expect(routerEngine.providers.has('google-gemini')).toBe(true);
      expect(routerEngine.providers.has('hugging-face')).toBe(true);
    });
    
    test('should start health monitoring', () => {
      expect(routerEngine.healthMonitor.startMonitoring).toHaveBeenCalled();
    });
  });
  
  describe('provider management', () => {
    test('should get available providers', () => {
      const available = routerEngine.getAvailableProviders();
      expect(available).toContain('google-gemini');
      expect(available).toContain('hugging-face');
      expect(available.length).toBe(2);
    });
    
    test('should get provider class correctly', () => {
      const GoogleProvider = routerEngine.getProviderClass('google');
      const HuggingFaceProvider = routerEngine.getProviderClass('huggingface');
      
      expect(GoogleProvider).toBeDefined();
      expect(HuggingFaceProvider).toBeDefined();
    });
  });
  
  describe('circuit breaker', () => {
    test('should initialize circuit breakers for all providers', () => {
      const breaker = routerEngine.circuitBreakers.get('google-gemini');
      expect(breaker).toEqual({
        state: 'closed',
        failureCount: 0,
        lastFailureTime: null,
        nextAttemptTime: null,
        threshold: 5,
        timeout: 60000
      });
    });
    
    test('should track provider failures and open circuit', () => {
      const providerName = 'google-gemini';
      
      // Record 5 failures to trigger circuit breaker
      for (let i = 0; i < 5; i++) {
        routerEngine.recordCircuitBreakerFailure(providerName);
      }
      
      const breaker = routerEngine.circuitBreakers.get(providerName);
      expect(breaker.state).toBe('open');
      expect(breaker.failureCount).toBe(5);
      expect(breaker.nextAttemptTime).toBeGreaterThan(Date.now());
    });
    
    test('should reset circuit breaker on success', () => {
      const providerName = 'google-gemini';
      
      // First, open the circuit breaker
      for (let i = 0; i < 5; i++) {
        routerEngine.recordCircuitBreakerFailure(providerName);
      }
      
      // Set to half-open and then record success
      const breaker = routerEngine.circuitBreakers.get(providerName);
      breaker.state = 'half-open';
      
      routerEngine.recordCircuitBreakerSuccess(providerName);
      
      expect(breaker.state).toBe('closed');
      expect(breaker.failureCount).toBe(0);
      expect(breaker.lastFailureTime).toBe(null);
    });
    
    test('should check provider availability based on circuit breaker state', () => {
      const providerName = 'google-gemini';
      
      // Closed circuit should be available
      expect(routerEngine.isProviderAvailable(providerName)).toBe(true);
      
      // Open circuit with future retry time should not be available
      const breaker = routerEngine.circuitBreakers.get(providerName);
      breaker.state = 'open';
      breaker.nextAttemptTime = Date.now() + 60000;
      
      expect(routerEngine.isProviderAvailable(providerName)).toBe(false);
      
      // Open circuit with past retry time should transition to half-open
      breaker.nextAttemptTime = Date.now() - 1000;
      expect(routerEngine.isProviderAvailable(providerName)).toBe(true);
      expect(breaker.state).toBe('half-open');
    });
    
    test('should get circuit breaker status', () => {
      const status = routerEngine.getCircuitBreakerStatus();
      
      expect(status).toHaveProperty('google-gemini');
      expect(status).toHaveProperty('hugging-face');
      expect(status['google-gemini']).toHaveProperty('state', 'closed');
      expect(status['google-gemini']).toHaveProperty('failureCount', 0);
    });
  });
  
  describe('request routing', () => {
    test('should route request successfully', async () => {
      const request = {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }]
      };
      
      const tenant = {
        tenant_id: 'test',
        providers: {
          enabled: ['google-gemini'],
          routing_policy: 'balanced'
        }
      };
      
      const response = await routerEngine.routeRequest(request, tenant);
      
      expect(response).toHaveProperty('id');
      expect(response).toHaveProperty('routing_metadata');
      expect(response.routing_metadata).toHaveProperty('primary_provider');
    });
    
    test('should throw error when not initialized', async () => {
      routerEngine.isInitialized = false;
      
      const request = {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }]
      };
      
      await expect(routerEngine.routeRequest(request, null))
        .rejects
        .toThrow('RouterEngine not initialized');
    });
    
    test('should execute request with timeout', async () => {
      const mockProvider = {
        makeRequest: jest.fn().mockResolvedValue({
          id: 'test',
          choices: [{ message: { content: 'Response' } }]
        })
      };
      
      const request = {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Test' }]
      };
      
      const response = await routerEngine.executeWithTimeout(mockProvider, request, 5000);
      
      expect(response).toHaveProperty('id', 'test');
      expect(mockProvider.makeRequest).toHaveBeenCalledWith(request);
    });
    
    test('should timeout on slow providers', async () => {
      const slowProvider = {
        makeRequest: jest.fn().mockImplementation(() => 
          new Promise(resolve => setTimeout(resolve, 2000))
        )
      };
      
      const request = {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Test' }]
      };
      
      await expect(
        routerEngine.executeWithTimeout(slowProvider, request, 100)
      ).rejects.toThrow('Request timeout after 100ms');
    });
  });
  
  describe('health status', () => {
    test('should get health status from health monitor', () => {
      const status = routerEngine.getHealthStatus();
      
      expect(status).toEqual({
        'google-gemini': { status: 'healthy' },
        'hugging-face': { status: 'healthy' }
      });
    });
  });
  
  describe('shutdown', () => {
    test('should clean up resources on shutdown', () => {
      const initialProviders = routerEngine.providers.size;
      const initialBreakers = routerEngine.circuitBreakers.size;
      
      expect(initialProviders).toBeGreaterThan(0);
      expect(initialBreakers).toBeGreaterThan(0);
      
      routerEngine.shutdown();
      
      expect(routerEngine.providers.size).toBe(0);
      expect(routerEngine.circuitBreakers.size).toBe(0);
      expect(routerEngine.isInitialized).toBe(false);
      expect(routerEngine.healthMonitor.stopMonitoring).toHaveBeenCalled();
    });
  });
});