# Lyra production cloud current state - 2026-06-21

This document records the production state before the CloudFront migration. It intentionally excludes passwords, API keys, and other secret values.

## Current application state

- Public app URL: `https://app.lyra-editor.com`
- Current entry point: Route 53 alias `app.lyra-editor.com` -> `lyra-prod-alb-1740988960.ap-northeast-1.elb.amazonaws.com`
- Web delivery: API container serves the built web app and API from the same ALB origin.
- Health check: `GET /healthz` returns `200` with `{"status":"ok","service":"lyra-api"}`.

## AWS account and region

- AWS account: `452284481392`
- Primary region: `ap-northeast-1`
- Route 53 hosted zone: `lyra-editor.com.` (`Z06854141YIQEBHNYPPXP`)
- Name servers:
  - `ns-1785.awsdns-31.co.uk.`
  - `ns-52.awsdns-06.com.`
  - `ns-1109.awsdns-10.org.`
  - `ns-671.awsdns-19.net.`

## ECS

- Cluster: `lyra-prod`
- API service: `lyra-prod-api`
  - Task definition: `lyra-prod-api:17`
  - Desired/running/pending: `1 / 1 / 0`
  - Launch type: Fargate
  - Container port: `3000`
  - Target group: `lyra-prod-api-tg`
  - Public IP assignment: enabled
- Worker service: `lyra-prod-worker`
  - Task definition: `lyra-prod-worker:3`
  - Desired/running/pending: `0 / 0 / 0`
  - Worker is intentionally scaled to zero for cost control.

## Load balancer

- ALB: `lyra-prod-alb`
- Scheme: internet-facing
- DNS: `lyra-prod-alb-1740988960.ap-northeast-1.elb.amazonaws.com`
- Listeners:
  - `80` HTTP -> `301` redirect to HTTPS
  - `443` HTTPS -> forwards to `lyra-prod-api-tg`
- ALB certificate: ACM `ap-northeast-1` certificate for `app.lyra-editor.com`
- Target group:
  - Name: `lyra-prod-api-tg`
  - Protocol: HTTP
  - Port: `3000`
  - Target type: `ip`
  - Health check path: `/healthz`
  - Current target health: healthy

## Security groups

- ALB SG: `sg-015a428abf00b3c81` (`lyra-prod-alb-sg`)
  - Inbound: `80` and `443` from `0.0.0.0/0`
  - Current risk: ALB is directly internet reachable.
- ECS SG: `sg-008747b40bd31fa2c` (`lyra-prod-ecs-sg`)
  - Inbound: `3000` from ALB SG only
  - Outbound: all
- RDS SG: `sg-02a2eefa6c984ba6d` (`lyra-prod-rds-sg`)
  - Inbound: `5432` from ECS SG only
  - Outbound: all

## Database

- DB instance: `lyra-prod-db`
- Engine: PostgreSQL `18.3`
- Instance class: `db.t4g.micro`
- Storage: `20 GiB` gp3
- Multi-AZ: disabled
- Public access: disabled
- Deletion protection: enabled
- Backup retention: 7 days
- Storage encryption: enabled
- DB name: `lyra`
- Endpoint: `lyra-prod-db.cl2cc620cck3.ap-northeast-1.rds.amazonaws.com:5432`

## Storage and queues

- S3 image bucket: `lyra-prod-images-452284481392`
- SQS queues:
  - `lyra-prod-generation`
  - `lyra-prod-generation-dlq`

## Secrets

- App runtime secret: `lyra/prod/app`
  - Current version stage: `AWSCURRENT`
  - Last repaired on 2026-06-21 after a DB password mismatch/invalid JSON incident.
  - Verification: app `DATABASE_URL` username/password matches the RDS managed secret.
- RDS managed secret:
  - Stored in Secrets Manager and referenced by RDS.
  - Secret values are not recorded in this document.

## Current known risks before migration

- ALB is internet-facing and allows `80/443` from the public internet.
- CloudFront is not yet used, so there is no edge caching, managed TLS termination at edge, or simple WAF attachment point.
- API desired count is `1`, so availability is limited during task replacement or AZ impairment.
- Worker desired count is `0`; generation jobs will not process until scaled up.
- ECS tasks still use public IP assignment. This is acceptable for the current simple deployment, but private subnets plus NAT/VPC endpoints should be considered later.

## Two-stage migration plan

### Stage 1: CloudFront front door

Goal: put CloudFront in front of the existing ALB without changing the app runtime path.

Actions:

1. Request/validate an ACM certificate in `us-east-1` for `app.lyra-editor.com`.
2. Create a CloudFront distribution with the ALB as a custom HTTPS origin.
3. Configure behaviors so API and SPA routes keep working:
   - Viewer protocol policy: redirect HTTP to HTTPS
   - Allowed methods: all methods for API compatibility
   - Cache policy: disabled or very short TTL for dynamic app/API paths
   - Origin request policy: forward required headers, query strings, and cookies
4. Verify CloudFront domain directly before DNS cutover.
5. Change Route 53 `app.lyra-editor.com` alias from ALB to CloudFront.
6. Verify login, works list, billing balance, static assets, and `/healthz`.

Rollback:

- Change Route 53 `app.lyra-editor.com` alias back to the ALB DNS name.

### Stage 2: origin hardening

Goal: keep the ALB reachable only through CloudFront.

Actions:

1. Add a CloudFront custom origin header with a generated high-entropy value.
2. Change ALB HTTPS listener rules:
   - Header match -> forward to `lyra-prod-api-tg`
   - Default action -> fixed `403`
3. Restrict ALB SG inbound access to the AWS-managed CloudFront origin-facing prefix list.
4. Remove broad public inbound access to ALB after CloudFront verification.
5. Verify:
   - `https://app.lyra-editor.com/healthz` returns `200`
   - direct ALB access returns blocked/forbidden
   - app login and works list still work

Rollback:

- Restore ALB SG inbound `80/443` from `0.0.0.0/0`.
- Restore ALB HTTPS listener default forward action to `lyra-prod-api-tg`.
- If needed, change Route 53 alias back to ALB.
