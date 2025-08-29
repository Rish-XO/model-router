const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { loggingMiddleware } = require('./api/middleware/logging');

const app = express();

// Security & middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(loggingMiddleware);

// Routes
const chatRoutes = require('./api/routes/chat');
app.use('/v1/chat', chatRoutes);

// API routes for compatibility
app.get('/api/health', (req, res) => {
  res.redirect('/health');
});

app.get('/api/health/detailed', (req, res) => {
  res.redirect('/health/detailed');
});

// Basic health endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'model-router'
  });
});

// Enhanced health endpoint with routing status
app.get('/health/detailed', async (req, res) => {
  const startTime = Date.now();
  
  try {
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      service: 'model-router',
      version: process.env.npm_package_version || '1.0.0',
      uptime: Math.floor(process.uptime()),
      memory: {
        used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024)
      }
    };
    
    // Try to get router engine status
    try {
      const RouterEngine = require('./router/RouterEngine');
      const routerEngine = new RouterEngine();
      
      const providerHealth = routerEngine.getHealthStatus();
      const availableProviders = routerEngine.getAvailableProviders();
      
      health.routing = {
        status: 'operational',
        providers_loaded: availableProviders.length,
        available_providers: availableProviders,
        provider_health: providerHealth
      };
      
      // Check if any providers are unhealthy
      const unhealthyProviders = Object.entries(providerHealth)
        .filter(([name, status]) => status.status === 'unhealthy');
      
      if (unhealthyProviders.length > 0) {
        health.routing.status = 'degraded';
        health.routing.unhealthy_providers = unhealthyProviders.map(([name]) => name);
      }
      
    } catch (error) {
      health.routing = {
        status: 'error',
        error: error.message
      };
      health.status = 'degraded';
    }
    
    health.response_time_ms = Date.now() - startTime;
    
    const statusCode = health.status === 'healthy' ? 200 : 503;
    res.status(statusCode).json(health);
    
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      service: 'model-router',
      error: error.message,
      response_time_ms: Date.now() - startTime
    });
  }
});

module.exports = app;