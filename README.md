# Model Router

A production-ready, intelligent AI model routing service that provides a unified API gateway for multiple Large Language Model (LLM) providers. Similar to OpenRouter.ai, but self-hosted with advanced routing policies, circuit breakers, and comprehensive monitoring.

## 🚀 Features

- **Multi-Provider Support** - Google Gemini, Groq, HuggingFace, and more
- **Intelligent Routing** - Cost, latency, and uptime-based provider selection
- **OpenAI Compatibility** - Drop-in replacement for OpenAI API
- **Circuit Breakers** - Automatic failover for failed providers
- **Multi-Tenancy** - API key-based tenant isolation
- **Rate Limiting** - Tenant-specific quotas and throttling
- **Health Monitoring** - Real-time provider health checks
- **Comprehensive Logging** - Structured logging with request tracing
- **Metrics & Analytics** - Prometheus-compatible metrics
- **High Availability** - Automatic failover with retry logic

## 📋 Quick Start

### Prerequisites

- Node.js 18+ 
- npm or yarn
- API keys for desired providers (Groq, Google Gemini, etc.)

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd model-router

# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Add your API keys to .env
GROQ_API_KEY=your-groq-api-key-here
GOOGLE_API_KEY=your-google-api-key-here
```

### Configuration

1. **Provider Configuration** (`config/providers.json`):
   ```json
   {
     "groq": {
       "name": "groq",
       "type": "groq", 
       "enabled": true,
       "endpoint": "https://api.groq.com/openai/v1/chat/completions",
       "api_key_env": "GROQ_API_KEY"
     }
   }
   ```

2. **Tenant Configuration** (`config/tenants/default.json`):
   ```json
   {
     "tenant_id": "default",
     "api_keys": ["ak-demo123"],
     "providers": {
       "enabled": ["groq", "google-gemini"],
       "routing_policy": "balanced"
     }
   }
   ```

### Running the Service

```bash
# Development mode
npm run dev

# Production mode
npm start

# With custom port
PORT=3001 npm start
```

## 🔧 API Usage

### Chat Completions (OpenAI Compatible)

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ak-demo123" \
  -d '{
    "model": "gpt-3.5-turbo",
    "messages": [
      {"role": "user", "content": "Hello!"}
    ]
  }'
```

### Response Format

```json
{
  "id": "chatcmpl-9c78c573-844b-4e4e-913b-b7f6c145772d",
  "object": "chat.completion",
  "model": "llama3-8b-8192",
  "choices": [{
    "message": {
      "role": "assistant", 
      "content": "Hello! How can I help you today?"
    }
  }],
  "usage": {
    "prompt_tokens": 12,
    "completion_tokens": 10,
    "total_tokens": 22
  },
  "routing_metadata": {
    "primary_provider": "groq",
    "attempts": [{"provider": "groq", "status": "success"}],
    "policy_used": "intelligent_routing"
  }
}
```

## 🏗️ Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Client App    │───▶│   Model Router   │───▶│   LLM Provider  │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                              │
                              ▼
                       ┌──────────────────┐
                       │   Monitoring &   │
                       │     Metrics      │
                       └──────────────────┘
```

### Core Components

- **RouterEngine** - Main orchestration and provider selection
- **PolicyEngine** - Intelligent routing based on cost/latency/uptime
- **HealthMonitor** - Provider health checks and circuit breakers  
- **Provider Adapters** - Normalize different provider APIs
- **Authentication** - Multi-tenant API key management
- **Rate Limiting** - Request throttling per tenant

See [Architecture Documentation](design/architecture.md) for detailed system design.

## 📊 Monitoring

### Health Check
```bash
curl http://localhost:3000/health
```

### Metrics Endpoint
```bash
curl http://localhost:3000/metrics
```

### Provider Status
```bash
curl -H "Authorization: Bearer ak-demo123" \
  http://localhost:3000/v1/health/providers
```

## 🔧 Development

### Adding New Providers

1. **Create Provider Class**:
   ```javascript
   // src/providers/NewProvider.js
   const BaseProvider = require('./BaseProvider');
   
   class NewProvider extends BaseProvider {
     async makeRequest(openAIRequest) {
       // Implementation
     }
   }
   ```

2. **Register Provider**:
   ```javascript
   // src/router/RouterEngine.js
   const providerMapping = {
     'newprovider': require('../providers/NewProvider')
   };
   ```

3. **Add Configuration**:
   ```json
   // config/providers.json
   "newprovider": {
     "name": "newprovider",
     "type": "newprovider", 
     "endpoint": "https://api.newprovider.com"
   }
   ```

### Testing

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Integration tests
npm run test:integration
```

### Code Quality

```bash
# Lint code
npm run lint

# Format code  
npm run format

# Type checking (if using TypeScript)
npm run type-check
```

## 📈 Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3000` |
| `NODE_ENV` | Environment | `development` |
| `LOG_LEVEL` | Logging level | `info` |
| `GROQ_API_KEY` | Groq API key | - |
| `GOOGLE_API_KEY` | Google Gemini key | - |
| `HEALTH_CHECK_INTERVAL` | Health check frequency | `300000` (5min) |

### Routing Policies

- **`balanced`** - Weighted scoring (cost: 30%, latency: 40%, uptime: 30%)
- **`cost-optimized`** - Prioritize lowest cost providers
- **`performance-first`** - Prioritize fastest response times

### Rate Limiting

Configure per-tenant limits in tenant configuration:
```json
{
  "quotas": {
    "daily_requests": 1000,
    "rate_limit_per_minute": 60
  }
}
```

## 🐳 Deployment

### Docker

```dockerfile
# Dockerfile included in repository
docker build -t model-router .
docker run -p 3000:3000 --env-file .env model-router
```

### Docker Compose

```bash
docker-compose up -d
```

### Environment-Specific Configs

- **Development**: Use `.env` file
- **Staging/Production**: Use environment variables or secrets management

## 🔒 Security

- API key authentication with tenant isolation
- Rate limiting to prevent abuse  
- Input validation on all endpoints
- Secure headers via Helmet.js
- No sensitive data in logs
- Environment-based configuration

## 📋 Troubleshooting

### Common Issues

1. **Provider 401/403 Errors**: Check API key configuration
2. **Rate Limit Errors**: Verify provider quotas and tenant limits
3. **Slow Responses**: Check provider health and circuit breaker status
4. **No Providers Available**: Ensure at least one provider is healthy

See [Troubleshooting Guide](docs/troubleshooting.md) for detailed solutions.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/new-provider`)
3. Commit your changes (`git commit -am 'Add new provider'`)
4. Push to the branch (`git push origin feature/new-provider`)
5. Create a Pull Request

### Code Standards

- Follow existing code style
- Add tests for new features
- Update documentation
- Ensure all tests pass

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

- **Documentation**: [docs/](docs/) folder
- **Issues**: GitHub Issues
- **Discussions**: GitHub Discussions

## 📚 Related Projects

- [OpenAI API](https://platform.openai.com/docs/api-reference)
- [OpenRouter.ai](https://openrouter.ai/)
- [LiteLLM](https://github.com/BerriAI/litellm)

---

**Built with ❤️ for the AI community**