# Lyra Mobile Maestro E2E Operations

This runbook is the executable acceptance contract for E2E-01 through E2E-18
from `docs/mobile_completion_gap_spec.md` section 11.4. It runs against a
standalone or EAS-installed staging binary with application ID `com.lyra.mobile`.
Expo Go is not accepted.

## Preconditions

- Install a staging Android or iOS standalone build on the physical test device.
- Install Maestro and make `maestro --version` available on the operator PATH.
- Use a staging backend and Cognito configuration only.
- Run the staging seed/reset operation before every run. It must create the
  disposable accounts and fixture aliases listed in `.maestro/e2e-manifest.json`.
- Set only the selected scenario's environment variables in the shell or secret
  store. Do not place values in YAML, the manifest, source control, or evidence.
- Set `E2E_PLATFORM` to `ios` or `android`, `E2E_SCENARIOS` to a comma-separated
  list of scenario IDs, and `E2E_EVIDENCE_DIR` to a new writable run directory.

The selector and fixture variables intentionally have names rather than values.
The staging seed operation owns their values and must make the aliases
deterministic for the selected disposable user. Required variables are validated
per scenario before Maestro starts.

## Standard staging run

Set the account, fixture, and selector variables required by the selected IDs in
`.maestro/e2e-manifest.json`, then run:

```powershell
$env:E2E_PLATFORM = 'android'
$env:E2E_SCENARIOS = 'E2E-01,E2E-02,E2E-03'
$env:E2E_EVIDENCE_DIR = 'artifacts/mobile-e2e/android-20260725'
npm run e2e:maestro:staging
```

For iOS, set `E2E_PLATFORM` to `ios` and use an installed iOS standalone build.
Run each required scenario on both platforms. The runner writes one JUnit XML
file per scenario under `junit/` and requires a matching PNG in the Maestro
test-output directory. Missing output is a failed run.

E2E-11 enables and disables Android airplane mode in the flow. On iOS, it calls
the external network-control harness configured through
`E2E_NETWORK_CONTROL_URL`, `E2E_NETWORK_CONTROL_TOKEN`, and
`E2E_NETWORK_DEVICE_ID`. The harness must control the actual device connection,
not a visual fixture, and write `E2E_NETWORK_HARNESS_EVIDENCE_PATH` containing
the unique `E2E_RUN_ID`. The runner verifies that artifact after Maestro records
its JUnit and screenshot evidence.
While the device is offline, the flow must tap `E2E_OFFLINE_WRITE_LABEL`, which
is a real save or generate command. It must show
`E2E_OFFLINE_WRITE_FAILURE_LABEL` and retain `E2E_OFFLINE_DRAFT_TEXT` before
the device reconnects. After reconnecting, it must tap the explicit retry and
show `E2E_OFFLINE_WRITE_SUCCESS_LABEL`. The runner also requires
`E2E_OFFLINE_WRITE_EVIDENCE_PATH` on both platforms. This is a UTF-8 JSON object:

```json
{
  "schemaVersion": 1,
  "scenarioId": "E2E-11",
  "runId": "<E2E_RUN_ID>",
  "platform": "ios or android",
  "operation": "save or generate",
  "clientOutcome": "network_error",
  "requestCorrelationId": "<unique attempt id>",
  "backend": {
    "proofSource": "<staging log or audit query>",
    "observedAt": "<UTC timestamp>",
    "writeRequestCount": 0,
    "queuedWriteCount": 0,
    "acceptedWriteCount": 0
  }
}
```

The backend counters must cover the request correlation ID and run ID. A missing
or malformed artifact, a queued write, or a nonzero accepted write fails the
scenario after Maestro finishes. This prevents an offline visual-only pass from
claiming that writes were not queued.

## Store acceptance: E2E-15

E2E-15 is never an ordinary staging pass. Run it separately:

```powershell
$env:E2E_PLATFORM = 'ios'
$env:E2E_EVIDENCE_DIR = 'artifacts/mobile-e2e/ios-store-20260725'
$env:E2E_STORE_TEST_ACKNOWLEDGED = 'true'
$env:E2E_STOREKIT_SANDBOX_ACCOUNT = '<secret-store-value>'
npm run e2e:maestro:store
```

For Android, set `E2E_PLATFORM` to `android` and provide
`E2E_PLAY_LICENSE_TEST_ACCOUNT` instead. The runner rejects E2E-15 without the
selected platform's sandbox or license-test account and explicit acknowledgement.
Never record either account in evidence, shell history, or committed files.

E2E-15 additionally requires a unique `E2E_RUN_ID` and platform-specific
provider evidence paths. iOS requires `E2E_STOREKIT_PROVIDER_EVIDENCE_PATH`;
Android requires `E2E_PLAY_PROVIDER_EVIDENCE_PATH`. Both require the server
webhook, pending, restore, refund, and renewal evidence paths listed in the
manifest, plus `E2E_EVIDENCE_HMAC_SECRET` from the staging secret store. The
secret must be at least 32 characters. The runner does not pass that secret to
Maestro and rejects E2E-15 before or after the flow when it is missing.

Every E2E-15 artifact must be a signed UTF-8 JSON object. Its `hmacSha256` is an
HMAC-SHA256 over the canonical JSON payload with the `hmacSha256` property
removed: recursively sort object keys, preserve array order, and serialize using
JSON primitive encoding without whitespace. The evidence collector, not the
mobile client, owns this signature. The runner rejects any invalid signature.

Each artifact must include all of the following values and use the same
`scenarioId`, `runId`, `platform`, `productId`, and
`purchaseTransactionDigest` across the E2E-15 evidence set:

```json
{
  "schemaVersion": 1,
  "scenarioId": "E2E-15",
  "runId": "<E2E_RUN_ID>",
  "platform": "ios or android",
  "artifact": "provider, webhook, or lifecycle",
  "state": "purchase, pending, restore, refund, or renewal",
  "storeEnvironment": "StoreKit sandbox or Play license test",
  "provider": "storekit or google-play",
  "productId": "<store product id>",
  "purchaseTransactionDigest": "<sha256>",
  "webhookEventDigest": "<sha256>",
  "providerVerification": { "status": "verified", "evidenceDigest": "<sha256>" },
  "ledger": { "event": "<ledger event>", "delta": 0, "balance": 0 },
  "correlations": {
    "purchase": { "state": "purchase", "providerVerification": "verified", "purchaseTransactionDigest": "<sha256>", "webhookEventDigest": "<sha256>", "ledger": { "event": "<event>", "delta": 0, "balance": 0 } },
    "pending": { "state": "pending", "providerVerification": "verified", "purchaseTransactionDigest": "<sha256>", "webhookEventDigest": "<sha256>", "ledger": { "event": "<event>", "delta": 0, "balance": 0 } },
    "cancel": { "state": "cancel", "providerVerification": "verified", "purchaseTransactionDigest": "<sha256>", "webhookEventDigest": "<sha256>", "ledger": { "event": "<event>", "delta": 0, "balance": 0 } },
    "restore": { "state": "restore", "providerVerification": "verified", "purchaseTransactionDigest": "<sha256>", "webhookEventDigest": "<sha256>", "ledger": { "event": "<event>", "delta": 0, "balance": 0 } },
    "renewal": { "state": "renewal", "providerVerification": "verified", "purchaseTransactionDigest": "<sha256>", "webhookEventDigest": "<sha256>", "ledger": { "event": "<event>", "delta": 0, "balance": 0 } },
    "refund": { "state": "refund", "providerVerification": "verified", "purchaseTransactionDigest": "<sha256>", "webhookEventDigest": "<sha256>", "ledger": { "event": "<event>", "delta": 0, "balance": 0 } }
  },
  "hmacSha256": "<hmac sha256 over the unsigned canonical payload>"
}
```

The provider artifact uses state `purchase`; the webhook artifact uses state
`purchase`; the pending, restore, refund, and renewal artifacts use their named
lifecycle states. The mandatory `cancel` correlation is produced by the staging
store observer even though it has no separate artifact path. The artifact's
top-level webhook digest and ledger fields must match the correlation for its
own state. UI labels alone, a run ID embedded in arbitrary text, an unsigned
JSON file, or independent store/webhook/ledger records are not purchase evidence.

## Audit D evidence

For every successful scenario on each physical platform, retain the JUnit XML,
screenshot(s), device/build identifier, selected fixture alias, Network trace,
backend log correlation, job metadata, credit-ledger result, S3 asset result,
and final UI state. Store the evidence in the release ledger. A source-level
contract check is not a substitute for real-device acceptance.
