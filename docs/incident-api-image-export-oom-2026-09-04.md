# API image-export OOM incident (2026-09-04)

## Purpose and scope

Restore and protect Lyra availability after the sole production API task was
killed for exceeding its 512 MiB memory limit. This incident response is limited
to the Web page-image read path and the production API service capacity. It does
not change authentication, authorization, stored images, database state,
generation jobs, credits, billing, or user content.

## Spec basis and affected layers

- Unified Spec section 5 permits authenticated export or short-lived signed URLs
  for production image delivery.
- Unified Spec section 9 requires the API to remain available and treats ECS
  memory and ALB target health as operational signals.
- Unified Spec section 10 requires production readiness, rollout-health, and log
  verification for a deployed mitigation.
- Affected layers: Web image loading, API image delivery, and Ops/ECS capacity.

## Confirmed incident evidence

- At 2026-09-04 23:26:49 JST, ECS stopped the only `lyra-prod-api` container
  with exit code 137 and `OutOfMemoryError: container killed due to memory usage`.
- The task definition reserved 512 MiB for the API service.
- In the preceding second, one browser session completed 15 concurrent
  `GET /api/pages/:id/export-image` requests. The route loads each complete S3
  object into memory and creates another byte-array response.
- ECS restored one healthy replacement target at 23:28 JST. External `/`,
  `/healthz`, and `/readyz` checks then returned HTTP 200.

## Mitigation and permanent-fix design

1. Immediately raise the API desired count from one to two using the current
   task definition. This is reversible and prevents one OOM exit from removing
   every healthy target while the code fix is prepared.
2. Stop the page list from fetching every full-size image through the API at
   mount time. Prefer the already-authorized short-lived signed image URL for
   list rendering and retain authenticated export as a fallback and for explicit
   downloads.
3. Keep page ownership and organization capability checks unchanged. Do not make
   storage objects public or expose S3 keys.
4. Add regression coverage proving that signed list images do not invoke the
   full-image export loader, while fallback delivery still works.
5. After deployment, verify two healthy targets during rollout, HTTP 200 for `/`,
   `/healthz`, and `/readyz`, no new OOM task stops, and no burst of page-list
   `export-image` requests. Reduce temporary capacity only after the permanent
   fix has been observed safely.

## Test and delegation plan

The desired-count mitigation is production wiring and has no meaningful unit
test; it is verified by ECS/ALB readback and external probes. Any Web code change
must be test-first and pass targeted Web tests, lint, build, and an authenticated
Playwright smoke test before deployment. Terra performs read-only topology and
runbook discovery; Sol owns production operations, implementation decisions,
deployment, and final review.
