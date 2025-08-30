const fs = require('fs').promises;
const path = require('path');
const { logger } = require('../api/middleware/logging');

class ConfigLoader {
  static async loadTenant(tenantId = 'default') {
    try {
      const filePath = path.join(__dirname, '../../config/tenants', `${tenantId}.json`);
      const data = await fs.readFile(filePath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      logger.error(`Failed to load tenant config: ${tenantId}`, error);
      throw error;
    }
  }

  static async loadProviders() {
    try {
      const filePath = path.join(__dirname, '../../config/providers.json');
      const data = await fs.readFile(filePath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      logger.error('Failed to load provider config', error);
      throw error;
    }
  }

  // Sync versions for backward compatibility (cached)
  static loadTenantSync(tenantId = 'default') {
    const syncFs = require('fs');
    try {
      const filePath = path.join(__dirname, '../../config/tenants', `${tenantId}.json`);
      const data = syncFs.readFileSync(filePath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      logger.error(`Failed to load tenant config: ${tenantId}`, error);
      throw error;
    }
  }

  static loadProvidersSync() {
    const syncFs = require('fs');
    try {
      const filePath = path.join(__dirname, '../../config/providers.json');
      const data = syncFs.readFileSync(filePath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      logger.error('Failed to load provider config', error);
      throw error;
    }
  }
}

module.exports = ConfigLoader;
