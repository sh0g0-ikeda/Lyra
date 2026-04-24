# Phase 9 Production Runbook

## Scope
- CloudWatch alarms
- k6 load tests
- WAF and S3 bucket policy templates
- request ID and rate limiting
- failed page-generation retry flow

## Request tracing
- Every HTTP response returns `X-Request-Id`
- API request completion is logged as JSON with:
  - `request_id`
  - `method`
  - `path`
  - `status`
  - `duration_ms`
  - `user_id`

## Rate limits
- page generation: `10 req/min/user`
- story routes: `20 req/min/user`
- default authenticated API: `100 req/min/user`

Headers:
- `X-RateLimit-Limit`
- `X-RateLimit-Remaining`
- `X-RateLimit-Reset`
- `Retry-After` on `429`

## CloudWatch alarms
Use `ops/cloudwatch/alarms.example.json` as the seed definition.

Minimum alarms:
- EC2 CPU `> 80%` for 3 periods
- worker Lambda `Errors > 0`
- page generation DLQ visible messages `> 0`
- API 5xx / host health

## Security baseline
Use:
- `ops/security/waf-web-acl.example.json`
- `ops/security/s3-images-bucket-policy.example.json`

Minimum posture:
- AWS managed WAF rule groups
- CloudFront-only read for `saved/*`
- deny insecure transport on S3

## Load tests
Examples:
- `k6 run ops/load/k6-api-rate-limit.js`
- `k6 run ops/load/k6-page-generation.js`

Required env:
- `LYRA_BASE_URL`
- `LYRA_BEARER_TOKEN`
- `LYRA_PAGE_ID` for page-generation test

## Failed job retry
Manual retry:

```bash
npm run worker:retry -- <job-id>
```

Behavior:
- only `failed` `page_generate` jobs can be retried
- retry limit is `3`
- retry resets the job to `queued`
- retry immediately re-runs the worker path
