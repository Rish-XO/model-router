const { logger } = require('../api/middleware/logging');

class HealthMonitor {
  constructor() {
    this.healthData = {};
    this.healthCheckInterval = null;
    this.isMonitoring = false;
  }
  
  startMonitoring() {
    if (this.isMonitoring) {
      logger.warn('Health monitoring already started');
      return;
    }
    
    // Check health every 5 minutes (to respect rate limits)
    this.healthCheckInterval = setInterval(() => {
      this.checkAllProviders();
    }, parseInt(process.env.HEALTH_CHECK_INTERVAL) || 300000); // 5 minutes
    
    this.isMonitoring = true;
    logger.info('Health monitoring started');
    
    // Run initial health check
    setTimeout(() => this.checkAllProviders(), 1000);
  }
  
  stopMonitoring() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    this.isMonitoring = false;
    logger.info('Health monitoring stopped');
  }
  
  async checkAllProviders() {
    const ConfigLoader = require('../config/ConfigLoader');
    
    try {
      // Load all provider configurations
      const allProviders = ConfigLoader.loadProviders();
      
      for (const [name, config] of Object.entries(allProviders)) {
        if (config.enabled !== false) { // Check if provider is not explicitly disabled
          await this.checkProvider(name, config);
        }
      }
    } catch (error) {
      logger.error('Failed to check provider health', error);
    }
  }
  
  async checkProvider(name, config) {
    try {
      const ProviderClass = this.getProviderClass(config.type || 'base');
      if (!ProviderClass) {
        logger.warn(`No provider class found for type: ${config.type}`);
        return;
      }
      
      const provider = new ProviderClass(config);
      
      const start = Date.now();
      const health = await provider.healthCheck();
      const latency = Date.now() - start;
      
      this.updateHealthData(name, {
        status: health.status,
        latency,
        timestamp: new Date(),
        consecutive_failures: health.status === 'healthy' ? 0 : 
          (this.healthData[name]?.consecutive_failures || 0) + 1
      });
      
      logger.debug(`Health check completed for ${name}`, {
        status: health.status,
        latency,
        consecutive_failures: this.healthData[name]?.consecutive_failures || 0
      });
      
    } catch (error) {
      logger.error(`Health check failed for ${name}`, {
        error: error.message,
        stack: error.stack
      });
      
      this.updateHealthData(name, {
        status: 'unhealthy',
        latency: 999999,
        timestamp: new Date(),
        error: error.message,
        consecutive_failures: (this.healthData[name]?.consecutive_failures || 0) + 1
      });
    }
  }
  
  updateHealthData(providerName, newData) {
    if (!this.healthData[providerName]) {
      this.healthData[providerName] = {
        uptime: 1.0,
        avg_latency: 200,
        cost: 0.002, // Default cost per token
        history: []
      };
    }
    
    const provider = this.healthData[providerName];
    
    // Update moving averages
    provider.history.push(newData);
    if (provider.history.length > 100) {
      provider.history.shift(); // Keep last 100 entries
    }
    
    // Calculate uptime (% of successful requests in recent history)
    const recent = provider.history.slice(-20); // Last 20 checks
    if (recent.length > 0) {
      const successful = recent.filter(h => h.status === 'healthy').length;
      provider.uptime = successful / recent.length;
    }
    
    // Calculate average latency from healthy entries only
    const healthyEntries = recent.filter(h => h.status === 'healthy');
    if (healthyEntries.length > 0) {
      provider.avg_latency = healthyEntries.reduce((sum, h) => sum + h.latency, 0) / healthyEntries.length;
    }
    
    provider.last_check = newData.timestamp;
    provider.consecutive_failures = newData.consecutive_failures;
    
    // Log significant health changes
    if (newData.consecutive_failures === 3) {
      logger.warn(`Provider ${providerName} has 3 consecutive failures`, {
        uptime: provider.uptime,
        avg_latency: provider.avg_latency
      });
    } else if (provider.consecutive_failures > 0 && newData.consecutive_failures === 0) {
      logger.info(`Provider ${providerName} recovered`, {
        uptime: provider.uptime,
        avg_latency: provider.avg_latency
      });
    }
  }
  
  getProviderHealth() {
    return this.healthData;
  }
  
  getProviderHealthSummary() {
    const summary = {};
    for (const [name, data] of Object.entries(this.healthData)) {
      summary[name] = {
        status: data.consecutive_failures < 3 ? 'healthy' : 'unhealthy',
        uptime: data.uptime,
        avg_latency: Math.round(data.avg_latency),
        consecutive_failures: data.consecutive_failures,
        last_check: data.last_check
      };
    }
    return summary;
  }
  
  getProviderClass(type) {
    const providerMapping = {
      'google': '../providers/GoogleProvider',
      'huggingface': '../providers/HuggingFaceProvider',
      'cohere': '../providers/CohereProvider',
      'openai': '../providers/OpenAIProvider'
    };
    
    const modulePath = providerMapping[type];
    if (!modulePath) {
      return null;
    }
    
    try {
      return require(modulePath);
    } catch (error) {
      logger.warn(`Failed to load provider class: ${modulePath}`, error.message);
      return null;
    }
  }
  
  recordAttempt(providerName) {
    logger.debug('Provider attempt recorded', { provider: providerName });
  }
  
  recordSuccess(providerName, latency) {
    logger.debug('Provider success recorded', { 
      provider: providerName, 
      latency 
    });
    
    // Update real-time success data
    this.updateHealthData(providerName, {
      status: 'healthy',
      latency,
      timestamp: new Date(),
      consecutive_failures: 0
    });
  }
  
  recordFailure(providerName, error) {
    logger.warn('Provider failure recorded', { 
      provider: providerName, 
      error: error?.message || error 
    });
    
    // Update real-time failure data
    this.updateHealthData(providerName, {
      status: 'unhealthy',
      latency: 999999,
      timestamp: new Date(),
      error: error?.message || error,
      consecutive_failures: (this.healthData[providerName]?.consecutive_failures || 0) + 1
    });
  }
}

module.exports = HealthMonitor;