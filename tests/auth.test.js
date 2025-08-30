// Authentication middleware tests
const authMiddleware = require('../src/api/middleware/auth');

// Mock TenantManager
jest.mock('../src/config/TenantManager', () => {
  return jest.fn().mockImplementation(() => ({
    findTenantByAPIKey: jest.fn((apiKey) => {
      if (apiKey === 'valid-key') {
        return {
          tenant_id: 'test-tenant',
          api_keys: ['valid-key'],
          quotas: { daily_requests: 1000 }
        };
      }
      return null;
    })
  }));
});

jest.mock('../src/api/middleware/logging', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
}));

describe('Authentication Middleware', () => {
  let mockReq, mockRes, mockNext;

  beforeEach(() => {
    mockReq = { headers: {} };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };
    mockNext = jest.fn();
    jest.clearAllMocks();
  });

  test('should reject request without authorization header', async () => {
    await authMiddleware.authenticateAPIKey(mockReq, mockRes, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(401);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: {
        message: 'Missing or invalid authorization header',
        type: 'authentication_error'
      }
    });
    expect(mockNext).not.toHaveBeenCalled();
  });

  test('should reject request with invalid authorization format', async () => {
    mockReq.headers.authorization = 'InvalidFormat test';

    await authMiddleware.authenticateAPIKey(mockReq, mockRes, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(401);
    expect(mockNext).not.toHaveBeenCalled();
  });

  test('should reject request with invalid API key', async () => {
    mockReq.headers.authorization = 'Bearer invalid-key';

    await authMiddleware.authenticateAPIKey(mockReq, mockRes, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(401);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: {
        message: 'Invalid API key',
        type: 'authentication_error'
      }
    });
    expect(mockNext).not.toHaveBeenCalled();
  });

  test('should accept request with valid API key', async () => {
    mockReq.headers.authorization = 'Bearer valid-key';

    await authMiddleware.authenticateAPIKey(mockReq, mockRes, mockNext);

    expect(mockReq.tenant).toEqual({
      tenant_id: 'test-tenant',
      api_keys: ['valid-key'],
      quotas: { daily_requests: 1000 }
    });
    expect(mockNext).toHaveBeenCalled();
    expect(mockRes.status).not.toHaveBeenCalled();
  });
});