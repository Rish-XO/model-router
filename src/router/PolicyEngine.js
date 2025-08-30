const fs = require('fs');
const path = require('path');
const { logger } = require('../api/middleware/logging');

class PolicyEngine {
  constructor() {
    this.policies = this.loadPolicies();
  }

  loadPolicies() {
    try {
      const filePath = path.join(__dirname, '../../config/policies/routing.json');
      const data = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      logger.error('Failed to load routing policies', error);
      // Return default policies if file doesn't exist
      return this.getDefaultPolicies();
    }
  }

  getDefaultPolicies() {
    return {
      'performance-first': {
        'strategy': 'performance-first',
        'min_uptime': 0.90,
        'max_latency': 500,
        'description': 'Prioritize fastest response times'
      },
      'cost-optimized': {
        'strategy': 'cost-optimized',
        'min_uptime': 0.95,
        'description': 'Prioritize lowest cost providers'
      },
      'balanced': {
        'strategy': 'balanced',
        'weights': {
          'cost': 0.3,
          'latency': 0.4,
          'uptime': 0.3
        },
        'min_uptime': 0.90,
        'description': 'Balance cost, speed, and reliability'
      }
    };
  }

  selectProviders(availableProviders, healthData, policyName, request) {
    const policy = this.policies[policyName] || this.policies['balanced'];

    logger.info('Selecting providers', {
      availableProviders: availableProviders.length,
      policy: policyName,
      strategy: policy.strategy
    });

    // Filter providers by minimum uptime
    const healthyProviders = availableProviders.filter(provider => {
      const health = healthData[provider];
      if (!health) return true; // No health data yet, allow
      return health.uptime >= (policy.min_uptime || 0.90);
    });

    if (healthyProviders.length === 0) {
      logger.warn('No providers meet uptime requirements, using all available');
      return availableProviders;
    }

    switch (policy.strategy) {
    case 'cost-optimized':
      return this.selectByCost(healthyProviders, healthData, policy);
    case 'performance-first':
      return this.selectByLatency(healthyProviders, healthData, policy);
    case 'balanced':
      return this.selectByScore(healthyProviders, healthData, policy);
    default:
      return this.selectDefault(healthyProviders, healthData);
    }
  }

  selectByCost(providers, healthData, policy) {
    // Sort by cost (lower cost = better)
    return providers.sort((a, b) => {
      const costA = this.getProviderCost(a, healthData);
      const costB = this.getProviderCost(b, healthData);
      return costA - costB;
    });
  }

  selectByLatency(providers, healthData, policy) {
    // Sort by latency (lower latency = better)
    return providers.sort((a, b) => {
      const latencyA = healthData[a]?.avg_latency || 999999;
      const latencyB = healthData[b]?.avg_latency || 999999;
      return latencyA - latencyB;
    });
  }

  selectByScore(providers, healthData, policy) {
    const weights = policy.weights || { cost: 0.3, latency: 0.4, uptime: 0.3 };

    const scoredProviders = providers.map(provider => ({
      name: provider,
      score: this.calculateScore(provider, healthData[provider] || {}, weights)
    }));

    // Sort by score (higher score = better)
    const sorted = scoredProviders.sort((a, b) => b.score - a.score);

    logger.debug('Provider scores', {
      scores: sorted.map(p => ({ provider: p.name, score: p.score.toFixed(3) }))
    });

    return sorted.map(p => p.name);
  }

  calculateScore(providerName, health, weights) {
    // Get basic health metrics
    const uptime = health.uptime || 0.5;
    const latency = health.avg_latency || 1000;
    const cost = this.getProviderCost(providerName, { [providerName]: health });

    // Normalize scores (0-1 range)
    const uptimeScore = Math.min(uptime, 1.0);
    const latencyScore = Math.max(0, 1 - (latency / 2000)); // 2000ms = 0 score
    const costScore = Math.max(0, 1 - (cost / 0.01)); // $0.01 per token = 0 score

    // Calculate weighted score
    const totalScore = (
      uptimeScore * weights.uptime +
      latencyScore * weights.latency +
      costScore * weights.cost
    );

    return totalScore;
  }

  getProviderCost(providerName, healthData) {
    // Default cost if no specific cost data available
    const defaultCosts = {
      'google-gemini': 0.001, // $0.001 per token
      'hugging-face': 0.0,    // Free
      'cohere': 0.002         // $0.002 per token
    };

    return defaultCosts[providerName] || 0.002;
  }

  selectDefault(providers, healthData) {
    // Simple fallback: providers with best uptime first
    return providers.sort((a, b) => {
      const uptimeA = healthData[a]?.uptime || 0.5;
      const uptimeB = healthData[b]?.uptime || 0.5;
      return uptimeB - uptimeA; // Higher uptime first
    });
  }
}

module.exports = PolicyEngine;
