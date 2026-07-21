# Container and credit invariant remediation design

## Purpose and scope

This change removes known critical/high findings from the production runtime image and
repairs legacy credit-ledger linkage that makes deployment invariants report false
over-refunds. It does not change generation behavior, current credit prices, balance
arithmetic, refund arithmetic, API contracts, or browser UI.

## Spec basis

- Unified Spec section 6: generation-job state, recovery, and refunds stay coordinated.
- Unified Spec section 7: personal and organization credits remain separate; failed
  chargeable jobs are refunded idempotently.
- Unified Spec sections 8 and 9: minimize runtime attack surface while preserving API
  and worker availability.
- Unified Spec section 10: migrations, invariants, builds, tests, and production checks
  are release gates.

## Observed causes

### Credit ledger

Twelve historical local records contain a refund linked to `generation_jobs.id`, while the
matching consume row immediately before job creation has `job_id = NULL`. Ledger totals
and current balances agree, so changing amounts or balances would corrupt valid data.
The current invariant also groups every ledger by `(user_id, job_id)`, which is wrong for
organization credits because the consuming and refunding actor can differ.

### Runtime image

The deployed `oven/bun:1.3.11-slim` image contains vulnerable Debian packages unrelated
to Lyra application behavior. Probe scans of Bun 1.3.14 still reported critical findings
for both upgraded slim and Alpine bases. The official Bun 1.3.14 distroless runtime probe
reported no ECR findings and does not include a shell or package manager.

## Design

### Legacy linkage migration

Add migration `026` that updates only `credit_ledger.job_id`. The migration contains the
twelve ledger/job UUID pairs that were verified before authoring; it never infers a link
from timestamp proximity. A listed consume row is still eligible only when all of the
following are true:

- the job is a chargeable page/entity generation job;
- the consume row has no job link and has the exact negative job cost;
- personal user scope or organization scope matches the job;
- the consume amount is the exact negative job cost;
- a same-scope, exact-amount refund already references that job; and
- the verified ledger and job UUIDs both exist.

No amount, bucket delta, user balance, organization balance, or refund row is changed.
Unlisted, ambiguous, and unmatched rows remain untouched for manual review. The production
database had zero invariant violations before rollout, so this migration is intentionally a
no-op there rather than applying a heuristic repair to production data.

### Scope-aware invariant queries

For personal jobs, ledger rows must match both the user and a null organization. For
organization jobs, rows match the organization and job regardless of which member acted.
Missing-refund, under-refund, and over-refund checks use this same scope rule.

### Distroless runtime

Build and production-dependency installation remain in full Bun build stages. The final
image copies only compiled output, production dependencies, static web assets, migrations,
and certificates into the pinned Bun 1.3.14 distroless runtime. It runs as numeric non-root
user `65532` and clears the base image entrypoint so existing ECS command overrides remain
compatible. The image also copies only `libstdc++` and `libgcc_s`, which the native `sharp`
module requires but the distroless base intentionally omits. Backend and web compilation run
on `BUILDPLATFORM`; only production dependencies and the final image target ARM64, avoiding
slow emulation without changing generated artifacts. Worker and migration commands use the
absolute Bun path during rollout.

### Runtime dependency audit

The web lockfile advances vulnerable runtime and build dependencies within their existing
semver ranges, including React Router, DOMPurify, `ws`, Vite, and their affected transitive
packages. No public API or package manifest range changes. This removes npm audit findings
without a dependency-major upgrade.

## Affected layers and interfaces

- Persistence: one forward-only migration; no schema shape or public contract change.
- Ops/runtime: Docker build stages and ECS task command during deployment.
- Web dependency lock: security-only production dependency resolution refresh.
- Verification: deployment invariant SQL and focused regression tests.
- Unchanged: routes, services, repositories, workers, external provider calls, web/mobile.

## Security and availability controls

- Runtime has no shell/package manager and runs non-root.
- The migration is deterministic, scope-aware, and amount-preserving.
- Personal and organization ledgers cannot be combined by the audit.
- The full image must execute Bun, load `sharp`, and start the API before deployment.
- Root Bun audit, web production npm audit, and ECR runtime scanning must report no findings.
- API and worker task definitions remain rollback-compatible with the prior image.

## Test and rollout plan

1. Add failing tests for scope-aware invariant SQL and migration safety.
2. Implement the migration, invariant queries, and Dockerfile change.
3. Run targeted tests, both repository test entrypoints, backend build, web lint/build,
   migration, and local invariants.
4. Build the complete ARM64 image, run smoke commands, push a release candidate, and
   require an ECR scan with zero critical findings before rollout.
5. Apply migration 026 once, deploy API and worker, then check readiness, service health,
   queue state, invariants, logs, and the deployed image scan.

## Terra delegation record

Two read-only Terra investigations were used: one mapped container findings and runtime
options; the other traced credit refund history and tenant-scope rules. Sol owns this
design, implementation integration, security decisions, and release verification.
