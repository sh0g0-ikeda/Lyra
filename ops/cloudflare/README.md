# Cloudflare ingress migration

Status: **prepared, not deployed** (2026-10-30 JST). This directory never enables a
route, changes DNS, registers an ECS task, or deletes an ALB merely by being built.
The user has authorized the migration; account authentication and acceptance checks
are outstanding. Do not describe preparation as realized savings.

## Scope and invariants

Replace the public ALB ingress with a Cloudflare Worker route and outbound Tunnel.
Keep Cognito, PostgreSQL, S3, SQS, the API and generation worker in AWS. Keep the
public URL `https://app.lyra-editor.com`, Cognito callbacks, bearer authentication,
Stripe signature verification, asynchronous job contracts and credits unchanged.

The observed production API is `lyra-prod-api:147`, two ARM64 tasks in Tokyo AZs
1c/1d (256 CPU / 512 MiB each). Its immutable image is:

```text
452284481392.dkr.ecr.ap-northeast-1.amazonaws.com/lyra-prod-api@sha256:20caa956ab25ac973446dbbf1e3f7cc5036f4b962cfa47a2fae2433f7e81b051
```

Generation worker revision 89 is outside this rollout. Repository `main` is not
the complete deployed application: **do not rebuild/redeploy the API from this
checkout**. Refresh the live task definition, compare the expected image, and
apply the additive sidecar plan to that definition only.

The Worker replaces visitor origin-guard/address headers. It only trusts the
Cloudflare platform IP at a public Worker route, never an arbitrary upstream
proxy. A missing origin secret fails closed. There is no mutation retry, response
buffering, early success status or authenticated response cache. Debug headers,
credentials and request bodies must never be logged.

Exactly five public documents continue through CloudFront's existing S3 OAC:

```text
/.well-known/assetlinks.json
/privacy.html
/terms.html
/support.html
/legal.css
```

Their requests contain only allowlisted public headers. `/assets/*` and every
other path go through the Tunnel to the existing API. S3 presigned image delivery
and its ownership/expiry checks are not changed.

## Prerequisites

- An authenticated Cloudflare account with access to the intended zone, Workers
  scripts/routes, DNS and Tunnel management. Wrangler OAuth alone may not grant
  DNS editing or Tunnel administration; verify actual permissions before writes.
  Use the official authorization flow / OS credential store or a locally supplied
  scoped token. Never place tokens in chat, Git, commands, plans or logs.
- `lyra-editor.com` is registered through XServer / Star Domain. Public authoritative
  DNS is currently Route 53; public RDAP reports no signed delegation. Free full
  DNS onboarding requires a registrar nameserver update. A partial CNAME zone is
  a Business/Enterprise feature: do not purchase it implicitly.
- Back up all Route 53 records, CloudFront distribution config/ETag, ALB/listeners/
  target groups, ECS service/task definitions, scaling settings and security groups.
  Store private receipts outside Git; secret values must be redacted.
- Pin an official cloudflared ARM64 container by digest and verify its manifest
  includes Linux ARM64. `cloudflared-image.json` records the verified official
  release/index/ARM64 digests; refresh and verify it before a future rollout.
  The release tag alone is insufficient. Assess Worker
  request/CPU limits and billing before attaching production traffic.

## Local checks and plans

```sh
node node_modules/typescript/bin/tsc -p ops/cloudflare/tsconfig.json
npm test -- tests/unit/ops/cloudflareIngress.test.ts tests/unit/middleware/originGuard.test.ts tests/unit/middleware/rateLimit.test.ts
python -B -m unittest discover -s tests/unit/ops -p 'test_*.py' -v
```

`build_dns_only_plan` accepts a Route 53 record array; the `dns_zone_plan.py` CLI
accepts the saved preflight envelope. Use `--help` for local input/output arguments. It produces DNS-only payloads,
never an API call. The October 30 snapshot has 19 source sets: omit the two apex
authority sets, coalesce equivalent Alias A/AAAA pairs, and retain coverage in
15 Cloudflare records. Preserve SPF, DKIM, DMARC, MAIL FROM MX/TXT, ACM validation,
staging and origin names. Unsupported routing or a CNAME conflict must block import.

`ecs_tunnel_task.py --help` describes the local task-plan CLI. Provide the refreshed
AWS response, exact expected API image, pinned cloudflared image, same-account
Secrets Manager token ARN, log group and region. The result contains a registration
payload plus capacity/drain/connector gates. It does not call AWS. Preserve existing
task roles, environment, secrets, image, ports, volumes and size. Execution-role
access to the single new token secret must be checked separately.

## Ordered rollout

1. Create/verify the Cloudflare zone and import **DNS-only** candidate records.
   At this stage `app` still resolves to the existing CloudFront origin. Compare
   every supported source record with the destination; verify SES and ACM records
   against both authoritative servers. Keep the Route 53 zone and its rollback
   data. Change registrar NS only after this comparison passes. Wait for an active
   Cloudflare zone and verified external DNS; do not guess assigned nameservers.
2. Create a remotely managed Tunnel, with explicit public host entries for `app`
   and `lyra-tunnel-canary.lyra-editor.com` to `http://127.0.0.1:3000`, followed by
   `http_status:404`. Keep metrics on `127.0.0.1:2000`; do not publish that port.
   Confirm required outbound TCP 7844 for HTTP/2 without opening API inbound access.
3. Store the Tunnel token in a dedicated AWS Secrets Manager secret. Inject only
   its ARN as ECS `TUNNEL_TOKEN`. Transfer the existing origin guard directly into
   the encrypted Worker secret binding `LYRA_ORIGIN_GUARD`, without console output
   or temporary plaintext files. Avoid Cloudflare debug logging.
4. Register the additive API task plan. Start sidecars only after API `/readyz`
   is healthy; keep the API image pinned. Use ECS rollback circuit breaker,
   minimum healthy 100%, maximum 200%, desired count 2, and retain ALB attachment.
   Keep the saved service configuration for rollback. A cloudflared process exit
   must stop/replace its essential task; network reconnects are handled by
   cloudflared. Verify two independent healthy connector replicas, not merely two
   sockets. Sidecar reservation is 64 MiB; the original task size is preserved.
   Measure CPU/memory and readiness under canary traffic before accepting capacity.
5. Deploy the Worker without workers.dev, previews or a production route. Attach
   its canary route to a proxied Tunnel CNAME. Verify same-host fetch actually
   reaches the Tunnel. Test TLS, `/healthz`, PostgreSQL-backed `/readyz`, protected
   API 401, an authenticated owner-scoped read using an authorized test session,
   unchanged Cognito callback, web index/current assets, binary/range downloads,
   all five public documents, Android association, raw signed Stripe webhook
   handling in a safe test, SSE/error status, cancellation, IP spoof rejection and
   no private cache. Do not create charges or generation jobs merely for smoke.
6. Attach `app.lyra-editor.com/*` to the validated Worker, then change only `app`
   to the proxied Tunnel CNAME. Test the unchanged public hostname from outside
   AWS. Check old and new web assets and supported mobile release configurations.
   Retain CloudFront's five public S3 behaviors. Before retiring the ALB, also
   ensure any retained CloudFront default-origin traffic uses a verified healthy
   ingress path; direct distribution-host compatibility must not silently become
   a 502. Do not disable the distribution while the Worker uses its public files.
7. Observe at least one complete ECS replacement/drain, both healthy connector
   replicas, request/error/latency and CPU/memory metrics, and absence of old ALB
   traffic after relevant TTLs. Long requests must finish during shutdown:
   cloudflared grace is 110 seconds with ECS stop timeout 120; an API without an
   explicit stop timeout retains its pre-existing 30-second default. Capacity,
   stream drain or compatibility failures block retirement.
8. Remove the service's ALB association only after the checks pass. Retire the
   saved ALB/listeners/target group and obsolete ALB ingress rules/DNS after the
   rollback transition is confirmed. Verify deletion and release of its public
   IPv4, keep two healthy API tasks and repeat external readiness/auth/static
   smoke checks. Remove the temporary canary route and DNS record. Record exact
   receipts and measured cost later; do not infer savings from a plan.

## Rollback and cost boundary

Before ALB retirement, restore `app` to the original DNS-only CloudFront CNAME,
remove the application Worker route, restore the saved ECS service/task definition
if necessary, and verify readiness/auth/assets. Keeping the authoritative zone
unchanged allows this application rollback without waiting for a second NS change.
Registrar NS rollback uses the original four Route 53 nameservers only after its
records are rechecked. An ALB cannot be undeleted: retirement requires verified
replacement/recreation settings and is the last step.

The observed ALB base plus three IPv4 is about USD 30.66/month before tax at 730
hours, excluding LCU. This is removable AWS capacity, not net savings: Cloudflare
usage/plan charges, the new secret and any required task-size increase must be
deducted. Preserve the existing public API-task IPs for outbound access; this
migration does not add a NAT Gateway or claim all public IPv4 costs disappear.

## Official references

- [Worker route origin fetch](https://developers.cloudflare.com/workers/configuration/routing/routes/)
- [Tunnel run parameters](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/run-parameters/)
- [Tunnel high availability](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/tunnel-availability/)
- [Partial DNS setup eligibility](https://developers.cloudflare.com/dns/zone-setups/partial-setup/)
- [cloudflared releases](https://github.com/cloudflare/cloudflared/releases)
