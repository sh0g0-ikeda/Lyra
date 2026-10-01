# Concurrent first-login lookup race

## Scope and contract

Fix the intermittent `ACCOUNT_LINK_REQUIRED` failure during two first logins for
the same verified authentication subject. This implements the existing contract
in `docs/Lyra_Unified_Spec_v4.md` §4 and the stable-subject/signup-atomicity section
of `docs/google-identity-link-readiness-2026-10-01.md`; it adds no linking or
identity-migration behavior.

## Interleaving and service responsibility

At PostgreSQL's default READ COMMITTED isolation, request A can read no user by
subject, then request B can commit its user, balance and signup grant before A's
email lookup. The latter lookup sees B's row. The existing unconditional email
collision error incorrectly rejects A, although both verified subjects match.

Before rejecting a row found by email, the provisioning service will compare its
stored subject with the normalized verified subject. Exact equality returns the
existing user through the existing email-sync path, with `isNewUser: false` and
no signup grant. A different subject still receives `ACCOUNT_LINK_REQUIRED`.
Conflict-safe insertion and the surrounding account/credit transaction remain
unchanged, as do deletion guards and provider-linking requirements.

## Security and regression proof

- Email equality alone never grants access or changes an authentication subject
- Exercise native and federated claims at the same deterministic boundary: the
  first transaction's subject query returns no rows, another real transaction
  commits, then the first transaction continues to its email query
- Same-subject requests must share one user, one balance and one 30-credit grant
- Different-subject requests must fail without changing the winner's subject or
  creating another user, balance or grant
- Show the new same-subject tests fail on the old implementation, then pass on
  the fix; rerun the existing insertion-conflict and rollback coverage

## Local verification

Before the fix, the three new unit cases and both deterministic same-subject
PostgreSQL cases failed at the original rejection. The distinct-subject cases
continued to reject correctly. After the fix, 76 auth/middleware unit tests and
TypeScript no-emit passed. All eight atomic-provisioning PostgreSQL 18.3 cases
passed in 20 consecutive runs (160/160). The repeat test uses disposable databases
and synthetic identities, without provider or production access. Full CI still
must pass against the updated PR head.
