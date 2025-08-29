const PolicyEngine = require('./PolicyEngine');
const HealthMonitor = require('./HealthMonitor');
const ConfigLoader = require('../config/ConfigLoader');
const { logger } = require('../api/middleware/logging');

class RouterEngine {
  constructor() {
    this.policyEngine = new PolicyEngine();
    this.healthMonitor = new HealthMonitor();
    this.providers = new Map();
    this.circuitBreakers = new Map();
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
    logger.info('🔄 loadProviders - ENTRY');
    
    let providerConfigs;
    try {
      providerConfigs = ConfigLoader.loadProvidersSync();
      logger.info('✅ Provider configs loaded', { 
        configCount: Object.keys(providerConfigs).length,
        providers: Object.keys(providerConfigs)
      });
    } catch (error) {
      logger.error('❌ Failed to load provider configs', error);
      return;
    }
    
    for (const [name, config] of Object.entries(providerConfigs)) {
      logger.info(`🔍 Processing provider: ${name}`, {
        enabled: config.enabled,
        type: config.type,
        hasApiKeyEnv: !!config.api_key_env
      });
      
      if (config.enabled !== false) {
        try {
          logger.info(`📋 Getting provider class for ${name} (type: ${config.type})`);
          const ProviderClass = this.getProviderClass(config.type || 'base');
          if (ProviderClass) {
            logger.info(`📝 Creating provider instance: ${name}`);
            
            // Check if API key exists before creating provider
            const apiKey = process.env[config.api_key_env];
            logger.info(`🔑 API key check for ${name}:`, {
              envVar: config.api_key_env,
              hasKey: !!apiKey,
              keyLength: apiKey ? apiKey.length : 0
            });
            
            this.providers.set(name, new ProviderClass(config));
            this.circuitBreakers.set(name, {
              state: 'closed',
              failureCount: 0,
              lastFailureTime: null,
              nextAttemptTime: null,
              threshold: 5,
              timeout: 60000
            });
            logger.info(`✅ Loaded provider: ${name}`, {
              type: config.type,
              endpoint: config.endpoint
            });
          } else {
            logger.warn(`❌ No provider class found for ${name} (type: ${config.type})`);
          }
        } catch (error) {
          logger.error(`❌ Failed to load provider ${name}:`, {
            error: error.message,
            stack: error.stack
          });
        }
      } else {
        logger.info(`⏭️ Skipping disabled provider: ${name}`);
      }
    }
    
    logger.info('✅ loadProviders - COMPLETE', {
      totalProvidersLoaded: this.providers.size,
      loadedProviders: Array.from(this.providers.keys())
    });
  }
  
  async routeRequest(request, tenant) {
    logger.info('🔄 RouterEngine.routeRequest - ENTRY', {
      initialized: this.isInitialized,
      model: request.model,
      tenant: tenant?.tenant_id,
      providersLoaded: this.providers.size,
      availableProviders: Array.from(this.providers.keys())
    });
    
    if (!this.isInitialized) {
      logger.error('❌ RouterEngine not initialized');
      throw new Error('RouterEngine not initialized');
    }
    
    logger.info('Routing request', {
      model: request.model,
      tenant: tenant?.tenant_id,
      policy: tenant?.providers?.routing_policy || 'balanced'
    });
    
    try {
      logger.info('📋 Loading tenant configuration...');
      // Get tenant configuration  
      const tenantConfig = tenant || ConfigLoader.loadTenantSync('default');
      logger.info('✅ Tenant config loaded', {
        tenantId: tenantConfig.tenant_id,
        enabledProviders: tenantConfig.providers?.enabled,
        policy: tenantConfig.providers?.routing_policy
      });
      
      // Get available providers for this tenant
      const availableProviders = tenantConfig.providers?.enabled || ['google-gemini'];
      logger.info('📋 Checking provider availability...', {
        requestedProviders: availableProviders,
        loadedProviders: Array.from(this.providers.keys())
      });
      
      // Filter to only include providers we have loaded and are available through circuit breaker
      const loadedProviders = availableProviders.filter(name => {
        const hasProvider = this.providers.has(name);
        const isAvailable = this.isProviderAvailable(name);
        logger.info(`🔍 Provider ${name}:`, {
          loaded: hasProvider,
          available: isAvailable,
          circuitBreakerState: this.circuitBreakers.get(name)?.state || 'none'
        });
        return hasProvider && isAvailable;
      });
      
      logger.info('✅ Provider filtering complete', {
        availableCount: loadedProviders.length,
        loadedProviders: loadedProviders
      });
      
      if (loadedProviders.length === 0) {
        logger.error('❌ No providers available!', {
          requested: availableProviders,
          loaded: Array.from(this.providers.keys()),
          tenantId: tenantConfig.tenant_id
        });
        throw new Error(`No providers available for tenant ${tenantConfig.tenant_id}`);
      }
      
      logger.info('📊 Getting health data...');
      // Get current health data
      const healthData = this.healthMonitor.getProviderHealth();
      logger.info('✅ Health data retrieved', { healthData });
      
      logger.info('🎯 Selecting providers with policy engine...');
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
      
      logger.info('🚀 Starting failover execution...');
      // Try providers in order until one succeeds
      return await this.executeWithFailover(request, orderedProviders);
      
    } catch (error) {
      logger.error('Routing failed', error);
      throw error;
    }
  }
  
  async executeWithFailover(request, orderedProviders) {
    logger.info('🔄 executeWithFailover - ENTRY', {
      providersToTry: orderedProviders,
      totalProviders: orderedProviders.length
    });
    
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
        logger.info(`🚀 Making request to ${providerName} with 15s timeout...`);
        const response = await this.executeWithTimeout(provider, request, 15000);
        const duration = Date.now() - startTime;
        logger.info(`✅ Request completed successfully in ${duration}ms`, { provider: providerName });
        
        // Record success
        this.healthMonitor.recordSuccess(providerName, duration);
        this.recordCircuitBreakerSuccess(providerName);
        
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
        this.recordCircuitBreakerFailure(providerName);
        
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
  
  // Circuit breaker methods
  isProviderAvailable(providerName) {
    const breaker = this.circuitBreakers.get(providerName);
    if (!breaker) return true;
    
    const now = Date.now();
    
    switch (breaker.state) {
      case 'closed':
        return true;
        
      case 'open':
        if (now >= breaker.nextAttemptTime) {
          breaker.state = 'half-open';
          logger.info(`Circuit breaker half-open for ${providerName}`);
          return true;
        }
        return false;
        
      case 'half-open':
        return true;
        
      default:
        return true;
    }
  }
  
  recordCircuitBreakerSuccess(providerName) {
    const breaker = this.circuitBreakers.get(providerName);
    if (!breaker) return;
    
    breaker.failureCount = 0;
    breaker.lastFailureTime = null;
    
    if (breaker.state === 'half-open') {
      breaker.state = 'closed';
      logger.info(`Circuit breaker closed for ${providerName}`);
    }
  }
  
  recordCircuitBreakerFailure(providerName) {
    const breaker = this.circuitBreakers.get(providerName);
    if (!breaker) return;
    
    breaker.failureCount++;
    breaker.lastFailureTime = Date.now();
    
    if (breaker.failureCount >= breaker.threshold) {
      breaker.state = 'open';
      breaker.nextAttemptTime = Date.now() + breaker.timeout;
      logger.warn(`Circuit breaker opened for ${providerName}`, {
        failureCount: breaker.failureCount,
        nextAttemptTime: new Date(breaker.nextAttemptTime).toISOString()
      });
    }
  }
  
  getCircuitBreakerStatus() {
    const status = {};
    for (const [name, breaker] of this.circuitBreakers) {
      status[name] = {
        state: breaker.state,
        failureCount: breaker.failureCount,
        lastFailureTime: breaker.lastFailureTime ? new Date(breaker.lastFailureTime).toISOString() : null,
        nextAttemptTime: breaker.nextAttemptTime ? new Date(breaker.nextAttemptTime).toISOString() : null
      };
    }
    return status;
  }

  // Shutdown method to clean up resources
  shutdown() {
    this.healthMonitor.stopMonitoring();
    this.providers.clear();
    this.circuitBreakers.clear();
    this.isInitialized = false;
    logger.info('RouterEngine shut down');
  }
}

module.exports = RouterEngine;