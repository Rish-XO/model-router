# Troubleshooting Guide

## Common Issues and Solutions

### Authentication Issues

#### 1. Invalid API Key Error

**Error**: `{"error": {"message": "Invalid API key provided", "type": "authentication_error"}}`

**Causes**:
- API key not configured in tenant configuration
- Malformed Authorization header
- API key doesn't exist in any tenant

**Solutions**:

1. **Check tenant configuration**:
   ```bash
   # Verify API key exists in tenant config
   cat config/tenants/default.json
   ```

2. **Verify request format**:
   ```bash
   # Correct format
   curl -H "Authorization: Bearer ak-demo123" http://localhost:3000/v1/chat/completions
   
   # Wrong formats
   curl -H "Authorization: ak-demo123"  # Missing "Bearer"
   curl -H "Authorization: Bearer ak-demo 123"  # Extra space
   ```

3. **Check tenant loading**:
   ```bash
   # Look for tenant loading errors in logs
   grep "Failed to load tenant" logs/app.log
   ```

#### 2. Missing Authorization Header

**Error**: `{"error": {"message": "Authorization header required", "type": "authentication_error"}}`

**Solution**: Always include the Authorization header:
```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer ak-demo123" \
  -H "Content-Type: application/json" \
  -d '{"model": "gpt-3.5-turbo", "messages": [{"role": "user", "content": "Hello"}]}'
```

### Rate Limiting Issues

#### 1. Rate Limit Exceeded

**Error**: `{"error": {"message": "Rate limit exceeded. Maximum 60 requests per minute per tenant.", "type": "rate_limit_error"}}`

**Solutions**:

1. **Check current rate limits**:
   ```bash
   # View tenant quotas
   cat config/tenants/default.json | grep -A5 quotas
   ```

2. **Adjust rate limits**:
   ```json
   // config/tenants/default.json
   {
     "quotas": {
       "rate_limit_per_minute": 100  // Increase from 60
     }
   }
   ```

3. **Monitor rate limit usage**:
   ```bash
   curl -H "Authorization: Bearer ak-demo123" \
     http://localhost:3000/v1/health/providers
   ```

#### 2. Daily Quota Exceeded

**Error**: `{"error": {"message": "Daily quota exceeded. Limit: 1000, Used: 1000", "type": "quota_exceeded"}}`

**Solutions**:

1. **Reset quota manually** (development only):
   - Restart the service to reset in-memory usage tracking
   
2. **Increase daily quota**:
   ```json
   // config/tenants/default.json
   {
     "quotas": {
       "daily_requests": 5000  // Increase from 1000
     }
   }
   ```

### Provider Issues

#### 1. All Providers Failed

**Error**: `{"error": {"message": "All providers failed. Attempted: groq, google-gemini", "type": "bad_gateway"}}`

**Debugging Steps**:

1. **Check provider health**:
   ```bash
   curl -H "Authorization: Bearer ak-demo123" \
     http://localhost:3000/v1/health/providers
   ```

2. **Check provider API keys**:
   ```bash
   # Verify environment variables are set
   echo $GROQ_API_KEY
   echo $GOOGLE_API_KEY
   
   # Check in .env file
   grep "API_KEY" .env
   ```

3. **Test individual providers manually**:
   ```bash
   # Test Groq directly
   curl -X POST https://api.groq.com/openai/v1/chat/completions \
     -H "Authorization: Bearer $GROQ_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"model": "llama3-8b-8192", "messages": [{"role": "user", "content": "Hello"}]}'
   ```

4. **Check circuit breaker status**:
   - Look for "Circuit breaker opened" messages in logs
   - Wait for circuit breaker timeout (60 seconds by default)

#### 2. Provider Authentication Errors

**Error**: Provider returns 401/403 status codes

**Solutions**:

1. **Verify API keys are valid**:
   - Check that API keys haven't expired
   - Ensure API keys have correct permissions
   - Test API keys directly with provider APIs

2. **Check API key format**:
   ```bash
   # Groq API keys start with "gsk_"
   # Google API keys are typically 39 characters
   # HuggingFace tokens start with "hf_"
   ```

3. **Update environment variables**:
   ```bash
   # .env
   GROQ_API_KEY=gsk_your_new_key_here
   GOOGLE_API_KEY=your_new_google_key_here
   ```

#### 3. Provider Rate Limiting

**Error**: Provider returns 429 status codes

**Solutions**:

1. **Check provider rate limits in logs**:
   ```bash
   grep "429" logs/app.log
   ```

2. **Adjust health check frequency**:
   ```bash
   # .env - reduce health check frequency  
   HEALTH_CHECK_INTERVAL=600000  # 10 minutes instead of 5
   ```

3. **Wait for rate limit reset**:
   - Most providers reset limits every minute/hour
   - Circuit breaker will automatically retry after timeout

### Performance Issues

#### 1. Slow Response Times

**Symptoms**: P95 latency > 5 seconds

**Debugging**:

1. **Check provider selection**:
   ```bash
   # Look for provider selection logs
   grep "Provider selection complete" logs/app.log | tail -10
   ```

2. **Check individual provider latencies**:
   ```bash
   # Check routing metadata in responses
   curl -X POST http://localhost:3000/v1/chat/completions \
     -H "Authorization: Bearer ak-demo123" \
     -H "Content-Type: application/json" \
     -d '{"model": "gpt-3.5-turbo", "messages": [{"role": "user", "content": "Hello"}]}' \
     | jq '.routing_metadata'
   ```

3. **Monitor provider health**:
   ```bash
   curl -H "Authorization: Bearer ak-demo123" \
     http://localhost:3000/v1/health/providers | jq '.providers'
   ```

**Solutions**:

1. **Switch to performance-first policy**:
   ```json
   // config/tenants/default.json
   {
     "providers": {
       "routing_policy": "performance-first"
     }
   }
   ```

2. **Disable slow providers temporarily**:
   ```json
   // config/providers.json
   {
     "slow-provider": {
       "enabled": false
     }
   }
   ```

3. **Reduce request timeouts**:
   ```javascript
   // Reduce timeout in provider implementation
   timeout: 10000  // 10 seconds instead of 15
   ```

#### 2. Memory Leaks

**Symptoms**: Memory usage continuously increasing

**Debugging**:

1. **Monitor memory usage**:
   ```bash
   # Check process memory
   ps aux | grep node
   
   # Check heap usage in logs
   grep "memory" logs/app.log
   ```

2. **Check for unbounded caches**:
   - Circuit breaker state accumulation
   - Health data history growth
   - Rate limit store size

**Solutions**:

1. **Restart service periodically**:
   ```bash
   # Add to cron for temporary fix
   0 2 * * * systemctl restart model-router
   ```

2. **Review cache configurations**:
   - Ensure health history is bounded (current limit: 100 entries)
   - Verify rate limit store cleanup is working

### Configuration Issues

#### 1. Provider Not Loading

**Error**: `Unknown provider type: newprovider`

**Solutions**:

1. **Check provider type registration**:
   ```javascript
   // src/router/RouterEngine.js
   const providerMapping = {
     'newprovider': require('../providers/NewProvider')  // Add this
   };
   ```

2. **Verify provider class exists**:
   ```bash
   ls src/providers/NewProvider.js
   ```

3. **Check for syntax errors**:
   ```bash
   node -c src/providers/NewProvider.js
   ```

#### 2. Configuration File Errors

**Error**: `Failed to load provider config`

**Solutions**:

1. **Validate JSON syntax**:
   ```bash
   # Check JSON validity
   cat config/providers.json | jq .
   cat config/tenants/default.json | jq .
   ```

2. **Check file permissions**:
   ```bash
   ls -la config/providers.json
   ls -la config/tenants/
   ```

3. **Verify file paths**:
   - Ensure config files exist in correct locations
   - Check that Docker volumes are mounted correctly (if using Docker)

### Network Issues

#### 1. Connection Timeouts

**Error**: `Request timeout after 15000ms`

**Solutions**:

1. **Check network connectivity**:
   ```bash
   # Test provider endpoints directly
   curl -I https://api.groq.com/openai/v1/chat/completions
   curl -I https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent
   ```

2. **Check DNS resolution**:
   ```bash
   nslookup api.groq.com
   nslookup generativelanguage.googleapis.com
   ```

3. **Adjust timeout settings**:
   ```javascript
   // Increase timeout in provider
   timeout: 30000  // 30 seconds
   ```

#### 2. SSL/TLS Issues

**Error**: `UNABLE_TO_VERIFY_LEAF_SIGNATURE`

**Solutions**:

1. **Update Node.js and certificates**:
   ```bash
   npm update
   ```

2. **Check system certificates**:
   ```bash
   # On Ubuntu/Debian
   sudo apt-get update && sudo apt-get install ca-certificates
   ```

3. **Temporarily disable SSL verification** (development only):
   ```javascript
   process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
   ```

### Docker Issues

#### 1. Container Won't Start

**Common Causes**:
- Missing environment variables
- Port conflicts
- Volume mount issues

**Solutions**:

1. **Check Docker logs**:
   ```bash
   docker logs model-router
   ```

2. **Verify environment variables**:
   ```bash
   # Check .env file exists and has correct values
   docker run --rm model-router env | grep API_KEY
   ```

3. **Check port availability**:
   ```bash
   # Ensure port 3000 is available
   netstat -tlnp | grep :3000
   ```

#### 2. Volume Mount Issues

**Error**: Configuration files not found in container

**Solutions**:

1. **Verify volume mounts**:
   ```bash
   docker inspect model-router | grep -A5 Mounts
   ```

2. **Check file paths**:
   ```bash
   # Ensure config files exist on host
   ls -la config/
   ```

## Debugging Tools

### 1. Debug Logging

Enable detailed logging:

```bash
# Set debug log level
LOG_LEVEL=debug npm run dev

# Or with Docker
docker run -e LOG_LEVEL=debug model-router
```

### 2. Health Check Script

Create a comprehensive health check:

```bash
#!/bin/bash
# health-check.sh

echo "=== Model Router Health Check ==="

echo "1. Service Health:"
curl -s http://localhost:3000/health | jq .

echo -e "\n2. Provider Health:"
curl -s -H "Authorization: Bearer ak-demo123" \
  http://localhost:3000/v1/health/providers | jq .

echo -e "\n3. Test Request:"
curl -s -X POST http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer ak-demo123" \
  -H "Content-Type: application/json" \
  -d '{"model": "gpt-3.5-turbo", "messages": [{"role": "user", "content": "Test"}]}' \
  | jq '.routing_metadata'

echo -e "\n4. Metrics:"
curl -s http://localhost:3000/metrics | grep -E "(http_requests_total|provider_health_score)"
```

### 3. Log Analysis

Useful log analysis commands:

```bash
# Find authentication errors
grep "authentication_error" logs/app.log

# Check provider failures  
grep "Provider.*failed" logs/app.log

# Monitor circuit breaker events
grep "Circuit breaker" logs/app.log

# Track request processing times
grep "total_processing_time" logs/app.log | tail -20

# Find rate limit violations
grep "Rate limit exceeded" logs/app.log
```

### 4. Performance Profiling

Monitor performance metrics:

```bash
# Monitor response times
curl -s http://localhost:3000/metrics | grep http_request_duration_ms

# Check provider selection efficiency
grep "Provider selection complete" logs/app.log | 
  awk '{print $NF}' | sort | uniq -c

# Monitor memory usage
ps aux | grep node | awk '{print $6/1024 "MB"}'
```

## Getting Help

### 1. Collect Diagnostic Information

Before requesting help, collect:

```bash
# System information
node --version
npm --version
cat /etc/os-release

# Service status
curl http://localhost:3000/health

# Recent logs (last 100 lines)
tail -100 logs/app.log

# Configuration
cat config/providers.json | jq .
cat config/tenants/default.json | jq .

# Environment variables (sanitized)
env | grep -E "(PORT|NODE_ENV|LOG_LEVEL)" | sort
```

### 2. Enable Verbose Logging

Temporarily enable maximum logging:

```bash
LOG_LEVEL=debug npm run dev 2>&1 | tee debug.log
```

### 3. Minimal Reproduction

Create minimal test case:

```bash
# Test with single provider
# Minimal request payload
# Isolated environment
```

### 4. Check Known Issues

Common issues and workarounds:

1. **Windows Path Issues**: Use forward slashes in config paths
2. **Port Conflicts**: Change PORT environment variable  
3. **Memory Limits**: Increase Node.js heap size with `--max-old-space-size=4096`
4. **Certificate Issues**: Update Node.js to latest LTS version

This troubleshooting guide covers the most common issues encountered with the Model Router. For additional support, refer to the logs, health endpoints, and metrics for detailed diagnostic information.