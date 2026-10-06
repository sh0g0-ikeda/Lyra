# Google sign-in and explicit identity linking

Status (2026-10-06 r2): The dedicated Google project has two distinct Web OAuth
clients with openid/email only, TESTING status and one test account. The staging
Cognito Google IdP and existing Native/Web clients are connected; the exact
collision guard and native email settings are retained. The link settings were
added to the existing stage runtime secret without changing its non-Google values,
and its previous version remains available. Native email logout/login again shows
the existing four works, nine credits and saved draft.

Application Google capabilities remain OFF, including iOS. The configured Cognito
Hosted UI now displays Google; application capability flags do not remove that
provider. Real Google sign-in/link and physical device acceptance remain incomplete.
The permanent reader/proof Lambda and Google-aware lifecycle deployment are still
pending. The stage-encrypted production snapshot copy is available; clone restore,
migration, old-writer and rollback rehearsal have not run. No production change,
main merge or store submission occurred. See the r2 receipt for actual scope.

## 2026-10-06 r2 settings and verification

- Evidence: docs/uiux-backend-expansion-2026-09-30/receipts/google-settings-staging-20261006-r2.json.
- Initial provider creation failed because the new OAuth secret used the default
  AWS-managed key. CloudFormation completed rollback. Only that stage secret's
  key association was changed to the existing stage key; values were not fetched,
  its version was preserved, and no KMS/IAM policy was broadened. The reviewed
  IdP Add plus two non-replacement client Modify changes then completed and all
  prior pool/client/template/API image/count/callback fields were compared.
- Final Ops: 181/181 PASS, 0 FAIL, 0 SKIP across all 18 files using only the owned
  loopback PG18. Source hashes remained unchanged during the gate. That temporary
  server was stopped; other clusters were not changed. Product suites from the
  previous release gate were not rerun or represented as new results here.
- The proof template retains reserved concurrency 1 by default. Its explicit
  shared-pool QA exception is restricted to the exact staging account/Tokyo and
  passed AWS template validation. It adds no trigger or invocation permission.
  Shared quota does not cap the function at one invocation: deployment/runtime
  intents must enforce stopped schedules and one manual invocation with retry 0,
  parallelism 0 and reader connection limit 1. While quota lacks headroom, rollback
  keeps the exception true or deletes the proof stack; it must not restore false.
- The repaired CFN boundary removes the broad PassRole warning. All four Analyzer
  checks have no ERROR/SECURITY_WARNING, but 21/22 simulator expectations match:
  the original execution log-stream positive still fails. The narrower candidate
  is pending request7, and permanent IAM/proof/reader deployment has not run.
- Request6 is pending for private clone restore plus its own RDS-managed secret.
  The snapshot copy alone is not migration or data-preservation acceptance.

## 2026-10-06 staging settings evidence

- Evidence: docs/uiux-backend-expansion-2026-09-30/receipts/google-settings-staging-20261006-r1.json.
- Actual Cognito guard invocation: 7 expected outcomes matched; no user creation,
  identity-link mutation or Google provider call. Exact pool resource permission
  and pre-signup attachment were read back after CloudFormation UPDATE_COMPLETE.
- Reserved concurrency 2 could not be applied under the account's existing 10
  concurrency quota. The function uses the shared quota for bounded staging QA;
  production isolation is not approved. No quota increase or payment occurred.
- Expiry CFN corrections were tested and retried without granting default-group
  access: property capitalization, explicit group dependency, millisecond UTC end
  date, dedicated-group dependent deletion, and deterministic schedule ARN output.
  Failed additions rolled back; the final six additions preserve existing services.
  Unused retained task-definition revisions 1/2 remain ACTIVE but were not run.
- Final Ops: 179 tests, 179 PASS, 0 FAIL, 0 SKIP. The existing schema047
  fixture gate also runs on the owned local PG18 port 15435; its expectations are
  unchanged. This test-only connection wiring is the pure-wiring TDD exception.
  Real PG18 separately proves direct v2
  install/verify, eight counters, denied raw table/column reads, scoped teardown,
  preserved fixture rows and whole-transaction rollback when the Google table is
  missing. Tests share the disposable DB sequentially.
- Fresh AWS inventory disproves a completed permanent drain deployment: only the
  lifecycle and pre-signup Lambdas exist, no proof Lambda is configured, lifecycle
  latest has only its artifact-hash environment key, and its schedule is DISABLED.
  Older install/roundtrip/teardown receipts prove temporary testing, not a reader
  left installed. The first v2 install must be paired with secret storage, proof
  deployment, exact IAM/boundary readback and teardown ownership before mutation.
- Prepared/uploaded proof ZIP SHA256: 40e4547fe150ded356001b107771c1616120554d1d62a1fecba65e7849221a6a.
  Google-aware lifecycle ZIP SHA256: aa48cc56223adffdc13cb8d05b307b510de52a24019c18d4d9c2757cebb7fa46 (local only).
  Packaging/import checks do not prove a live invocation or shutdown.
- The manually created guard Lambda, role and 14-day log group require retained
  resource inventory/cleanup. Automatic full shutdown and zero ongoing cost are
  not asserted. Earlier specific M2/P9/public GitHub/IAM transmission refusals are
  preserved; no alternative channel is used to bypass them.

- Initial v2 installer preparation also passed 5 pure mock cases and generated-code
  parsing (7771/8192 override bytes). Reviewed source/image, runtime secret/source
  ARN, and fresh RDS metadata are exact-match gates. Missing prerequisites, wrong
  scopes, transaction/query failure and pool-close failure fail closed. No request
  was sent and no initial reader was installed. The disposable PG18 cluster used
  for the 179-pass gate was stopped after testing; other clusters were unchanged.

## Protocol and preservation

- Normal Google sign-in remains the Cognito authorization-code/PKCE path. Existing
  email sign-in, password reset, internal user IDs, works and credit balances remain.
- Explicit linking uses a **different Google OAuth web client**. A fresh, verified
  Cognito ID token supplies native subject, native username and `auth_time`; the
  backend checks the native profile with Cognito before opening a challenge.
- The challenge has a ten-minute deadline, random state/nonce and S256 PKCE.
  Exchange material is AES-256-GCM encrypted with challenge-specific AAD. State,
  email, session and Google subject are purpose-separated HMACs. Google tokens,
  authorization codes and the raw provider subject are never stored in receipts.
- Same-key/same-token retries return the original receipt and authorization URL
  without extending its deadline, including after `auth_time` ages. A different
  session can recover status but never that URL. A new request requires explicit
  reauthentication/confirmation in the client; existing app tokens are preserved.
- Callback state is atomically consumed before code exchange. Google issuer,
  audience, authorized party, RS256 signature, expiry, issued-at, nonce, subject and
  verified email are checked. Google email must match the verified native account.
- The provider-subject reservation is committed before `AdminLinkProviderForUser`.
  The native user and challenge are locked during the call; the destination is the
  native Cognito username, never an email alias or a federated profile. No duplicate
  account deletion, work transfer, automatic email relinking or asset merge exists.
- An ambiguous provider/DB outcome becomes `recovery_required`. Receipt lookup reads
  Cognito and settles only an exact verified linked-subject match. It never repeats
  an ambiguous AWS mutation. A lost reservation acknowledgement cannot downgrade a
  durable intent to an ordinary failure.
- Account-deletion admission clears challenges and reservations in the same DB gate.
  Callback/query material is private/no-store and uses no-referrer. HTTP application
  logs contain the path but no OAuth query string. **CDN/ALB/proxy logging must also
  redact callback query strings before activation.**

## API

Public: `GET /api/auth/capabilities` returns `google_sign_in`, `google_linking`,
`google_ios:false` with its original strict schema. `GET /api/auth/capabilities?version=2`
returns `version:2` and boolean capabilities. Unknown/duplicate versions are rejected;
new Web/Mobile clients hide Google if the v2 response is unavailable or invalid. Callback is the fixed
`GET /api/auth/identity-links/google/callback` route.

Authenticated: `POST /api/auth/identity-links/google/start` accepts only `platform`
(`mobile` or `web`) and a UUID `request_key`; `GET .../google/:id` returns the receipt.
Neither endpoint accepts a subject, destination username, price, storage key,
callback URL or Google access token from the client.

Return to Mobile is fixed by `GOOGLE_LINK_MOBILE_RETURN_URI`: production uses
`lyra-mobile://auth/identity-link?challenge_id=UUID`, isolated staging uses
`lyra-mobile-staging://auth/identity-link?challenge_id=UUID`. The server rejects
misconfigured schemes, and the client validates against its own fixed Cognito callback.
It is a wake-up signal, not proof of success. Mobile fetches authenticated status.
The Web return is the fixed configured HTTPS `/auth/identity-link` path, not request-controlled.

## Configuration and approvals required before enabling

1. Reconcile the release against the actual production migration/source lineage.
   Current local migration `044` is a development-branch identity; **do not run it
   on production until the production bridge is reviewed and rehearsed**.
2. Configure Google in the intended Cognito pool and review the existing pre-signup
   trigger before composing the collision guard. Do not overwrite an existing
   trigger or enable email-alias transfer. The supplied guard uses AWS's documented case-insensitive exact email filter,
   verifies normalized returned values and exhausts all matching pages within one
   3.5-second deadline (Cognito allows five seconds). It fails closed on lookup
   failure or excessive matching pages. ListUsers is eventually consistent, so
   simultaneous first-time native/federated signup and recovery still require
   staging validation; backend email uniqueness always prevents identity reassignment.
3. Create/review the dedicated Google link OAuth web client with only the exact
   HTTPS callback. Keep it distinct from the Google client used by Cognito:
   - `GOOGLE_COGNITO_IDP_CLIENT_ID`: public Google client ID configured in Cognito
   - `GOOGLE_LINK_CLIENT_ID`, `GOOGLE_LINK_CLIENT_SECRET`: dedicated link client
   - `GOOGLE_LINK_REDIRECT_URI`: exact HTTPS backend callback path above
   - `GOOGLE_LINK_WEB_RETURN_URI`: fixed HTTPS Web `/auth/identity-link` return path
   - `GOOGLE_LINK_MOBILE_RETURN_URI`: exact environment-specific native return above
   - `GOOGLE_LINK_ENCRYPTION_SECRET`: stable high-entropy secret, at least 32
     characters, held only in the approved runtime secret store
   - `AUTH_PROVIDER=cognito`, `AWS_REGION`, `COGNITO_USER_POOL_ID` and existing
     allowed Cognito app-client IDs must match the verified deployment
4. Backend role: only reviewed `cognito-idp:AdminGetUser` and
   `cognito-idp:AdminLinkProviderForUser` on the intended pool. Pre-signup role:
   reviewed `cognito-idp:ListUsers` on that pool. No root credentials, wildcard
   pool grants, automatic IAM writes or plaintext secrets in app bundles.
5. Keep `GOOGLE_SIGN_IN_ENABLED=false` and `GOOGLE_IDENTITY_LINK_ENABLED=false`
   until real-account acceptance covers separate emails, existing native email,
   case variants, cancelled/expired flows, duplicate callback, response loss,
   account switching, deletion races and read-only recovery. New capabilities
   and all identity routes fail closed if required configuration is absent.
6. iOS remains default-OFF. The v1 response always stays false for older apps.
   v2 iOS can activate only with `GOOGLE_IOS_ENABLED=true`,
   `GOOGLE_IOS_POLICY_REVIEWED=true`, and a distinct `GOOGLE_IOS_COGNITO_CLIENT_ID`
   included in `COGNITO_ALLOWED_CLIENT_IDS`. These configuration guards do not
   prove Apple policy acceptance or device behavior. Hiding the app's CTA alone is insufficient: a shared
   Cognito Hosted UI client can still expose Google. Review a separate iOS app
   client/provider policy and the Apple/exception decision before any iOS public
   release. This work does not implement unrequested Apple sign-in.
7. Explicit linking requires Cognito Managed Login branding (domain version 2)
   and an eligible pool tier. Classic Hosted UI ignores `prompt=login`; `max_age=0`
   is not accepted as proof of fresh authentication. Retain the server-side recent
   `auth_time` check. Isolated staging already uses ESSENTIALS, so no tier change
   was made. Production settings and real fresh Google/native proof remain unverified.
   See [AWS authorization endpoint](https://docs.aws.amazon.com/cognito/latest/developerguide/authorization-endpoint.html).
   Verify native custom-scheme callback, app switching, fresh-login prompt and
   cookie/session behavior on real devices. The Web account UI and fixed return
   handler are implemented behind the same capabilities; real browser/IdP
   acceptance remains unverified and is required before exposing the entry point.
8. Rehearse identity-link + account-deletion during provider timeout/DB connection
   loss. Local tests prove durable intent and no automatic mutation replay, not
   Cognito's real remote settlement under every fault. Provider enablement remains
   blocked until this external-system behavior is accepted.
9. Configure bounded expiry maintenance using the reviewed existing scheduler.
   `bun scripts/expireGoogleIdentityLinkChallenges.ts` is dry-run by default;
   `--apply --limit 100` clears expired encrypted exchange material and retains
   idempotency receipts. It prints only a count, never row IDs or provider errors.
   No maintenance task was scheduled. Keep the HMAC/encryption secret stable;
   rotation requires draining active challenges and a reviewed rehash/recovery
   plan for existing linked identities, not a blind environment-value replacement.

## Local evidence

- Protocol/service tests cover disabled mode, recent-native proof, encryption/AAD,
  exact dedicated URL/PKCE, replay and changed-session recovery, identity/email
  rejection, single-use callback, ambiguous-result read-only reconciliation.
- Gateway tests use local signed JWTs and injected transports only; no live Google
  or AWS operation occurs. Pre-signup tests cover mixed-case later-page collisions,
  matching-page/deadline bounds and unrelated trigger preservation.
- PostgreSQL 18.3 tests cover concurrent start/callback, unique subject reservation,
  provider success followed by DB failure, lost reservation acknowledgement,
  deletion/late admission, bounded expiry and transaction constraint rollback.
- Exact final commit, whole-suite totals, PG16/18 compatibility and real-device
  acceptance belong in the release evidence file; these focused results alone
  are not a production readiness claim.


Apple policy reference (checked 2026-10-06): [App Review §4.8 Login Services](https://developer.apple.com/app-store/review/guidelines/#login-services).
Google requires an equivalent privacy-preserving option unless an applicable exception is established;
no Apple/exception acceptance is claimed by the configuration flag.

AWS protocol references: [ListUsers search semantics](https://docs.aws.amazon.com/cognito/latest/developerguide/how-to-manage-user-accounts.html),
[trigger timeout](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-working-with-lambda-triggers.html).

## Stable subject login and signup atomicity

Ordinary login no longer reassigns an existing internal user by matching email,
for either native or federated identities. A different subject with the same
email receives `ACCOUNT_LINK_REQUIRED`. An already matching subject still keeps
its internal user, works, organizations, balance and purchases. Legitimate old
provider migrations require a separately reviewed offline mapping supported by
both identity proofs; email equality alone is never a migration instruction.

`TransactionalUserProvisioningService` is the actual API composition. New user,
initial balance and signup ledger grant share one DB transaction. User insertion
uses conflict-safe insertion rather than aborting the transaction on a concurrent
insert; the loser resolves the same subject or rejects the email collision.
Concurrent signup and injected ledger failure are exercised against disposable
PostgreSQL 16 and 18.3. A failed grant leaves no partially created account.

Before switching this login behavior on a real database, an authorized operator
must run `bun run auth:check-subjects:prod` using the already approved runtime DB
and Cognito read role. This read-only audit has no apply mode. It emits aggregate
counts only, uses a repeatable-read/read-only DB transaction with one-second lock
and five-second statement timeouts, and bounds the Cognito read to 60 seconds and
1,000 pages. It checks at most 10,000 active users; reaching an inspection bound
fails the gate rather than claiming completeness. Missing/duplicate/malformed
subjects fail readiness. Email differences and disabled identities are reported
separately for operator review; no user, email or credential value is printed.
No real production audit has been run, and absence of unmigrated users is unknown.

If missing subjects exist, stop before rollout and establish the legitimate old
and new identity proof through a reviewed migration plan. Never repair this gate
by enabling email-only login relinking, merging accounts, deleting a Cognito
profile, giving a second signup bonus, or changing purchase ownership.


## Web implementation and verification boundary

The existing Web Cognito email login and optional Supabase email flow remain.
Normal Google login adds `identity_provider=Google` to the existing Cognito PKCE
flow only when the public capability enables it. Web iOS/iPadOS detection also
withholds Google while `google_ios` is false.

The Account panel starts explicit linking through an isolated native-Cognito
popup with `identity_provider=COGNITO`, `prompt=login`, and `max_age=0`. It reuses
the existing configured Cognito redirect URI, verifies fresh `/api/me` ownership,
and uses that fresh ID token only in an in-memory API client. The main tab's
session and drafts are not replaced. A same-origin bootstrap acknowledges a
UUID nonce before writing isolated PKCE state. Exact origin/source/nonce checks
and a nonce-specific BroadcastChannel relay handle Cognito COOP isolation.
Fresh proof is relayed without replacing the opener's persisted session. Explicit
Cancel clears listeners and closes the popup. After COOP isolation, manual window
closure can remain undetected until the ten-minute timeout; it never counts as
link success.

The backend's fixed HTTPS `/auth/identity-link` return carries only a UUID
challenge ID. Web bootstrap handles this path before ordinary Cognito redirect
processing; Google authorization codes are never exchanged at Cognito. A popup
return only wakes an authenticated receipt read. Known receipts remain readable
with the current account after reload; uncertain starts retry the same key only
while their exact fresh proof remains in memory. Loss of that proof requires an
explicit fresh-login/new-attempt action. Only owner/request/receipt metadata is
stored in sessionStorage. Linked status offers a separate, explicit sign-out
step after warning the user to save drafts.

Local tests cover gates, iOS withholding, isolated PKCE, session preservation,
owner mismatch, request-key recovery, changed proof, cancellation, duplicate
messages and reads, popup source/origin/nonce, storage failures, and bootstrap
recovery. Web build, lint, and root TypeScript build pass. A fully mocked browser
suite is in `apps/web/e2e-google/googleAuth.spec.ts`, run with
`npx --prefix apps/web playwright test --config apps/web/playwright.google.config.ts`.
The three Google scenarios passed in actual local Chrome with mocked Cognito,
Google and API responses. This includes COOP/BroadcastChannel relay behavior,
not real provider authorization. Whole-suite evidence and final source hashes
are recorded in the implementation log. Real Google/link/device acceptance is
still required; provider flags and Google IdP settings remain OFF/unconfigured.
