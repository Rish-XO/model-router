const PolicyEngine = require('./PolicyEngine');
const HealthMonitor = require('./HealthMonitor');
const ConfigLoader = require('../config/ConfigLoader');
const { logger } = require('../api/middleware/logging');

class RouterEngine {
  constructor() {
    this.policyEngine = new PolicyEngine();
    this.healthMonitor = new HealthMonitor();
    this.providers = new Map();
    this.isInitialized = false;
    
    this.initialize();
  }
  
  initialize() {
    try {
      this.loadProviders();
      this.healthMonitor.startMonitoring();
      this.isInitialized = true;
      logger.info('RouterEngine initialized successfully', {
        providersLoaded: this.providers.size
      });
    } catch (error) {
      logger.error('Failed to initialize RouterEngine', error);
    }
  }
  
  loadProviders() {
    const providerConfigs = ConfigLoader.loadProviders();
    
    for (const [name, config] of Object.entries(providerConfigs)) {
      if (config.enabled !== false) {
        try {
          const ProviderClass = this.getProviderClass(config.type || 'base');
          if (ProviderClass) {
            this.providers.set(name, new ProviderClass(config));
            logger.info(`Loaded provider: ${name}`, {
              type: config.type,
              endpoint: config.endpoint
            });
          }
        } catch (error) {
          logger.error(`Failed to load provider ${name}:`, error);
        }
      }
    }
  }
  
  async routeRequest(request, tenant) {
    if (!this.isInitialized) {
      throw new Error('RouterEngine not initialized');
    }
    
    logger.info('Routing request', {
      model: request.model,
      tenant: tenant?.tenant_id,
      policy: tenant?.providers?.routing_policy || 'balanced'
    });
    
    try {
      // Get tenant configuration  
      const tenantConfig = tenant || ConfigLoader.loadTenant('default');
      
      // Get available providers for this tenant
      const availableProviders = tenantConfig.providers?.enabled || ['google-gemini'];
      
      // Filter to only include providers we have loaded
      const loadedProviders = availableProviders.filter(name => this.providers.has(name));
      
      if (loadedProviders.length === 0) {
        throw new Error(`No providers available for tenant ${tenantConfig.tenant_id}`);
      }
      
      // Get current health data
      const healthData = this.healthMonitor.getProviderHealth();
      
      // Select providers based on policy
      const orderedProviders = this.policyEngine.selectProviders(
        loadedProviders,
        healthData,
        tenantConfig.providers?.routing_policy || 'balanced',
        request
      );
      
      logger.info('Provider selection complete', {
        orderedProviders,
        policy: tenantConfig.providers?.routing_policy || 'balanced',
        availableProviders: loadedProviders
      });
      
      // Try providers in order until one succeeds
      return await this.executeWithFailover(request, orderedProviders);
      
    } catch (error) {
      logger.error('Routing failed', error);
      throw error;
    }
  }
  
  async executeWithFailover(request, orderedProviders) {
    let lastError = null;
    const attempts = [];
    
    for (const providerName of orderedProviders) {
      const startTime = Date.now();
      
      try {
        logger.info(`= Attempting provider: ${providerName}`);
        
        const provider = this.providers.get(providerName);
        if (!provider) {
          throw new Error(`Provider ${providerName} not loaded`);
        }
        
        // Record attempt
        this.healthMonitor.recordAttempt(providerName);
        
        // Make request with timeout and retry logic
        const response = await this.executeWithTimeout(provider, request, 15000);
        const duration = Date.now() - startTime;
        
        // Record success
        this.healthMonitor.recordSuccess(providerName, duration);
        
        attempts.push({
          provider: providerName,
          status: 'success',
          duration
        });
        
        logger.info(` Success with ${providerName}`, { 
          duration,
          attempts: attempts.length 
        });
        
        // Add routing metadata to response
        response.routing_metadata = {
          primary_provider: providerName,
          attempts: attempts,
          total_processing_time: duration,
          policy_used: 'intelligent_routing'
        };
        
        return response;
        
      } catch (error) {
        const duration = Date.now() - startTime;
        lastError = error;
        
        attempts.push({
          provider: providerName,
          status: 'failed',
          error: error.message,
          duration
        });
        
        logger.warn(`L Failed with ${providerName}:`, {
          error: error.message,
          duration,
          attempts: attempts.length
        });
        
        // Record failure
        this.healthMonitor.recordFailure(providerName, error);
        
        // Continue to next provider
        continue;
      }
    }
    
    // All providers failed
    const error = new Error(`All providers failed. Attempted: ${orderedProviders.join(', ')}`);
    error.attempts = attempts;
    error.lastError = lastError?.message;
    error.providersAttempted = orderedProviders.length;
    
    logger.error('All providers failed', {
      attempts: attempts.length,
      providers: orderedProviders,
      lastError: lastError?.message
    });
    
    throw error;
  }
  
  async executeWithTimeout(provider, request, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Request timeout after ${timeoutMs}ms`));
      }, timeoutMs);
      
      provider.makeRequest(request)
        .then(response => {
          clearTimeout(timeout);
          resolve(response);
        })
        .catch(error => {
          clearTimeout(timeout);
          reject(error);
        });
    });
  }
  
  getProviderClass(type) {
    const providerMapping = {
      'google': require('../providers/GoogleProvider'),
      'huggingface': require('../providers/HuggingFaceProvider')
    };
    
    const ProviderClass = providerMapping[type];
    if (!ProviderClass) {
      logger.warn(`Unknown provider type: ${type}`);
      return null;
    }
    
    return ProviderClass;
  }
  
  // Get current health status for debugging/monitoring
  getHealthStatus() {
    return this.healthMonitor.getProviderHealthSummary();
  }
  
  // Get available providers
  getAvailableProviders() {
    return Array.from(this.providers.keys());
  }
  
  // Shutdown method to clean up resources
  shutdown() {
    this.healthMonitor.stopMonitoring();
    this.providers.clear();
    this.isInitialized = false;
    logger.info('RouterEngine shut down');
  }
}

module.exports = RouterEngine;