// Circuit breaker functionality tests
jest.mock('../src/config/ConfigLoader');
jest.mock('../src/router/PolicyEngine');
jest.mock('../src/router/HealthMonitor');
jest.mock('../src/api/middleware/logging', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
}));

const RouterEngine = require('../src/router/RouterEngine');

describe('Circuit Breaker', () => {
  let routerEngine;

  beforeEach(() => {
    // Mock dependencies
    const ConfigLoader = require('../src/config/ConfigLoader');
    ConfigLoader.loadProvidersSync = jest.fn(() => ({
      'test-provider': {
        name: 'test-provider',
        type: 'groq',
        enabled: true,
        api_key_env: 'TEST_API_KEY'
      }
    }));

    const PolicyEngine = require('../src/router/PolicyEngine');
    PolicyEngine.mockImplementation(() => ({}));

    const HealthMonitor = require('../src/router/HealthMonitor');
    HealthMonitor.mockImplementation(() => ({
      startMonitoring: jest.fn(),
      stopMonitoring: jest.fn()
    }));

    process.env.TEST_API_KEY = 'test-key';
    routerEngine = new RouterEngine();
  });

  afterEach(() => {
    if (routerEngine) {
      routerEngine.shutdown();
    }
    delete process.env.TEST_API_KEY;
  });

  test('should initialize circuit breaker in closed state', () => {
    const breaker = routerEngine.circuitBreakers.get('test-provider');
    
    expect(breaker).toBeDefined();
    expect(breaker.state).toBe('closed');
    expect(breaker.failureCount).toBe(0);
    expect(breaker.threshold).toBe(5);
  });

  test('should track failures and open circuit breaker', () => {
    // Simulate failures
    for (let i = 0; i < 5; i++) {
      routerEngine.recordCircuitBreakerFailure('test-provider');
    }

    const breaker = routerEngine.circuitBreakers.get('test-provider');
    expect(breaker.state).toBe('open');
    expect(breaker.failureCount).toBe(5);
    expect(routerEngine.isProviderAvailable('test-provider')).toBe(false);
  });

  test('should reset circuit breaker on success', () => {
    // First, open the circuit breaker
    for (let i = 0; i < 5; i++) {
      routerEngine.recordCircuitBreakerFailure('test-provider');
    }

    // Set to half-open and then record success
    const breaker = routerEngine.circuitBreakers.get('test-provider');
    breaker.state = 'half-open';
    
    routerEngine.recordCircuitBreakerSuccess('test-provider');

    expect(breaker.state).toBe('closed');
    expect(breaker.failureCount).toBe(0);
  });

  test('should return provider availability correctly', () => {
    expect(routerEngine.isProviderAvailable('test-provider')).toBe(true);

    // Open circuit breaker
    for (let i = 0; i < 5; i++) {
      routerEngine.recordCircuitBreakerFailure('test-provider');
    }

    expect(routerEngine.isProviderAvailable('test-provider')).toBe(false);
  });

  test('should get circuit breaker status', () => {
    const status = routerEngine.getCircuitBreakerStatus();
    
    expect(status).toHaveProperty('test-provider');
    expect(status['test-provider']).toHaveProperty('state', 'closed');
    expect(status['test-provider']).toHaveProperty('failureCount', 0);
  });

  test('should transition to half-open after timeout', (done) => {
    // Open circuit breaker
    for (let i = 0; i < 5; i++) {
      routerEngine.recordCircuitBreakerFailure('test-provider');
    }

    const breaker = routerEngine.circuitBreakers.get('test-provider');
    
    // Set a very short timeout for testing
    breaker.timeout = 10;
    breaker.nextAttemptTime = Date.now() + 10;

    setTimeout(() => {
      expect(routerEngine.isProviderAvailable('test-provider')).toBe(true);
      expect(breaker.state).toBe('half-open');
      done();
    }, 20);
  });
});