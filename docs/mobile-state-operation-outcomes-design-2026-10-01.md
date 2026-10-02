# Named-state operation outcomes

## Scope and basis

Fix only the named-state Mobile editor, its Japanese/English messages, and focused
component tests. The adopted frontend design at commit
`01c1bf6dc1057f1731770d4118e7508eee884433`,
`docs/uiux-backend-expansion-2026-09-30/design/05-フロント.md` §§3–4 requires
operation-specific, evidence-based saved-state and recovery copy. Unified Spec v4
§§4–8 and §11 require scoped data, safe errors, independent state previews, and
honest unknown outcomes. The backend, storage settlement protocol, API contracts,
credit rules, and feature gates do not change.

## Design before implementation

- Separate mutation failure/unknown outcome from a failed read after a successful
  mutation. A validated save response or pinned confirmation receipt remains
  authoritative even when subsequent refresh fails. Confirmation applies its
  returned reference descriptor and revision to the matching cached state.
- Keep safe state-specific JP/EN notices for save unknown, confirmation unknown,
  save succeeded/read failed, confirmation succeeded/read failed, and read failure.
  Describe local input as remaining on this screen, never durably backed up; do
  not infer unchanged remote images or charge/refund settlement from an error.
- Recovery performs reads only, covers each displayed query, handles errors, and
  requests rejected refetch promises explicitly. Unknown mutations cannot be
  replayed from the refresh action. Do not auto-adopt an ambiguous newly created
  state. After unknown image confirmation, expose a separate explicit same-request
  reconciliation action: the backend may need that request to settle its journal.
  Refresh its original completed job to renew expiring tokens (24-hour server TTL);
  pin state/revision, job, candidate index and count from the immutable completed
  result. Reject mismatched job/revision/candidate count or changed local scope or
  input. Never start a new preview for reconciliation.
  The candidate-order basis is `EntityGenerationWorkerService` (index-derived
  reference IDs), `EntityGenerationExecutionRepository.completeEntityGeneration`
  (only transitions processing jobs to completed), and `routes/jobs.ts` (ordered
  candidate mapping with refreshed tokens).
- A stale-copy reconciliation may fence/discard its old attempt and still return
  generic CONFLICT because the authored state changed. Do not interpret CONFLICT
  as settlement. After a successful read verifies changed saved name/description
  and revision, offer an explicit return to editing with the result unresolved.
  Keep local inputs and a separate uncertainty notice through subsequent saves.
  This exit itself performs no mutation or quote; later previews still require
  their normal explicit paid quote. An unchanged/failed read cannot release the
  hold by this path.
- State-picker navigation retains unknown confirmation requests by state ID for
  the current session/workspace/entity lifetime. Reselecting that state restores
  its held request and blocking notice; it cannot silently enable another preview.
  Job-terminal refresh callbacks use the caught read-recovery path.
- Apply a successful receipt before refreshing. Release mutation UI locking after
  the receipt so later edits remain possible; asynchronous refresh results cannot
  replace new drafts, newer operation feedback, or another selected state.
- Key editor lifetime by session/workspace/entity. Also pin asynchronous UI work
  to an operation sequence and selected draft snapshot. Stale callbacks must not
  write to another scope or overwrite newer cache revisions. Unmounted callbacks
  have no UI effects.
- Preserve the existing draft and cached prior image data until confirmation evidence
  arrives. After receipt, show the confirmed reference even if refresh fails; call
  older reference information the last loaded state, not a storage guarantee.
  Existing stale-reference image delivery rejects fingerprint mismatch, so the
  copy must not promise that every retained descriptor has a displayable image.

## Security and validation

Keep current capability checks and entity/state/organization scope. Validate
receipt identity before accepting it. Never expose raw errors, image tokens,
provider data, credentials, or storage keys. No providers, AWS, real charges,
commit, push, deployment, or schema changes.

First reproduce failed-refresh misclassification and lost confirmation receipts
with RED component tests, then implement GREEN. Include unknown-outcome recovery,
JP/EN copy, draft changes during refresh, state/session/workspace changes,
unmount, stale callbacks, and single-flight checks. Run focused Mobile tests,
Mobile typecheck, and Mobile lint.

## Verification result

- Initial RED: 11 new cases failed; 7 existing tests passed.
- Explicit reconciliation RED: 4 new cases failed; previous 18 passed.
- Navigation/callback RED: 2 cases failed; previous 25 passed. Fixed save-and-move
  sequencing without treating a failed read as a failed save.
- Stale-copy liveness RED: 1 new failure reproduced; 28 other cases passed.
- Final review RED: 2 regressions reproduced (state reselection dropping an unknown
  confirmation, and job-terminal callback rejecting on failed reads); 29 passed.
- Final focused coverage: 31 editor cases; 65 tests across six editor/domain,
  picker, API, quote, and dirty-provider suites passed.
- Mobile `typecheck`, full Mobile `lint`, and `git diff --check` passed.
- This is local mocked/component verification only. Real-device accessibility,
  production storage/provider enablement, and full-release acceptance remain
  separate gates.

## Final combined UI checkpoint

After all coordinated changes froze, the full Mobile suite passed 186 files /
1,011 tests, typecheck, full lint, generated contracts and mojibake checks. Earlier
in-progress sibling failures and intermediate counts above are historical evidence,
not the final result. The delivered manifest pins this result to the final source
commit; browser/native and live external acceptance remain unrun.
