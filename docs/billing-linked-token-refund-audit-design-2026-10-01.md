# Billing audit corrections: linked replacements and historical refunds

## Scope and evidence

The independent review of candidate `6c0c9681d8354ab2ed7cfbef51edf6990370930e`
found two deterministic failures while the existing 18 mobile purchase service
tests passed:

1. A voided older Google subscription order removed the current renewal's
   allowance, because reversal compared the current purchase expiration with the
   current balance expiration, although the refund named a different order.
2. RTDN for a new Google replacement token was acknowledged as an unknown
   purchase before its verified linked token could identify the existing owner.
   Production source `2debe8c3c22633ed077e7b189ddcfa8b209a00dc` supports that
   linked-owner resolution.

## Design before implementation

The purchase service remains responsible for verified ownership, state changes,
idempotency and credit mutation in one repository transaction. Provider evidence
must still be verified before entering this transaction. No provider or schema
change is required.

- Read the verified linked purchase under the existing sorted purchase-key locks,
  before deciding whether a webhook is unknown. Resolve the owner from an existing
  current purchase, otherwise its linked subscription, otherwise the authenticated
  caller. Validate both purchase owners and the verified account binding before
  expiring the linked subscription or creating its replacement. A credit pack
  cannot serve as a linked subscription ownership anchor.
- A historical Google void has an order identifier but no historical period
  expiration. Record its reverse event idempotently and preserve the current
  purchase, plan and allowance. The old allowance was replaced on renewal; the
  current purchase expiration is not evidence that the old order funded today's
  balance. Current-order refunds retain their existing reversal behavior.
- Keep post-deletion credit/plan suppression, provider completion retry behavior,
  cross-account rejection, unknown-token behavior and replay idempotency.

## Verification plan

Keep the exact-candidate RED reproduction separate. Add unit cases for historical
refund replay, linked-token RTDN replay, deleted accounts, mismatched account
binding, cross-account links and invalid credit-pack links. Add disposable
PostgreSQL coverage using production migration fixtures, valid seeded purchase /
event / credit state and the forward bridge, then exercise restore, historical
refund and linked-token notifications. Run the existing billing and deletion
suites plus TypeScript build. All tests use synthetic provider ports and local
PostgreSQL; no purchases, provider requests, production operations or publication.

## Local verification results

- Exact-candidate service reproduction: original 18 tests passed; the two new
  audit assertions failed (historical refund 50 → 0; linked RTDN created no
  replacement). Candidate implementation files in the isolated reproduction
  remain unchanged.
- Exact-candidate PostgreSQL18 reproduction after the real production fixture
  lineage bridge: historical refund reduced the current monthly balance to zero;
  replacement RTDN left the old allowance unchanged. The mismatched-binding test
  also demonstrated the old early-ACK path rather than ownership validation.
- Fixed service suite: 26 tests passed, including the eight new cases.
- Fixed PostgreSQL18 final run: four suites / 34 tests passed, including service,
  migrated production replay, existing store compatibility and deletion recovery.
- PostgreSQL16 final run: the same four suites / 34 tests passed, including
  the immediate pre-restore balance/plan assertions.
- Broader focused billing, credit, account deletion, repositories, routes and
  provider-adapter suites: 16 suites / 174 tests passed.
- `git diff --check` and the integrating backend TypeScript build passed.
  The combined release audit records the full regression results separately.

The historical Google refund attribution risk also exists in production source
`2debe8c3`, whose refund path could additionally downgrade the current plan. This
is a source-level finding, not evidence of an affected live account. The executed
RED reproduction used the candidate and synthetic migrated production-schema
fixtures. The linked-token regression was candidate-specific; production source
already resolved linked ownership.

The migrated tests retain exact purchase rows across the bridge, restore prior
hashed transaction/event history without another grant, preserve scheduled plan
state, check concurrent notification replay, reject mismatched verified ownership,
and prevent deleted-account balance/plan recreation. No production configuration, external account, provider, store purchase or
deployment was used. All repository edits and execution were local.
