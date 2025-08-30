const express = require('express');
const router = express.Router();
const metricsCollector = require('../../monitoring/MetricsCollector');
const { logger } = require('../middleware/logging');

// Prometheus metrics endpoint
router.get('/', async (req, res) => {
  try {
    res.set('Content-Type', 'text/plain');
    const metrics = await metricsCollector.getMetrics();
    res.send(metrics);
  } catch (error) {
    logger.error('Failed to get metrics', error);
    res.status(500).send('Error retrieving metrics');
  }
});

// JSON metrics for debugging
router.get('/json', async (req, res) => {
  try {
    const metrics = await metricsCollector.getMetricsAsJSON();
    res.json(metrics);
  } catch (error) {
    logger.error('Failed to get JSON metrics', error);
    res.status(500).json({ error: 'Error retrieving metrics' });
  }
});

module.exports = router;
