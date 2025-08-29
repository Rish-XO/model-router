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

// Basic route
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'model-router'
  });
});

module.exports = app;