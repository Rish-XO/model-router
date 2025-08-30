const client = require('prom-client');
const { logger } = require('../api/middleware/logging');

class MetricsCollector {
  constructor() {
    // Create metrics registry
    this.register = new client.Registry();

    // Add default metrics
    client.collectDefaultMetrics({ register: this.register });

    // Custom metrics
    this.httpRequestsTotal = new client.Counter({
      name: 'http_requests_total',
      help: 'Total number of HTTP requests',
      labelNames: ['method', 'endpoint', 'status_code', 'tenant_id']
    });

    this.httpRequestDuration = new client.Histogram({
      name: 'http_request_duration_seconds',
      help: 'Duration of HTTP requests in seconds',
      labelNames: ['method', 'endpoint', 'tenant_id'],
      buckets: [0.1, 0.3, 0.5, 0.7, 1, 3, 5, 7, 10]
    });

    this.providerRequestsTotal = new client.Counter({
      name: 'provider_requests_total',
      help: 'Total requests sent to providers',
      labelNames: ['provider', 'status', 'tenant_id']
    });

    this.providerRequestDuration = new client.Histogram({
      name: 'provider_request_duration_seconds',
      help: 'Duration of provider requests in seconds',
      labelNames: ['provider', 'tenant_id'],
      buckets: [0.1, 0.5, 1, 2, 5, 10, 30]
    });

    this.providerHealthStatus = new client.Gauge({
      name: 'provider_health_status',
      help: 'Provider health status (1 = healthy, 0 = unhealthy)',
      labelNames: ['provider']
    });

    this.circuitBreakerStatus = new client.Gauge({
      name: 'circuit_breaker_status',
      help: 'Circuit breaker status (0 = closed, 1 = open, 0.5 = half-open)',
      labelNames: ['provider']
    });

    this.tokensProcessed = new client.Counter({
      name: 'tokens_processed_total',
      help: 'Total tokens processed',
      labelNames: ['provider', 'tenant_id', 'type']
    });

    this.quotaUsage = new client.Gauge({
      name: 'quota_usage',
      help: 'Current quota usage for tenants',
      labelNames: ['tenant_id', 'quota_type']
    });

    this.rateLimitHits = new client.Counter({
      name: 'rate_limit_hits_total',
      help: 'Total number of rate limit hits',
      labelNames: ['tenant_id']
    });

    // Register metrics
    this.register.registerMetric(this.httpRequestsTotal);
    this.register.registerMetric(this.httpRequestDuration);
    this.register.registerMetric(this.providerRequestsTotal);
    this.register.registerMetric(this.providerRequestDuration);
    this.register.registerMetric(this.providerHealthStatus);
    this.register.registerMetric(this.circuitBreakerStatus);
    this.register.registerMetric(this.tokensProcessed);
    this.register.registerMetric(this.quotaUsage);
    this.register.registerMetric(this.rateLimitHits);

    logger.info('Metrics collector initialized');
  }

  recordHTTPRequest(method, endpoint, statusCode, duration, tenantId) {
    this.httpRequestsTotal.inc({
      method,
      endpoint,
      status_code: statusCode,
      tenant_id: tenantId || 'unknown'
    });

    this.httpRequestDuration.observe(
      { method, endpoint, tenant_id: tenantId || 'unknown' },
      duration / 1000 // Convert to seconds
    );
  }

  recordProviderRequest(provider, status, duration, tenantId) {
    this.providerRequestsTotal.inc({
      provider,
      status,
      tenant_id: tenantId || 'unknown'
    });

    if (status === 'success' && duration) {
      this.providerRequestDuration.observe(
        { provider, tenant_id: tenantId || 'unknown' },
        duration / 1000
      );
    }
  }

  recordProviderHealth(provider, isHealthy) {
    this.providerHealthStatus.set({ provider }, isHealthy ? 1 : 0);
  }

  recordCircuitBreakerState(provider, state) {
    let value = 0;
    switch (state) {
    case 'closed':
      value = 0;
      break;
    case 'open':
      value = 1;
      break;
    case 'half-open':
      value = 0.5;
      break;
    }
    this.circuitBreakerStatus.set({ provider }, value);
  }

  recordTokenUsage(provider, tenantId, promptTokens, completionTokens) {
    if (promptTokens > 0) {
      this.tokensProcessed.inc(
        { provider, tenant_id: tenantId || 'unknown', type: 'prompt' },
        promptTokens
      );
    }

    if (completionTokens > 0) {
      this.tokensProcessed.inc(
        { provider, tenant_id: tenantId || 'unknown', type: 'completion' },
        completionTokens
      );
    }
  }

  recordQuotaUsage(tenantId, quotaType, used, limit) {
    const usage = limit > 0 ? (used / limit) * 100 : 0;
    this.quotaUsage.set(
      { tenant_id: tenantId, quota_type: quotaType },
      usage
    );
  }

  recordRateLimitHit(tenantId) {
    this.rateLimitHits.inc({ tenant_id: tenantId || 'unknown' });
  }

  async getMetrics() {
    return this.register.metrics();
  }

  async getMetricsAsJSON() {
    return this.register.getMetricsAsJSON();
  }

  // Helper method to create middleware that records HTTP metrics
  createHTTPMetricsMiddleware() {
    return (req, res, next) => {
      const startTime = Date.now();

      // Capture the original end function
      const originalEnd = res.end;

      res.end = function(...args) {
        const duration = Date.now() - startTime;
        const endpoint = req.route ? req.route.path : req.path;
        const tenantId = req.tenant?.tenant_id;

        this.recordHTTPRequest(
          req.method,
          endpoint,
          res.statusCode,
          duration,
          tenantId
        );

        // Call the original end function
        originalEnd.apply(res, args);
      }.bind(this);

      next();
    };
  }

  // Helper method to update provider metrics from RouterEngine
  updateProviderMetrics(routerEngine) {
    if (!routerEngine) return;

    try {
      // Update circuit breaker status
      const circuitBreakerStatus = routerEngine.getCircuitBreakerStatus();
      for (const [provider, status] of Object.entries(circuitBreakerStatus)) {
        this.recordCircuitBreakerState(provider, status.state);
      }

      // Update provider health
      const healthStatus = routerEngine.getHealthStatus();
      for (const [provider, health] of Object.entries(healthStatus)) {
        this.recordProviderHealth(provider, health.status === 'healthy');
      }
    } catch (error) {
      logger.error('Failed to update provider metrics', error);
    }
  }

  // Helper method to update tenant quota metrics
  updateQuotaMetrics(tenantManager) {
    if (!tenantManager) return;

    try {
      const tenants = tenantManager.getAllTenants();
      for (const tenantId of tenants) {
        const usage = tenantManager.getUsage(tenantId);
        const tenant = tenantManager.getTenant(tenantId);

        if (tenant && tenant.quotas) {
          if (tenant.quotas.daily_requests) {
            this.recordQuotaUsage(
              tenantId,
              'daily_requests',
              usage.daily_requests,
              tenant.quotas.daily_requests
            );
          }

          if (tenant.quotas.monthly_requests) {
            this.recordQuotaUsage(
              tenantId,
              'monthly_requests',
              usage.monthly_requests,
              tenant.quotas.monthly_requests
            );
          }
        }
      }
    } catch (error) {
      logger.error('Failed to update quota metrics', error);
    }
  }
}

// Export singleton instance
module.exports = new MetricsCollector();
