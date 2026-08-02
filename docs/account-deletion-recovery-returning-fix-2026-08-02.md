# Account deletion recovery RETURNING fix - 2026-08-02

## Purpose and scope

Production pre-deploy smoke found that the account-deletion recovery worker
starts but its first recoverable-request claim fails with PostgreSQL error
`column reference "user_id" is ambiguous`. Fix only that repository query.

Out of scope: request/response contracts, migrations, persisted data shape,
deletion ordering, authentication, billing, generation jobs, the normal worker,
and existing Web or Mobile layout and colors.

## Spec basis and affected layers

- `docs/Lyra_Unified_Spec_v4.md` sections 3, 4, 5, 8, and 10.
- Affected layer: Repository only, plus its unit regression test.
- Input, output, transaction boundary, processing-token fencing, and durable
  request states remain unchanged.

## Security and data safety

- Keep the parameterized UUID processing token.
- Keep `FOR UPDATE SKIP LOCKED`, claim ordering, and the transaction boundary.
- Qualify only the `UPDATE ... FROM` `RETURNING` fields so PostgreSQL resolves
  them to `account_deletion_requests` rather than the candidate CTE.
- Do not expose identity IDs, asset keys, tokens, provider errors, or secrets.

## Test and release plan

1. Add a repository regression test that requires the returned request fields
   to be qualified by the update target alias and observe it fail first. Add a
   PostgreSQL integration test that executes the recoverable-row claim.
2. Apply the minimal SQL qualification and run the targeted test.
3. Run the full release gates and PR CI.
4. Build a new immutable arm64 image from the merged main commit.
5. Run the account-deletion recovery worker as a one-off smoke and require a
   successful startup recovery before enabling its service or API route.

## Terra delegation

The production discovery was independently reviewed by Terra. The two-file SQL
fix remains with Sol because it blocks the immediate deployment path and Sol
owns the final production decision.
