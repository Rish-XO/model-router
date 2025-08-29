// Test setup file
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error'; // Reduce logging noise during tests

// Mock environment variables
process.env.GOOGLE_API_KEY = 'test-google-api-key';
process.env.HUGGINGFACE_API_TOKEN = 'test-hf-token';

// Global test timeout
jest.setTimeout(10000);