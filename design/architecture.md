# Model Router - System Architecture

## Table of Contents
- [Overview](#overview)
- [High-Level Architecture](#high-level-architecture)
- [Component Architecture](#component-architecture)
- [Data Flow](#data-flow)
- [Design Patterns](#design-patterns)
- [Scalability](#scalability)
- [Security Architecture](#security-architecture)
- [Performance Considerations](#performance-considerations)

## Overview

The Model Router is a production-grade API gateway designed to intelligently route requests across multiple Large Language Model (LLM) providers. It implements enterprise-level patterns including circuit breakers, health monitoring, multi-tenancy, and intelligent failover.

### Architecture Principles

- **Microservices-Ready**: Layered, loosely coupled components
- **Configuration-Driven**: Minimal code changes for new providers/policies
- **Observable**: Comprehensive logging, metrics, and health monitoring  
- **Resilient**: Circuit breakers, failover, and graceful degradation
- **Secure**: Multi-tenant isolation, rate limiting, input validation

## High-Level Architecture

```
                              ┌─────────────────────────────────────────┐
                              │              Load Balancer               │
                              └─────────────────┬───────────────────────┘
                                                │
                              ┌─────────────────▼───────────────────────┐
                              │           Model Router API               │
                              │         (Express.js Server)              │
                              └─────────────────┬───────────────────────┘
                                                │
                    ┌───────────────────────────┼───────────────────────────┐
                    │                           │                           │
    ┌───────────────▼────────────┐  ┌──────────▼──────────┐  ┌────────────▼──────────┐
    │     Google Gemini API      │  │      Groq API       │  │   HuggingFace API     │
    │                            │  │                     │  │                       │
    │  • Gemini 1.5 Flash       │  │  • Llama3-8B-8192   │  │  • DialoGPT-medium    │
    │  • Rate: 15/min           │  │  • Rate: 30/min     │  │  • Rate: 30/min       │
    └────────────────────────────┘  └─────────────────────┘  └───────────────────────┘

                              ┌─────────────────────────────────────────┐
                              │             Monitoring Stack            │
                              │                                         │
                              │  ┌─────────────┐  ┌─────────────────┐  │
                              │  │ Prometheus  │  │ Winston Logging │  │
                              │  │  Metrics    │  │    (JSON)       │  │
                              │  └─────────────┘  └─────────────────┘  │
                              └─────────────────────────────────────────┘
```

## Component Architecture

### 1. API Layer (`src/api/`)

**Responsibility**: HTTP request handling, middleware orchestration

```
┌─────────────────────────────────────────────┐
│                API Layer                    │
├─────────────────────────────────────────────┤
│                                             │
│  ┌─────────────┐  ┌─────────────────────┐  │
│  │   Routes    │  │     Middleware      │  │
│  │             │  │                     │  │
│  │ • /chat     │  │ • Authentication    │  │
│  │ • /health   │  │ • Rate Limiting     │  │
│  │ • /metrics  │  │ • Request Validation│  │
│  └─────────────┘  │ • Error Handling    │  │
│                   │ • CORS              │  │
│                   └─────────────────────┘  │
└─────────────────────────────────────────────┘
```

**Key Components**:
- **`routes/chat.js`**: OpenAI-compatible chat completions endpoint
- **`middleware/auth.js`**: Multi-tenant API key authentication
- **`middleware/rateLimit.js`**: Tenant-specific rate limiting
- **`middleware/validation.js`**: Request/response validation

### 2. Business Logic Layer (`src/router/`, `src/config/`)

**Responsibility**: Core routing logic, policy engines, configuration management

```
┌─────────────────────────────────────────────────────────────┐
│                    Business Logic Layer                     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────┐ │
│  │  RouterEngine   │  │  PolicyEngine   │  │ ConfigLoader│ │
│  │                 │  │                 │  │             │ │
│  │ • Orchestration │  │ • Provider      │  │ • Providers │ │
│  │ • Provider      │  │   Selection     │  │ • Tenants   │ │
│  │   Management    │  │ • Scoring       │  │ • Policies  │ │
│  │ • Circuit       │  │ • Policies      │  │ • Hot       │ │
│  │   Breakers      │  │                 │  │   Reload    │ │
│  └─────────────────┘  └─────────────────┘  └─────────────┘ │
│                                                             │
│  ┌─────────────────┐  ┌─────────────────────────────────┐  │
│  │ HealthMonitor   │  │        TenantManager            │  │
│  │                 │  │                                 │  │
│  │ • Health Checks │  │ • Multi-tenancy                │  │
│  │ • Metrics       │  │ • Quota Management             │  │
│  │ • Alerting      │  │ • Usage Tracking               │  │
│  └─────────────────┘  └─────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 3. Provider Layer (`src/providers/`)

**Responsibility**: External API integration, response normalization

```
┌─────────────────────────────────────────────────────────────┐
│                     Provider Layer                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│              ┌─────────────────────────────┐               │
│              │        BaseProvider         │               │
│              │                             │               │
│              │ • Common Interface          │               │
│              │ • Health Check Template     │               │
│              │ • Error Handling            │               │
│              └─────────────┬───────────────┘               │
│                            │                               │
│    ┌───────────────────────┼───────────────────────┐       │
│    │                       │                       │       │
│ ┌──▼──────────┐  ┌─────────▼────────┐  ┌─────────▼──────┐ │
│ │   Google    │  │      Groq        │  │  HuggingFace   │ │
│ │  Provider   │  │    Provider      │  │   Provider     │ │
│ │             │  │                  │  │                │ │
│ │ • Gemini    │  │ • Llama3 Models  │  │ • DialoGPT     │ │
│ │   API       │  │ • OpenAI Format  │  │ • Text Gen     │ │
│ │ • Transform │  │ • Fast Inference │  │ • Transform    │ │
│ │   Req/Res   │  │                  │  │   Req/Res      │ │
│ └─────────────┘  └──────────────────┘  └────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### 4. Monitoring Layer (`src/monitoring/`)

**Responsibility**: Observability, metrics collection, alerting

```
┌─────────────────────────────────────────────────────────────┐
│                   Monitoring Layer                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────┐ │
│  │ MetricsCollector│  │ Winston Logger  │  │HealthChecks │ │
│  │                 │  │                 │  │             │ │
│  │ • Prometheus    │  │ • Structured    │  │ • Provider  │ │
│  │   Metrics       │  │   JSON Logs     │  │   Status    │ │
│  │ • Custom        │  │ • Request       │  │ • Circuit   │ │
│  │   Counters      │  │   Tracing       │  │   Breakers  │ │
│  │ • Histograms    │  │ • Error         │  │ • Uptime    │ │
│  │                 │  │   Tracking      │  │   Tracking  │ │
│  └─────────────────┘  └─────────────────┘  └─────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## Data Flow

### 1. Request Processing Flow

```
┌─────────────┐    ┌─────────────────┐    ┌───────────────────┐
│   Client    │───▶│   Middleware    │───▶│   RouterEngine    │
│             │    │                 │    │                   │
│ • API Call  │    │ • Authentication│    │ • Provider        │
│ • API Key   │    │ • Rate Limiting │    │   Selection       │
│ • Request   │    │ • Validation    │    │ • Health Check    │
└─────────────┘    └─────────────────┘    └───────────────────┘
                            │                        │
                            ▼                        ▼
                   ┌─────────────────┐    ┌───────────────────┐
                   │  Error Handler  │    │  PolicyEngine     │
                   │                 │    │                   │
                   │ • Format Error  │    │ • Score Providers │
                   │ • Add Metadata  │    │ • Apply Weights   │
                   │ • Log Details   │    │ • Order Selection │
                   └─────────────────┘    └───────────────────┘
                                                   │
                                                   ▼
                                        ┌───────────────────┐
                                        │ Provider Failover │
                                        │                   │
                                        │ • Try Provider 1  │
                                        │ • Circuit Breaker │
                                        │ • Retry Logic     │
                                        │ • Try Provider 2  │
                                        └───────────────────┘
                                                   │
                                                   ▼
┌─────────────┐    ┌─────────────────┐    ┌───────────────────┐
│  Response   │◀───│  Transform &    │◀───│   Provider API    │
│             │    │   Normalize     │    │                   │
│ • OpenAI    │    │                 │    │ • Make Request    │
│   Format    │    │ • Add Metadata  │    │ • Return Result   │
│ • Metadata  │    │ • Usage Stats   │    │ • Handle Errors   │
└─────────────┘    └─────────────────┘    └───────────────────┘
```

### 2. Provider Selection Algorithm

```
Request Received
       │
       ▼
┌─────────────────┐
│ Load Tenant     │───▶ Get enabled providers
│ Configuration   │     for this tenant
└─────────────────┘
       │
       ▼
┌─────────────────┐
│ Filter          │───▶ • Provider loaded? ✓
│ Available       │     • API key exists? ✓  
│ Providers       │     • Circuit breaker open? ✗
└─────────────────┘
       │
       ▼
┌─────────────────┐
│ Get Health Data │───▶ • Uptime percentage
│ for Providers   │     • Average latency
└─────────────────┘     • Recent failures
       │
       ▼
┌─────────────────┐
│ Apply Routing   │───▶ Policy: "balanced"
│ Policy          │     • Cost weight: 30%
└─────────────────┘     • Latency weight: 40%
       │                • Uptime weight: 30%
       ▼
┌─────────────────┐
│ Calculate       │───▶ Score = (uptime × 0.3) + 
│ Provider Scores │     (latency × 0.4) + (cost × 0.3)
└─────────────────┘
       │
       ▼
┌─────────────────┐
│ Sort by Score   │───▶ [groq: 0.95, google: 0.72, hf: 0.43]
│ (Descending)    │
└─────────────────┘
       │
       ▼
┌─────────────────┐
│ Execute with    │───▶ Try providers in order
│ Failover        │     until one succeeds
└─────────────────┘
```

### 3. Circuit Breaker State Machine

```
                ┌─────────────────┐
                │     CLOSED      │◀──────────────┐
                │                 │               │
                │ • Allow all     │               │
                │   requests      │               │
                │ • Count failures│               │
                └─────────┬───────┘               │
                          │                       │
                          │ failure_count ≥       │
                          │ threshold (5)         │
                          ▼                       │
                ┌─────────────────┐               │
                │      OPEN       │               │
                │                 │               │
                │ • Block all     │               │
                │   requests      │               │
                │ • Wait timeout  │               │
                │   (60 seconds)  │               │
                └─────────┬───────┘               │
                          │                       │
                          │ timeout              │
                          │ expired              │
                          ▼                       │
                ┌─────────────────┐               │
                │   HALF-OPEN     │               │
                │                 │               │
                │ • Allow single  │ success       │
                │   test request  │───────────────┘
                │ • Monitor result│
                └─────────┬───────┘
                          │
                          │ failure
                          ▼
                     [Back to OPEN]
```

## Design Patterns

### 1. Adapter Pattern
**Provider Normalization**: Each provider implements the `BaseProvider` interface, normalizing different API formats to a common structure.

```javascript
class BaseProvider {
  async makeRequest(openAIRequest) { /* Abstract */ }
  async healthCheck() { /* Abstract */ }
  transformRequest(request) { /* Abstract */ }
  transformResponse(response) { /* Abstract */ }
}

class GroqProvider extends BaseProvider {
  async makeRequest(openAIRequest) {
    // Transform to Groq format
    // Make API call
    // Transform response to OpenAI format
  }
}
```

### 2. Strategy Pattern
**Policy Engine**: Different routing strategies can be swapped without changing the core logic.

```javascript
class PolicyEngine {
  selectProviders(providers, healthData, policyName) {
    switch(policyName) {
      case 'cost-optimized': return this.selectByCost(providers, healthData);
      case 'performance-first': return this.selectByLatency(providers, healthData);
      case 'balanced': return this.selectByScore(providers, healthData);
    }
  }
}
```

### 3. Circuit Breaker Pattern
**Fault Tolerance**: Automatically disable failing providers to prevent cascade failures.

### 4. Factory Pattern
**Provider Creation**: Dynamic provider instantiation based on configuration.

```javascript
getProviderClass(type) {
  const providerMapping = {
    'google': GoogleProvider,
    'groq': GroqProvider,
    'huggingface': HuggingFaceProvider
  };
  return providerMapping[type];
}
```

### 5. Singleton Pattern
**Shared Resources**: RouterEngine and monitoring components maintain single instances.

## Scalability

### Horizontal Scaling
- **Stateless Design**: No session state stored in memory
- **Configuration Externalization**: JSON configs can be shared across instances
- **Load Balancer Ready**: Multiple instances can run behind a load balancer

### Vertical Scaling
- **Async Processing**: Non-blocking I/O for all provider calls
- **Connection Pooling**: Efficient HTTP connection management
- **Memory Management**: Bounded caches with TTL expiration

### Performance Optimizations
- **Provider Response Caching**: Cache responses for identical requests (configurable)
- **Health Check Batching**: Group health checks to reduce overhead
- **Metrics Aggregation**: Batch metrics updates

### Scaling Bottlenecks
1. **Provider Rate Limits**: Mitigated by multiple providers and intelligent routing
2. **Memory Usage**: Circuit breaker state and health data (bounded by provider count)
3. **Network Latency**: Minimized by provider selection optimization

## Security Architecture

### 1. Authentication & Authorization
```
┌─────────────┐    ┌─────────────────┐    ┌───────────────────┐
│   Request   │───▶│  API Key Auth   │───▶│   Tenant Lookup   │
│             │    │                 │    │                   │
│ Bearer      │    │ • Extract Key   │    │ • Load Tenant     │
│ ak-demo123  │    │ • Validate      │    │ • Check Enabled   │
└─────────────┘    └─────────────────┘    └───────────────────┘
                            │                        │
                            ▼                        ▼
                   ┌─────────────────┐    ┌───────────────────┐
                   │  Return 401     │    │  Attach to        │
                   │  if Invalid     │    │  Request Context  │
                   └─────────────────┘    └───────────────────┘
```

### 2. Multi-Tenant Isolation
- **API Key Scoping**: Each tenant has unique API keys
- **Provider Access Control**: Tenants can only access their configured providers  
- **Quota Enforcement**: Per-tenant rate limits and usage tracking
- **Data Isolation**: No cross-tenant data leakage

### 3. Input Validation
- **Schema Validation**: Joi schemas for all request inputs
- **Sanitization**: Clean user inputs before processing
- **Size Limits**: Prevent oversized requests
- **Content Filtering**: Block malicious content

### 4. Security Headers
```javascript
// Helmet.js configuration
app.use(helmet({
  contentSecurityPolicy: { /* ... */ },
  hsts: { maxAge: 31536000 },
  noSniff: true,
  frameguard: { action: 'deny' }
}));
```

### 5. Secrets Management
- **Environment Variables**: API keys stored as env vars
- **No Hardcoded Secrets**: All sensitive data externalized
- **Key Rotation**: Support for dynamic key updates
- **Logging Safety**: Sensitive data never logged

## Performance Considerations

### Response Time Targets
- **P50**: < 1 second
- **P95**: < 3 seconds  
- **P99**: < 5 seconds

### Throughput Targets
- **Concurrent Requests**: 100+ per instance
- **RPS**: 50+ requests per second per instance

### Memory Usage
- **Base Memory**: ~50MB per instance
- **Per Provider**: ~1MB (health data, circuit breaker state)
- **Per Tenant**: ~100KB (configuration cache, usage stats)

### Monitoring Metrics
- **Request Latency**: Histogram by provider and endpoint
- **Error Rates**: Counter by error type and provider
- **Provider Health**: Gauge for uptime and availability
- **Circuit Breaker State**: Gauge for each provider
- **Memory Usage**: Process memory consumption
- **CPU Usage**: Process CPU utilization

### Optimization Strategies
1. **Provider Selection**: Choose fastest available provider
2. **Request Timeouts**: Fail fast on slow providers
3. **Connection Reuse**: HTTP keep-alive for provider connections
4. **Async Processing**: Non-blocking I/O throughout
5. **Efficient Serialization**: Fast JSON parsing and generation

---

This architecture provides a solid foundation for a production-ready AI model router with enterprise-level reliability, security, and performance characteristics.