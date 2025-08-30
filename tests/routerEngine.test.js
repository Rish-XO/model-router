// Minimal RouterEngine test - only basic initialization
jest.mock('../src/config/ConfigLoader');
jest.mock('../src/router/PolicyEngine');
jest.mock('../src/router/HealthMonitor');
jest.mock('../src/api/middleware/logging', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
}));

const RouterEngine = require('../src/router/RouterEngine');

describe('RouterEngine Basic Tests', () => {
  beforeEach(() => {
    const ConfigLoader = require('../src/config/ConfigLoader');
    ConfigLoader.loadProvidersSync = jest.fn(() => ({}));
    
    const PolicyEngine = require('../src/router/PolicyEngine');
    PolicyEngine.mockImplementation(() => ({}));
    
    const HealthMonitor = require('../src/router/HealthMonitor');
    HealthMonitor.mockImplementation(() => ({
      startMonitoring: jest.fn(),
      stopMonitoring: jest.fn()
    }));
  });

  test('should initialize successfully', () => {
    const router = new RouterEngine();
    expect(router).toBeDefined();
    expect(router.isInitialized).toBe(true);
  });

  test('should have required properties', () => {
    const router = new RouterEngine();
    expect(router.providers).toBeDefined();
    expect(router.circuitBreakers).toBeDefined();
  });

  test('should clean up on shutdown', () => {
    const router = new RouterEngine();
    router.shutdown();
    expect(router.isInitialized).toBe(false);
  });
});