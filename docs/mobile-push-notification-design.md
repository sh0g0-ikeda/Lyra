# Mobile push notification design

## Scope

This implementation completes the authenticated background-job notification
contract in `MOB-JOB-004`:

- encrypted APNs/FCM token registration and removal
- native-token registration and tap handling in Mobile
- transactional terminal-job notification outbox
- per-device delivery state, retry classification, and invalid-token removal
- APNs and FCM provider adapters
- generic localized notification copy with opaque navigation IDs only

It does not notify for canceled jobs or exports. `MOB-JOB-004` is defined around
long-running `generation_jobs`; export delivery remains covered by its own in-app
job flow.

## Spec basis

- Unified Spec section 3: Route / Service / Repository / Domain boundaries
- Unified Spec section 4: authenticated personal ownership
- Unified Spec section 5: PostgreSQL as the system of record
- Unified Spec section 8: bounded input, parameterized SQL, and secret-safe output
- Mobile completion spec `MOB-JOB-004`: push-token registration as a prerequisite
  for background completion notifications

## Interfaces

The future `/api` mount exposes:

- `POST /push-tokens`
  - body: `platform`, `installation_id`, `device_token`, `locale`
  - always derives `user_id` from authenticated request context
  - returns only `status`, `installation_id`, and `platform`
- `DELETE /push-tokens/:installationId`
  - deletes only a row matching both the authenticated `user_id` and installation ID
  - returns `204` whether or not that user's registration existed, preventing
    cross-user registration enumeration

The bounded UI locale (`ja` or `en`) is used only for generic notification copy.
The registry never stores user-authored content.

The service depends on:

- `PushTokenCipherPort` for authenticated encryption/decryption and deterministic
  keyed hashing
- `PushTokenRepository` for transactionally persisted personal registrations

The database stores ciphertext, encryption-key ID, and deterministic token hash.
The raw provider token is never persisted or returned. `token_hash` is globally
unique so one physical provider token cannot continue receiving notifications for
multiple accounts. Re-registering the exact token transfers that token to the
current authenticated user; merely guessing another installation ID cannot modify
that user's row.

## Persistence and concurrency

Migration 030 creates `mobile_push_tokens` with:

- an internal server-generated ID
- `user_id` with `ON DELETE CASCADE`
- bounded platform and installation ID
- globally unique deterministic token hash
- unique `(user_id, installation_id)`
- ciphertext and encryption-key ID only

Registration takes transaction-scoped advisory locks for the authenticated
user/installation pair and token hash. It removes only a stale registration for
that same user/installation, then upserts by token hash. This serializes token
rotation and cross-account token transfer without interpolating input into SQL.

Migration 031 adds:

- `locale` to `mobile_push_tokens`
- `mobile_push_notification_outbox`, unique by terminal generation job
- `mobile_push_notification_deliveries`, unique by outbox event and token
- an `AFTER UPDATE OF status` trigger on `generation_jobs`

The trigger reacts only to the first transition into `completed` or `failed`.
It creates the outbox event and snapshots the recipient's currently registered
devices in the same transaction as the terminal job transition. This covers page,
entity, episode-story-autofill, page-skeleton, dispatch-failure, and recovery
paths without relying on every producer to remember a second write.

The dispatcher claims device deliveries with `FOR UPDATE SKIP LOCKED`. A lease
allows abandoned `processing` rows to be retried. Each device is marked
independently, so a transient failure does not resend to devices already marked
sent. Invalid provider tokens are deleted. Retryable 429/5xx/network failures use
bounded exponential backoff; permanent provider/configuration failures become
dead deliveries with a generic error code only.

Navigation data is resolved server-side from the job's opaque IDs:

- `page_generate` -> Pages plus work/chapter/episode/page IDs
- `entity_generate` -> Characters plus work/entity IDs
- episode jobs -> Story plus work/chapter/episode IDs

Missing or inconsistent resource context makes the delivery a permanent failure.
The dispatcher never copies names, story text, dialogue, email, or image data.

## Security

- Request bodies and path parameters are bounded with strict Zod schemas.
- No organization ID is accepted; this is a personal device registration.
- Routes never accept a user ID from the client.
- The token, ciphertext, and hash never appear in API responses or log calls.
- A broken cipher implementation that returns plaintext as ciphertext or hash is
  rejected before persistence.
- The production cipher implementation must keep encryption and HMAC keys in AWS
  Secrets Manager or KMS, support key rotation through `keyId`, and never use
  `EXPO_PUBLIC_*`.
- Provider tokens are sensitive identifiers. Future observability must redact body
  fields and repository values.
- APNs signing keys and Google service-account JSON are server-only environment
  secrets. They are never prefixed with `EXPO_PUBLIC_` or returned by an API.
- Provider calls have bounded timeouts. APNs uses ES256 provider tokens over HTTP/2;
  FCM uses an OAuth access token from `google-auth-library`.
- Mobile re-fetches the tenant-scoped job before applying any notification
  selection or navigation target.

## Test plan

Tests are added before implementation and must initially fail because the new
modules do not exist.

- validator: accepted bounds plus invalid platform, installation ID, token, and
  unknown fields
- service: encrypted/hash-only persistence, safe return object, cipher failure,
  and user-scoped idempotent deletion
- repository: parameter binding, transaction locks, safe returned fields, token
  transfer, and delete ownership predicate
- route: authentication, bounded body/path validation, safe response, no token
  reflection, and user-scoped deletion
- migration: personal ownership, uniqueness, ciphertext columns, bounds, and
  absence of a plaintext token column

Focused verification:

```bash
bun test tests/unit/lib/validators/pushToken.schema.test.ts \
  tests/unit/services/notification/PushTokenRegistryService.test.ts \
  tests/unit/repositories/PushTokenRepository.test.ts \
  tests/unit/routes/pushTokens.test.ts \
  tests/unit/migrations/pushTokenRegistryMigration.test.ts
npm run build
```

## Delivery verification

Tests are written first and must prove:

- the migration trigger creates one event and one delivery per registered device
- repeated terminal writes do not duplicate an event and canceled jobs do not notify
- repository claims are leased and device-scoped
- navigation payloads contain only UUID routing fields
- localized generic copy contains no persisted content
- APNs/FCM success, invalid-token, retryable, and permanent responses are classified
- dispatcher decrypts only at send time, removes invalid tokens, and does not
  resend successful devices
- runtime configuration fails closed when notifications are enabled without all
  required provider and token-protection secrets
- Mobile registration includes locale and tap handling re-authorizes the job

## Delegation

Sol owns the architecture, provider security, app/worker wiring, and final review.
Terra may implement the bounded migration and PostgreSQL outbox repository after
Sol has added failing contract tests. Terra must not edit provider adapters, runtime
configuration, Mobile code, or existing generation repositories, and Sol must
review every trigger, SQL predicate, lease, and payload field before integration.
