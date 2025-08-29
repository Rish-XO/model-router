const fs = require('fs');
const path = require('path');

class ConfigLoader {
  static loadTenant(tenantId = 'default') {
    try {
      const filePath = path.join(__dirname, '../../config/tenants', `${tenantId}.json`);
      const data = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      console.error(`Failed to load tenant config: ${tenantId}`, error.message);
      throw error;
    }
  }
  
  static loadProviders() {
    try {
      const filePath = path.join(__dirname, '../../config/providers.json');
      const data = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      console.error('Failed to load provider config', error.message);
      throw error;
    }
  }
}

module.exports = ConfigLoader;