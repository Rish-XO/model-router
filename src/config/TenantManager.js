const ConfigLoader = require('./ConfigLoader');
const { logger } = require('../api/middleware/logging');

class TenantManager {
  constructor() {
    this.tenantCache = new Map();
    this.usageData = new Map(); // Track usage per tenant
    this.loadAllTenants();
  }

  loadAllTenants() {
    try {
      const fs = require('fs');
      const path = require('path');
      const tenantsDir = path.join(__dirname, '../../config/tenants');

      if (!fs.existsSync(tenantsDir)) {
        logger.warn('Tenants directory does not exist');
        return;
      }

      const tenantFiles = fs.readdirSync(tenantsDir).filter(f => f.endsWith('.json'));

      for (const file of tenantFiles) {
        const tenantId = file.replace('.json', '');
        try {
          const tenant = ConfigLoader.loadTenantSync(tenantId);
          this.tenantCache.set(tenantId, tenant);
          logger.info(`Loaded tenant: ${tenantId}`, {
            providers: tenant.providers?.enabled?.length || 0,
            quotas: tenant.quotas || {}
          });
        } catch (error) {
          logger.error(`Failed to load tenant ${tenantId}:`, error);
        }
      }

    } catch (error) {
      logger.error('Failed to load tenants', error);
    }
  }

  getTenant(tenantId) {
    return this.tenantCache.get(tenantId);
  }

  findTenantByAPIKey(apiKey) {
    for (const [tenantId, tenant] of this.tenantCache) {
      if (tenant.api_keys && tenant.api_keys.includes(apiKey)) {
        return tenant;
      }
    }
    return null;
  }

  checkQuota(tenantId, quotaType) {
    const tenant = this.getTenant(tenantId);
    if (!tenant || !tenant.quotas) {
      return { allowed: true, remaining: Infinity, limit: Infinity };
    }

    const usage = this.getUsage(tenantId);
    const limit = tenant.quotas[quotaType] || 1000;
    const used = usage[quotaType] || 0;
    const remaining = Math.max(0, limit - used);

    return {
      allowed: remaining > 0,
      remaining: remaining,
      limit: limit,
      used: used
    };
  }

  trackUsage(tenantId, usage) {
    if (!this.usageData.has(tenantId)) {
      this.usageData.set(tenantId, {
        daily_requests: 0,
        monthly_requests: 0,
        total_tokens: 0,
        estimated_cost: 0,
        last_reset: Date.now()
      });
    }

    const tenantUsage = this.usageData.get(tenantId);

    // Update usage counters
    tenantUsage.daily_requests += 1;
    tenantUsage.monthly_requests += 1;
    tenantUsage.total_tokens += usage.total_tokens || 0;
    tenantUsage.estimated_cost += usage.estimated_cost || 0;

    // Check if we need to reset daily counters (simple day check)
    const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
    if (tenantUsage.last_reset < oneDayAgo) {
      tenantUsage.daily_requests = 1;
      tenantUsage.last_reset = Date.now();
    }

    logger.info('Usage tracked', {
      tenant_id: tenantId,
      daily_requests: tenantUsage.daily_requests,
      tokens: usage.total_tokens,
      cost: usage.estimated_cost || 0
    });
  }

  getUsage(tenantId) {
    return this.usageData.get(tenantId) || {
      daily_requests: 0,
      monthly_requests: 0,
      total_tokens: 0,
      estimated_cost: 0
    };
  }

  getUsageReport(tenantId) {
    const tenant = this.getTenant(tenantId);
    const usage = this.getUsage(tenantId);

    if (!tenant) {
      return null;
    }

    return {
      tenant_id: tenantId,
      current_usage: usage,
      quotas: tenant.quotas || {},
      quota_status: {
        daily_requests: this.checkQuota(tenantId, 'daily_requests'),
        monthly_requests: this.checkQuota(tenantId, 'monthly_requests')
      }
    };
  }

  getAllTenants() {
    return Array.from(this.tenantCache.keys());
  }

  reloadTenant(tenantId) {
    try {
      const tenant = ConfigLoader.loadTenantSync(tenantId);
      this.tenantCache.set(tenantId, tenant);
      logger.info(`Reloaded tenant: ${tenantId}`);
      return tenant;
    } catch (error) {
      logger.error(`Failed to reload tenant ${tenantId}:`, error);
      return null;
    }
  }
}

module.exports = TenantManager;
