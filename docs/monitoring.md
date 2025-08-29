# Monitoring and Observability Guide

## Overview

The Model Router provides comprehensive monitoring capabilities including structured logging, Prometheus metrics, health checks, and real-time performance tracking. This guide covers how to monitor, alert on, and troubleshoot issues.

## Metrics and Monitoring

### Prometheus Metrics

Access metrics at `GET /metrics`:

#### HTTP Metrics
```
# Total HTTP requests
http_requests_total{method="POST", route="/v1/chat/completions", status="200"} 245

# HTTP request duration
http_request_duration_ms_bucket{route="/v1/chat/completions", le="1000"} 220
http_request_duration_ms_bucket{route="/v1/chat/completions", le="2000"} 240  
http_request_duration_ms_bucket{route="/v1/chat/completions", le="5000"} 245

# HTTP errors
http_errors_total{route="/v1/chat/completions", error_type="authentication_error"} 5
http_errors_total{route="/v1/chat/completions", error_type="rate_limit_error"} 12
```

#### Provider Metrics
```
# Provider requests
provider_requests_total{provider="groq", status="success"} 180
provider_requests_total{provider="groq", status="failure"} 8
provider_requests_total{provider="google-gemini", status="failure"} 25

# Provider response time
provider_request_duration_ms{provider="groq", quantile="0.5"} 720
provider_request_duration_ms{provider="groq", quantile="0.95"} 1250
provider_request_duration_ms{provider="groq", quantile="0.99"} 2100

# Provider health
provider_health_score{provider="groq"} 0.95
provider_health_score{provider="google-gemini"} 0.15
provider_consecutive_failures{provider="google-gemini"} 8

# Circuit breaker status  
circuit_breaker_state{provider="groq", state="closed"} 1
circuit_breaker_state{provider="google-gemini", state="open"} 1
```

#### Business Metrics
```
# Token usage
tokens_processed_total{provider="groq", type="input"} 125000
tokens_processed_total{provider="groq", type="output"} 87500

# Tenant usage
tenant_requests_total{tenant_id="default"} 180
tenant_requests_total{tenant_id="enterprise"} 65

# Policy usage
routing_policy_usage{policy="balanced"} 200
routing_policy_usage{policy="cost-optimized"} 45
```

### Grafana Dashboard

Example Grafana queries:

#### Request Rate
```promql
rate(http_requests_total[5m])
```

#### Error Rate
```promql
rate(http_errors_total[5m]) / rate(http_requests_total[5m])
```

#### Provider Availability
```promql
provider_health_score
```

#### Response Time P95
```promql  
histogram_quantile(0.95, rate(http_request_duration_ms_bucket[5m]))
```

## Structured Logging

### Log Format

All logs use structured JSON format:

```json
{
  "level": "info",
  "message": "Request authenticated", 
  "timestamp": "2025-08-29T16:20:30.123Z",
  "tenant_id": "default",
  "api_key": "ak-demo1...",
  "correlation_id": "req-12345"
}
```

### Log Levels

- **error**: System errors, provider failures
- **warn**: Rate limits, circuit breaker state changes
- **info**: Request processing, provider selection
- **debug**: Detailed request/response data

### Key Log Messages

#### Authentication
```json
{
  "level": "info",
  "message": "Request authenticated",
  "tenant_id": "default",
  "api_key": "ak-demo1..."
}
```

#### Provider Selection
```json
{
  "level": "info", 
  "message": "Provider selection complete",
  "orderedProviders": ["groq", "google-gemini"],
  "policy": "balanced",
  "availableProviders": ["groq"]
}
```

#### Provider Success
```json
{
  "level": "info",
  "message": "✅ Request completed successfully",
  "provider": "groq",
  "duration": 753
}
```

#### Provider Failure
```json
{
  "level": "error",
  "message": "❌ Provider request failed",
  "provider": "google-gemini",
  "error": "Request failed with status code 429",
  "status": 429,
  "duration": 1205
}
```

#### Circuit Breaker
```json
{
  "level": "warn",
  "message": "Circuit breaker opened for google-gemini",
  "failureCount": 5,
  "nextAttemptTime": "2025-08-29T16:25:30.123Z"
}
```

### Log Aggregation

#### ELK Stack Configuration
```yaml
# filebeat.yml
filebeat.inputs:
- type: log
  paths:
    - /var/log/model-router/*.log
  json.keys_under_root: true
  json.message_key: message

output.elasticsearch:
  hosts: ["elasticsearch:9200"]
```

#### Splunk Configuration
```conf
[model-router]
SHOULD_LINEMERGE = false
KV_MODE = json
category = application
description = Model Router logs
```

## Health Checks

### Service Health

**Endpoint**: `GET /health`

```json
{
  "status": "healthy",
  "timestamp": "2025-08-29T16:20:30.123Z",
  "version": "1.0.0", 
  "uptime": 1234567,
  "providers": {
    "total": 3,
    "healthy": 2,
    "unhealthy": 1
  },
  "memory": {
    "used": 52428800,
    "total": 134217728
  }
}
```

### Provider Health

**Endpoint**: `GET /v1/health/providers` (requires authentication)

```json
{
  "providers": {
    "groq": {
      "status": "healthy",
      "uptime": 0.95,
      "avg_latency": 723,
      "consecutive_failures": 0,
      "last_check": "2025-08-29T16:20:25.456Z"
    },
    "google-gemini": {
      "status": "unhealthy",
      "uptime": 0.12, 
      "avg_latency": 2500,
      "consecutive_failures": 8,
      "last_check": "2025-08-29T16:19:30.123Z",
      "error": "Request failed with status code 429"
    }
  },
  "circuit_breakers": {
    "groq": {
      "state": "closed",
      "failure_count": 0
    },
    "google-gemini": {
      "state": "open", 
      "failure_count": 8,
      "next_attempt_time": "2025-08-29T16:25:30.123Z"
    }
  }
}
```

## Alerting Rules

### Prometheus Alerting Rules

```yaml
groups:
- name: model-router.rules
  rules:
  
  # High error rate
  - alert: HighErrorRate
    expr: rate(http_errors_total[5m]) / rate(http_requests_total[5m]) > 0.05
    for: 2m
    labels:
      severity: warning
    annotations:
      summary: "High error rate detected"
      description: "Error rate is {{ $value | humanizePercentage }}"

  # Provider down
  - alert: ProviderDown
    expr: provider_health_score < 0.5
    for: 5m
    labels:
      severity: critical
    annotations:
      summary: "Provider {{ $labels.provider }} is unhealthy"
      description: "Health score: {{ $value }}"

  # Circuit breaker open
  - alert: CircuitBreakerOpen
    expr: circuit_breaker_state{state="open"} == 1
    for: 1m
    labels:
      severity: warning
    annotations:
      summary: "Circuit breaker open for {{ $labels.provider }}"

  # High latency
  - alert: HighLatency
    expr: histogram_quantile(0.95, rate(http_request_duration_ms_bucket[5m])) > 5000
    for: 3m
    labels:
      severity: warning
    annotations:
      summary: "High response latency detected"
      description: "P95 latency: {{ $value }}ms"

  # Memory usage
  - alert: HighMemoryUsage  
    expr: process_resident_memory_bytes / 1024 / 1024 > 500
    for: 5m
    labels:
      severity: warning
    annotations:
      summary: "High memory usage"
      description: "Memory usage: {{ $value }}MB"
```

### Slack Notifications

```yaml
# alertmanager.yml
route:
  group_by: ['alertname']
  group_wait: 10s
  group_interval: 10s
  repeat_interval: 1h
  receiver: 'web.hook'

receivers:
- name: 'web.hook'
  slack_configs:
  - api_url: 'https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK'
    channel: '#model-router-alerts'
    title: 'Model Router Alert'
    text: '{{ range .Alerts }}{{ .Annotations.summary }}{{ end }}'
```

## Performance Monitoring

### Key Metrics to Monitor

1. **Request Rate**: Requests per second
2. **Error Rate**: Errors per second / total requests  
3. **Response Time**: P50, P95, P99 latencies
4. **Provider Health**: Uptime and availability
5. **Circuit Breaker State**: Open/closed status
6. **Memory/CPU Usage**: Resource consumption
7. **Token Usage**: Cost tracking

### SLA Targets

| Metric | Target | Critical Threshold |
|--------|--------|--------------------|
| Availability | 99.5% | 99.0% |
| P50 Latency | < 1s | > 3s |
| P95 Latency | < 3s | > 10s |
| Error Rate | < 1% | > 5% |
| Provider Uptime | > 95% | < 80% |

### Performance Tuning

#### Optimize Provider Selection
```javascript
// Adjust policy weights for better performance
{
  "routing_policy": "performance-first", // Prioritize speed
  "weights": {
    "cost": 0.1,
    "latency": 0.8,    // Higher weight on latency
    "uptime": 0.1
  }
}
```

#### Tune Health Check Interval
```bash
# Reduce health check frequency to save resources
HEALTH_CHECK_INTERVAL=600000  # 10 minutes
```

#### Connection Pooling
```javascript
// Configure axios for better performance
const axiosInstance = axios.create({
  timeout: 15000,
  maxRedirects: 3,
  httpAgent: new http.Agent({ 
    keepAlive: true,
    maxSockets: 50 
  })
});
```

## Distributed Tracing

### Jaeger Integration

Add tracing to your providers:

```javascript
const opentracing = require('opentracing');

class GroqProvider extends BaseProvider {
  async makeRequest(openAIRequest) {
    const span = opentracing.globalTracer().startSpan('groq_request');
    span.setTag('provider', 'groq');
    span.setTag('model', openAIRequest.model);
    
    try {
      const result = await this.doRequest(openAIRequest);
      span.setTag('success', true);
      return result;
    } catch (error) {
      span.setTag('error', true);
      span.log({ error: error.message });
      throw error;
    } finally {
      span.finish();
    }
  }
}
```

### Request Correlation

Add correlation IDs to track requests across components:

```javascript
// middleware/correlation.js
const { v4: uuidv4 } = require('uuid');

function addCorrelationId(req, res, next) {
  req.correlationId = req.headers['x-correlation-id'] || uuidv4();
  res.setHeader('x-correlation-id', req.correlationId);
  next();
}
```

## Dashboard Examples

### Service Overview Dashboard

```json
{
  "dashboard": {
    "title": "Model Router Overview",
    "panels": [
      {
        "title": "Request Rate",
        "targets": [
          {"expr": "rate(http_requests_total[5m])"}
        ]
      },
      {
        "title": "Error Rate",  
        "targets": [
          {"expr": "rate(http_errors_total[5m]) / rate(http_requests_total[5m])"}
        ]
      },
      {
        "title": "Response Time",
        "targets": [
          {"expr": "histogram_quantile(0.5, rate(http_request_duration_ms_bucket[5m]))", "legendFormat": "P50"},
          {"expr": "histogram_quantile(0.95, rate(http_request_duration_ms_bucket[5m]))", "legendFormat": "P95"}
        ]
      },
      {
        "title": "Provider Health",
        "targets": [
          {"expr": "provider_health_score"}
        ]
      }
    ]
  }
}
```

### Provider Comparison Dashboard

Track provider performance side by side:

```json
{
  "panels": [
    {
      "title": "Provider Response Times",
      "targets": [
        {"expr": "provider_request_duration_ms{provider=\"groq\", quantile=\"0.95\"}", "legendFormat": "Groq P95"},
        {"expr": "provider_request_duration_ms{provider=\"google-gemini\", quantile=\"0.95\"}", "legendFormat": "Google P95"}
      ]
    },
    {
      "title": "Provider Success Rate", 
      "targets": [
        {"expr": "rate(provider_requests_total{provider=\"groq\", status=\"success\"}[5m])", "legendFormat": "Groq Success"},
        {"expr": "rate(provider_requests_total{provider=\"google-gemini\", status=\"success\"}[5m])", "legendFormat": "Google Success"}
      ]
    }
  ]
}
```

## Capacity Planning

### Resource Usage Patterns

Monitor these metrics for capacity planning:

```promql
# Memory usage trend
process_resident_memory_bytes / 1024 / 1024

# CPU usage trend  
rate(process_cpu_seconds_total[5m]) * 100

# Request growth
increase(http_requests_total[1d])

# Provider load distribution
sum by (provider) (rate(provider_requests_total[1h]))
```

### Scaling Indicators

Scale up when:
- P95 latency > 3 seconds consistently
- Error rate > 2% for 5+ minutes
- Memory usage > 80% for 10+ minutes
- CPU usage > 70% for 15+ minutes

Scale out when:
- Request rate > 80% of capacity
- Provider rate limits being hit frequently
- Circuit breakers opening frequently

This monitoring setup provides comprehensive observability into your Model Router deployment, enabling proactive issue detection and performance optimization.