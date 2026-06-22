# Lyra CloudFront migration completed - 2026-06-21

This document records the production state after the two-stage CloudFront migration.

## Summary

- `app.lyra-editor.com` now resolves to CloudFront.
- CloudFront uses `origin.lyra-editor.com` as the HTTPS origin.
- `origin.lyra-editor.com` resolves to the existing production ALB.
- The ALB is no longer publicly open to arbitrary internet clients.
- Direct origin access is blocked:
  - Requests without the CloudFront origin guard header return `403` at the ALB listener layer.
  - The ALB security group only allows inbound HTTPS from the AWS-managed CloudFront origin-facing prefix list.

## Current request path

1. User browser
2. `app.lyra-editor.com`
3. CloudFront distribution `E3B8V7G1NPTTMS`
4. HTTPS origin `origin.lyra-editor.com`
5. ALB `lyra-prod-alb`
6. Target group `lyra-prod-api-tg`
7. ECS service `lyra-prod-api`
8. RDS `lyra-prod-db`

## DNS

- `app.lyra-editor.com.`
  - `A` alias -> `d1a1300ysx6i1r.cloudfront.net.`
  - `AAAA` alias -> `d1a1300ysx6i1r.cloudfront.net.`
- `origin.lyra-editor.com.`
  - `A` alias -> `lyra-prod-alb-1740988960.ap-northeast-1.elb.amazonaws.com.`

## CloudFront

- Distribution ID: `E3B8V7G1NPTTMS`
- Domain: `d1a1300ysx6i1r.cloudfront.net`
- Alias: `app.lyra-editor.com`
- Origin: `origin.lyra-editor.com`
- Viewer protocol policy: redirect HTTP to HTTPS
- Cache policy: managed caching disabled
- Origin request policy: managed all viewer except Host header
- Price class: `PriceClass_100`
- Viewer certificate: ACM certificate in `us-east-1` for `app.lyra-editor.com`
- Origin guard header:
  - Header name: `X-Lyra-Origin-Guard`
  - Header value is stored in Secrets Manager as `lyra/prod/cloudfront-origin-guard`
  - The value is intentionally not recorded in this repository.

## ALB hardening

- ALB: `lyra-prod-alb`
- Origin hostname certificate:
  - ACM certificate in `ap-northeast-1` for `origin.lyra-editor.com`
  - Attached to the existing HTTPS listener.
- HTTPS listener rules:
  - Priority `10`: if `X-Lyra-Origin-Guard` matches, forward to `lyra-prod-api-tg`
  - Default: fixed `403`
- ALB security group: `sg-015a428abf00b3c81`
  - Inbound now allows only:
    - TCP `443` from `pl-58a04531`
  - `pl-58a04531` is the AWS-managed prefix list `com.amazonaws.global.cloudfront.origin-facing` in `ap-northeast-1`.
  - Public `0.0.0.0/0` inbound on `80` and `443` has been removed.

## Verification performed

- `https://app.lyra-editor.com/healthz` -> `200`
- `https://app.lyra-editor.com/` -> `200`
- Response headers include CloudFront `Via`.
- `https://d1a1300ysx6i1r.cloudfront.net/healthz` -> `200`
- `https://origin.lyra-editor.com/healthz` without the guard header -> blocked
- ECS API service:
  - Task definition: `lyra-prod-api:18`
  - Runtime platform: `LINUX / ARM64`
  - Desired/running/pending: `1 / 1 / 0`
  - Deployment rollout state: `COMPLETED`
- Worker service:
  - Task definition: `lyra-prod-worker:4`
  - Runtime platform: `LINUX / ARM64`
  - Runtime size: `1 vCPU / 2 GB`
  - Scheduled scaling:
    - `15:00-24:00 JST`: minimum `1`, maximum `1`
    - `00:00-15:00 JST`: minimum `0`, maximum `1`
  - Queue reactive scaling:
    - Scale out to `1` when `lyra-prod-generation` has visible messages.
    - Scale in to `0` after visible + in-flight messages stay at `0` for 15 minutes.
- ALB target group health: healthy
- Latest API logs sampled after cutover contained only `200` statuses.

## Rollback

### Fast rollback to ALB direct

Use this only if CloudFront itself causes user-facing failure.

1. Restore ALB SG public inbound temporarily:
   - TCP `443` from `0.0.0.0/0`
   - TCP `80` from `0.0.0.0/0` if HTTP redirect is required
2. Restore the ALB HTTPS listener default action to forward to `lyra-prod-api-tg`.
3. Change Route 53 `app.lyra-editor.com` `A` alias back to:
   - `lyra-prod-alb-1740988960.ap-northeast-1.elb.amazonaws.com.`
4. Delete or ignore the `AAAA` alias if direct ALB IPv6 is not configured.

### Safer rollback while keeping CloudFront

Use this if only the ALB guard rule or SG restriction is too strict.

1. Keep Route 53 pointing to CloudFront.
2. Temporarily restore ALB SG inbound `443` from `0.0.0.0/0`.
3. Temporarily change ALB listener default action back to forward.
4. Re-apply hardening after identifying the missing behavior.

## Remaining operational notes

- CloudFront is currently configured with disabled caching to avoid breaking auth/API behavior.
- Later cost/performance tuning can add path-specific cache behaviors for immutable static assets.
- WAF is now easier to add at the CloudFront layer, but it was not enabled during this migration to avoid changing request behavior and cost at the same time.
- Low-cost operational guardrails are recorded in `docs/cloud-ops-guardrails-2026-06-21.md`.
- API desired count is still `1`; high availability requires increasing desired count and adding autoscaling.
- Worker uses a cost-balanced schedule: one always-on worker from 15:00 to midnight JST and zero minimum capacity from midnight to 15:00 JST. During the zero-minimum window, SQS queue alarms can still scale the worker up to one task when generation jobs arrive.
