# Model Router API Reference

## Overview

The Model Router provides an OpenAI-compatible API for accessing multiple LLM providers through a single endpoint. All responses include routing metadata showing which provider was used and performance statistics.

## Base URL

```
http://localhost:3000
```

## Authentication

All API requests require authentication using API keys in the Authorization header:

```http
Authorization: Bearer <api-key>
```

Default API key for testing: `ak-demo123`

## Endpoints

### Chat Completions

Create a chat completion using intelligent provider routing.

**Endpoint**: `POST /v1/chat/completions`

**Headers**:
```http
Content-Type: application/json
Authorization: Bearer <api-key>
```

**Request Body**:
```json
{
  "model": "gpt-3.5-turbo",
  "messages": [
    {
      "role": "user", 
      "content": "Hello, how are you?"
    }
  ],
  "max_tokens": 100,
  "temperature": 0.7,
  "stream": false
}
```

**Parameters**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `model` | string | Yes | Model identifier (OpenAI format) |
| `messages` | array | Yes | Array of message objects |
| `max_tokens` | integer | No | Maximum tokens in response (default: 1024) |
| `temperature` | number | No | Sampling temperature 0-2 (default: 0.7) |
| `stream` | boolean | No | Stream response (default: false) |

**Message Object**:
```json
{
  "role": "user|assistant|system",
  "content": "Message content"
}
```

**Response**:
```json
{
  "id": "chatcmpl-9c78c573-844b-4e4e-913b-b7f6c145772d",
  "object": "chat.completion",
  "created": 1756484184,
  "model": "llama3-8b-8192",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Hello! I'm doing well, thank you for asking. How can I help you today?"
      },
      "logprobs": null,
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 12,
    "completion_tokens": 18,
    "total_tokens": 30
  },
  "routing_metadata": {
    "primary_provider": "groq",
    "attempts": [
      {
        "provider": "groq",
        "status": "success", 
        "duration": 753
      }
    ],
    "total_processing_time": 753,
    "policy_used": "intelligent_routing",
    "api_processing_time": 761,
    "timestamp": "2025-08-29T16:16:25.605Z",
    "tenant_id": "default"
  }
}
```

**Response Fields**:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique completion ID |
| `object` | string | Object type ("chat.completion") |
| `created` | integer | Unix timestamp |
| `model` | string | Model used by provider |
| `choices[].message.role` | string | Response role ("assistant") |
| `choices[].message.content` | string | Generated response text |
| `choices[].finish_reason` | string | Reason completion finished |
| `usage.prompt_tokens` | integer | Tokens in input |
| `usage.completion_tokens` | integer | Tokens in output |
| `usage.total_tokens` | integer | Total tokens used |
| `routing_metadata.primary_provider` | string | Provider that handled request |
| `routing_metadata.attempts` | array | All provider attempts made |
| `routing_metadata.total_processing_time` | integer | Time spent on request (ms) |
| `routing_metadata.policy_used` | string | Routing policy applied |

### Health Check

Check the overall health of the service.

**Endpoint**: `GET /health`

**Response**:
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
  }
}
```

### Provider Health

Get detailed health information for all providers.

**Endpoint**: `GET /v1/health/providers`

**Headers**:
```http
Authorization: Bearer <api-key>
```

**Response**:
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
      "last_check": "2025-08-29T16:19:30.123Z"
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

### Metrics

Get Prometheus-compatible metrics.

**Endpoint**: `GET /metrics`

**Response**: Plain text Prometheus format
```
# HELP http_requests_total Total HTTP requests
# TYPE http_requests_total counter
http_requests_total{method="POST",route="/v1/chat/completions",status="200"} 42

# HELP provider_requests_total Total provider requests  
# TYPE provider_requests_total counter
provider_requests_total{provider="groq",status="success"} 38
provider_requests_total{provider="groq",status="failure"} 2

# HELP provider_request_duration_ms Provider request duration
# TYPE provider_request_duration_ms histogram
provider_request_duration_ms_bucket{provider="groq",le="500"} 20
provider_request_duration_ms_bucket{provider="groq",le="1000"} 35
provider_request_duration_ms_bucket{provider="groq",le="2000"} 40
```

## Error Responses

All errors follow a consistent format:

```json
{
  "error": {
    "message": "Human readable error message",
    "type": "error_type",
    "details": {
      "additional": "context"
    }
  }
}
```

### Error Types

| Status Code | Error Type | Description |
|-------------|------------|-------------|
| 400 | `invalid_request` | Malformed request body |
| 401 | `authentication_error` | Missing or invalid API key |
| 429 | `rate_limit_error` | Rate limit exceeded |
| 429 | `quota_exceeded` | Daily quota exceeded |
| 502 | `bad_gateway` | All providers failed |
| 503 | `service_unavailable` | No providers available |

### Example Error Responses

**Invalid API Key**:
```json
{
  "error": {
    "message": "Invalid API key provided",
    "type": "authentication_error"
  }
}
```

**Rate Limited**:
```json
{
  "error": {
    "message": "Rate limit exceeded. Maximum 60 requests per minute per tenant.",
    "type": "rate_limit_error"
  }
}
```

**All Providers Failed**:
```json
{
  "error": {
    "message": "All providers failed. Attempted: groq, google-gemini",
    "type": "bad_gateway",
    "details": {
      "attempts": [
        {
          "provider": "groq",
          "status": "failed",
          "error": "Request timeout after 15000ms",
          "duration": 15001
        },
        {
          "provider": "google-gemini", 
          "status": "failed",
          "error": "Request failed with status code 429",
          "duration": 1205
        }
      ],
      "providers_attempted": 2,
      "processing_time_ms": 16206
    }
  }
}
```

## Rate Limits

Rate limits are enforced per tenant:

- **Default Tenant**: 60 requests/minute, 1000 requests/day
- **Enterprise Tenant**: 500 requests/minute, 250,000 requests/month

Rate limit headers are included in responses:
```http
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 59
X-RateLimit-Reset: 1756484240
```

## Usage Examples

### cURL

```bash
# Basic chat completion
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ak-demo123" \
  -d '{
    "model": "gpt-3.5-turbo",
    "messages": [
      {"role": "user", "content": "Explain quantum computing"}
    ],
    "max_tokens": 500
  }'

# Health check
curl http://localhost:3000/health

# Provider status (requires auth)
curl -H "Authorization: Bearer ak-demo123" \
  http://localhost:3000/v1/health/providers
```

### JavaScript/Node.js

```javascript
const axios = require('axios');

const client = axios.create({
  baseURL: 'http://localhost:3000',
  headers: {
    'Authorization': 'Bearer ak-demo123',
    'Content-Type': 'application/json'
  }
});

async function chatCompletion(message) {
  try {
    const response = await client.post('/v1/chat/completions', {
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: message }]
    });
    
    console.log('Response:', response.data.choices[0].message.content);
    console.log('Provider:', response.data.routing_metadata.primary_provider);
    console.log('Duration:', response.data.routing_metadata.total_processing_time, 'ms');
    
  } catch (error) {
    console.error('Error:', error.response.data);
  }
}

chatCompletion('Hello, world!');
```

### Python

```python
import requests

class ModelRouterClient:
    def __init__(self, base_url='http://localhost:3000', api_key='ak-demo123'):
        self.base_url = base_url
        self.headers = {
            'Authorization': f'Bearer {api_key}',
            'Content-Type': 'application/json'
        }
    
    def chat_completion(self, message, model='gpt-3.5-turbo', max_tokens=100):
        response = requests.post(
            f'{self.base_url}/v1/chat/completions',
            headers=self.headers,
            json={
                'model': model,
                'messages': [{'role': 'user', 'content': message}],
                'max_tokens': max_tokens
            }
        )
        return response.json()
    
    def health_check(self):
        response = requests.get(f'{self.base_url}/health')
        return response.json()

# Usage
client = ModelRouterClient()
result = client.chat_completion('What is machine learning?')
print(f"Response: {result['choices'][0]['message']['content']}")
print(f"Provider: {result['routing_metadata']['primary_provider']}")
```

## Integration with Existing Apps

### OpenAI SDK Compatibility

The Model Router is compatible with OpenAI SDKs by changing the base URL:

**JavaScript**:
```javascript
const { Configuration, OpenAIApi } = require('openai');

const configuration = new Configuration({
  apiKey: 'ak-demo123',
  basePath: 'http://localhost:3000/v1'
});
const openai = new OpenAIApi(configuration);

const response = await openai.createChatCompletion({
  model: 'gpt-3.5-turbo',
  messages: [{ role: 'user', content: 'Hello!' }]
});
```

**Python**:
```python
import openai

openai.api_key = 'ak-demo123' 
openai.api_base = 'http://localhost:3000/v1'

response = openai.ChatCompletion.create(
  model='gpt-3.5-turbo',
  messages=[{'role': 'user', 'content': 'Hello!'}]
)
```

### LangChain Integration

```python
from langchain.llms import OpenAI

llm = OpenAI(
    openai_api_key='ak-demo123',
    openai_api_base='http://localhost:3000/v1'
)

response = llm('What is the capital of France?')
```

## Best Practices

1. **Error Handling**: Always handle provider failures gracefully
2. **Timeout Management**: Set appropriate request timeouts  
3. **Rate Limit Respect**: Monitor rate limit headers and back off when needed
4. **Monitoring**: Track routing metadata for performance insights
5. **Key Rotation**: Regularly rotate API keys for security
6. **Provider Diversity**: Configure multiple providers for better availability

## Performance Tips

1. **Reuse Connections**: Use HTTP keep-alive for better performance
2. **Batch Requests**: Group related requests when possible
3. **Cache Responses**: Cache responses for identical requests (if appropriate)
4. **Monitor Latency**: Use routing metadata to identify slow providers
5. **Circuit Breaker Awareness**: Check provider health before making requests