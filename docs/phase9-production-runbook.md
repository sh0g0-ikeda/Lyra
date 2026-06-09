# Phase 9 Production Runbook

## Scope
- CloudWatch alarms
- k6 load tests
- WAF and S3 bucket policy templates
- request ID and rate limiting
- failed page-generation retry flow

## Migrations
- Run `bun run db:check-invariants` before production migrations.
  - It is read-only.
  - If it reports violations, fix the listed rows before running schema migrations.
- Run `bun run migrate` as a one-off deploy task before rolling API tasks.
- Set `AUTO_RUN_MIGRATIONS=false` for production API tasks.
- Keep startup auto-migrations only for local development and short-lived test environments.

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
- generation-cost routes: `10 req/min/user`
  - page generation
  - page/page-story autofill
  - page skeleton generation
  - entity image import/reference generation
  - StoryAI collaborate / episode draft improvement
- ordinary story editing routes: `20 req/min/user`
- default authenticated API: `100 req/min/user`
- Stripe webhook: `120 req/min/IP`

For public webhook IP buckets, forward `CloudFront-Viewer-Address` when the API
is behind CloudFront. If that header is absent, the API falls back to the last
valid `X-Forwarded-For` address, which is the safest application-level fallback
behind an ALB but should not replace WAF rate-based rules.

Headers:
- `X-RateLimit-Limit`
- `X-RateLimit-Remaining`
- `X-RateLimit-Reset`
- `Retry-After` on `429`

Retention:
- Run `bun run admin:prune-rate-limits -- --older-than-hours 24 --max-deletes 1000`
  regularly as dry-run first.
- Add `--apply` after reviewing candidates. The script rechecks `reset_at` during deletion.

## CloudWatch alarms
Use `ops/cloudwatch/alarms.example.json` as the seed definition.

Minimum alarms:
- ALB target 5xx count
- API ECS CPU and memory
- generation worker ECS CPU
- generation queue oldest message age
- generation DLQ visible messages `> 0`

## Security baseline
Use:
- `ops/security/waf-web-acl.example.json`
- `ops/security/s3-images-bucket-policy.example.json`

Minimum posture:
- AWS managed WAF rule groups
- CloudFront-only read for `saved/*`, `session/*`, and `tmp/*`
- CloudFront viewer access for image paths should be protected with signed cookies/URLs or an equivalent authenticated edge policy before paid production
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
npm run worker:retry -- <job-id> <user-id>
```

Behavior:
- only `failed` `page_generate` jobs can be retried
- retry limit is `3`
- retry resets the job to `queued`
- retry immediately re-runs the worker path
