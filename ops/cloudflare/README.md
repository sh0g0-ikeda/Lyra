# Cloudflare ingress migration

Status: **production ingress migrated; ALB retirement verified** (2026-10-31 JST).
Cloudflare is authoritative; app and canary Worker/Tunnel routes are live.
CloudFront default/API assets now use `lyra-cloudflare-app-origin`, after the
exact `/healthz` probe passed locally and on a temporary GitHub runner. Its five
S3 OAC public-document behaviors remain unchanged. AWS API, PostgreSQL, S3, SQS
and generation workers remain in Tokyo; no US production resources were added.
The temporary US runner was an external public-health probe, not a deployed copy.

API revision 148 retains the immutable API image, 256 CPU / 512 MiB and desired
count two. Both endpoints passed owner-authenticated reads, signed Stripe raw-body
acceptance (modified body rejected), one approved SSE preview, public-file byte
comparison, and JS/CSS range checks. The preview did not change the test work or
its before/after credit balance. A rolling replacement completed with graceful
shutdown and exit 0 on both old tasks. ALB request count was zero for the observed
first hour after cutover. After explicit retirement approval, the service ALB
association was detached; the ALB, dedicated target group, one obsolete API ingress
rule and the old `origin` CNAME were removed. All three original managed network
interface IDs now return NotFound. API desired/running remain two, pending zero.
Both authoritative nameservers match all 13 unchanged DNS records (26 checks);
app/canary A and AAAA resolve and old origin has no CNAME. DNS reload retains
15 records, including the old origin certificate-validation CNAME.

The detach monitor recorded one legacy client-side 10-second timeout; its exact
cause is not established. Keep that failed sample. Subsequent steady monitoring
passed 20 consecutive readiness checks on both endpoints, and final post-removal
public compatibility probes passed 10 checks per endpoint. CloudFront error-rate
metrics were zero for the nine available points covering the transient window.
The retained Route 53 zone, ALB security group and ACM certificates support
propagation/recreation; they do not constitute an active ALB. The unused old
CloudFront origin is recovery metadata, not a reachable fallback after deletion.

Live tests did not hold a long-running SSE open during shutdown or originate an
IPv6 client connection; those paths have unit/configuration coverage only. Keep
these limits separate from the completed live checks. Building this directory
alone never applies cloud changes.

## Scope and invariants

Replace the public ALB ingress with a Cloudflare Worker route and outbound Tunnel.
Keep Cognito, PostgreSQL, S3, SQS, the API and generation worker in AWS. Keep the
public URL `https://app.lyra-editor.com`, Cognito callbacks, bearer authentication,
Stripe signature verification, asynchronous job contracts and credits unchanged.

The pre-migration API baseline is `lyra-prod-api:147`, two ARM64 tasks in Tokyo AZs
1c/1d (256 CPU / 512 MiB each). Its immutable image is:

```text
452284481392.dkr.ecr.ap-northeast-1.amazonaws.com/lyra-prod-api@sha256:20caa956ab25ac973446dbbf1e3f7cc5036f4b962cfa47a2fae2433f7e81b051
```

Generation worker revision 89 is outside this rollout. Repository `main` is not
the complete deployed application: **do not rebuild/redeploy the API from this
checkout**. Refresh the live task definition, compare the expected image, and
apply the additive sidecar plan to that definition only.

Every Worker response uses `no-store, no-transform` so intermediary HTML/body
rewrites (including automatic analytics injection) do not change the existing
public documents or streaming payload.

The base `wrangler.jsonc` intentionally has empty routes. Once a route is live,
deploy with an operator-owned runtime copy containing the account and exact
approved routes. Deploying the empty-route template would unmount live ingress.
Keep encrypted bindings out of `vars`; preserve them during runtime updates.

The app origin bridge is initial-OFF: unset or `LYRA_APP_ORIGIN_BRIDGE="off"`
uses the incoming hostname's configured origin. Only the exact value `"canary"`
rewrites app API/SPA requests to the fixed canary URL and Host, preserving path,
query, authentication and raw streams. Unknown values fail closed. The five
public documents still use CloudFront. `global_fetch_private_origin` explicitly
pins same-zone fetch to the origin instead of re-entering Worker routes.

When the bridge is `canary`, its DNS record and published Tunnel route are
**production dependencies**. Keep them until an app published Tunnel route is
confirmed on both replicas, same-host app origin requests pass, and the runtime
binding is explicitly set to `off`. With `keep_vars: true`, omitting the binding
from a subsequent config does not disable it. Never remove canary first.

The Worker replaces visitor origin-guard/address headers. At a public Worker
route it uses the Cloudflare platform IP, except when the original incoming guard
matches the encrypted binding: only then may a strictly valid AWS
`CloudFront-Viewer-Address` (`IPv4:port` or `[IPv6]:port`) supply the client IP.
Guard verification uses Web Crypto HMAC verification without logging credentials.
Missing/wrong guards or malformed AWS addresses retain the Cloudflare platform IP
fallback; invalid platform IPs are omitted. The existing CloudFront origin policy
must generate the viewer address and overwrite its custom guard. A missing origin
secret fails closed. There is no mutation retry, response
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
  DNS was Route 53 before this migration and is now Cloudflare; public RDAP
  reported no signed delegation at the pre-cutover check. Free full
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
2. Create a remotely managed Tunnel with the published canary hostname
   `lyra-tunnel-canary.lyra-editor.com` to `http://127.0.0.1:3000`, followed by
   `http_status:404`. The fixed app bridge can reuse this origin while the app
   published Tunnel route is absent. Keep metrics on `127.0.0.1:2000`; do not
   publish that port.
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
6. Enable the fixed `canary` bridge in the operator runtime config while keeping
   the existing canary Worker route. After explicit main-cutover authorization,
   attach `app.lyra-editor.com/*` to the validated Worker, then edit only the
   existing `app` record in place to the proxied Tunnel CNAME (do not delete it). Test the unchanged public hostname from outside
   AWS. Check old and new web assets and supported mobile release configurations.
   **Only after app + Worker + Tunnel are serving correctly**, add CloudFront
   origin `lyra-cloudflare-app-origin` for `app.lyra-editor.com`, copying the
   existing ALB origin's HTTPS/TLS, guard and 60-second read timeout. Keep
   `lyra-prod-alb-origin` unchanged for rollback. First add only an exact `/healthz`
   GET/HEAD behavior to this origin, using CachingDisabled and the existing default
   origin-request policy. Leave default, assets and the five S3 behaviors unchanged.
   Wait for `Deployed`; probe the direct distribution hostname locally and from
   the credential-free GitHub smoke workflow, recording Cloudflare and CloudFront
   POP/cache metadata. Public DNS resolver results alone do not establish which
   DNS CloudFront uses. A failing probe blocks the broad cutover.

   After this probe passes, switch only default and `/assets/*` targets to the
   validated new origin, preserving their policies; remove the now-redundant
   `/healthz` behavior. Wait for `Deployed`. The default origin policy
   `b689b0a8-53d0-40ab-baf2-68738e2966ac` generates the viewer address and replaces
   Host with the origin hostname. Verify direct distribution readiness/auth/assets,
   IPv4/IPv6 identity, signed-body handling, SSE and public documents. Check TLS
   and absence of interactive Cloudflare challenges on this server-to-server path.
   The narrow probe checks actual observed CloudFront paths, not every internal
   resolver worldwide. Keep ALB available through compatibility and drain gates.
   Do not disable CloudFront while the Worker still uses its five public files.
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
   smoke checks. Remove canary only after its production dependency has been
   retired under the bridge-off conditions above. Record exact receipts and
   measured cost later; do not infer savings from a plan.

## Rollback and cost boundary

Before ALB retirement, verify the saved ALB path and target readiness still work.
**First restore CloudFront default and asset targets to the retained
`lyra-prod-alb-origin` backed by ALB, and remove any `/healthz` probe behavior.**
Use the current distribution ETag and wait for `Deployed`; verify direct
distribution readiness/auth/assets. Only then restore `app` to CloudFront
DNS-only and remove the app Worker route. The opposite order creates a
CloudFront -> app -> CloudFront loop. If an older operator changed the existing
ALB origin domain in place, restore `origin.lyra-editor.com` first as well.
Keep the saved service/task definition, DNS records and policies. Registrar
rollback uses the original four Route 53 nameservers only after its records and
CloudFront targets are checked for the same loop hazard.

After ALB retirement, the previous DNS rollback is unavailable: the original ALB
cannot be undeleted. Keep app on the working Tunnel path while repairing/reverting
the Worker or sidecar. Returning to ALB requires recreating and validating the
saved ALB/listeners/target group, security rules, origin DNS and ECS association
first; only after that may the ordered CloudFront-origin/DNS rollback above run.
Retirement is therefore a separate final transition requiring verified recreation
settings, not an immediately reversible DNS switch.

The verified Tokyo ALB base is USD 0.0243/hour (AWS Price List SKU
`98ZU8QNDMR4AS8FJ`, effective 2026-08-01), correcting the earlier USD 0.027
assumption. At 730 hours, the removed base plus three IPv4 is USD 28.689/month
before tax, excluding LCU. Less the new secret's nominal USD 0.40/month, ingress
saves approximately USD 28.289/month before incremental data transfer, logs and
Cloudflare usage/plan charges. No paid Cloudflare plan or task-size increase was
introduced. Preserve the two public API-task IPs for outbound access; this
migration does not add a NAT Gateway or eliminate all public IPv4 costs.

Including the earlier staging API/ALB and four stopped-DB volume removals, the
configuration-based subtotal is USD 86.00885/month (730 hours) before backup and
transfer deltas. This assumes two staging ALB public IPv4 addresses; their actual
pre-deletion count was not captured. Excluding that assumption gives USD 78.70885.
Stopped DB compute savings are zero in this comparison. Retained final snapshots
may change billed backup storage and reduce the RDS free allowance; logical
snapshot capacity is not billed physical capacity. AWS-to-Cloudflare traffic is
not the AWS-to-CloudFront origin-transfer exemption. Use actual additional billed
GB after the shared AWS free allowance when calculating net savings. These are
run-rate estimates, not a reconciled invoice or a whole-account percentage.

## Official references

- [Worker route origin fetch](https://developers.cloudflare.com/workers/configuration/routing/routes/)
- [Tunnel run parameters](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/run-parameters/)
- [Tunnel high availability](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/tunnel-availability/)
- [Partial DNS setup eligibility](https://developers.cloudflare.com/dns/zone-setups/partial-setup/)
- [cloudflared releases](https://github.com/cloudflare/cloudflared/releases)

- [CloudFront managed origin request policies](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-managed-origin-request-policies.html)
- [CloudFront generated viewer headers](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/adding-cloudfront-headers.html)
- [CloudFront origin custom headers](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/add-origin-custom-headers.html)

- [Same-zone fetch compatibility](https://developers.cloudflare.com/workers/configuration/compatibility-flags/#global-fetch-strictly-public)
