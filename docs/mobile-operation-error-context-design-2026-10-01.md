# Mobile operation error context

## Purpose and authority

Close adopted U13's loss of operation context in Mobile Story, Characters, and Pages.
The source is `01c1bf6` design/05-フロント.md §3 and Unified Spec §§6–8, 11:
safe reasons, named operations, saved/unsaved range, retry guidance, and verified
settlement must remain distinguishable. This is a client presentation change; no
API, persistence, generation admission, permissions, or pricing contract changes.

## Design before implementation

- Carry a typed, localized operation descriptor alongside each error instead of
  flattening to `Error[]`. Keep recovery actions supplied by the owning screen.
- Describe current retained local fields only when the editor is dirty. Do not
  promise durable recovery, autosave, rollback, or that the server rejected a write.
- A failed read cannot submit an edit. Failed writes have unconfirmed server state;
  cancellation does not prove a job stopped. Paid request/settlement details remain
  authoritative in the existing quote and job UI, never inferred from HTTP failure.
- A query refresh must say “Refresh status”, and must not replay a save, AI request,
  generation, or cancellation. Preserve the existing confirmed stale-draft reload.
- Deduplicate the same error object reported by nested saves and dirty guards,
  preserve distinct operation failures, and expose one accessible announcement per
  displayed notice. Remove duplicate page-generation text for the same failure.
- Reuse the existing safe error sanitizer; descriptors contain app-owned labels,
  never raw provider text, user content, credentials, or arbitrary navigation URLs.

## Verification

Write failing render cases first for save/load/network/free AI/paid AI/cancel/stale,
Japanese and English, unknown settlement, duplicate errors, and real screen draft
preservation. Then run targeted Mobile tests, typecheck, and lint. The parent runs
the full Mobile suite after independent changes converge. These checks do not claim
native simulator, device, VoiceOver, TalkBack, or external service acceptance.

## Implemented behavior and caller inventory

| Flow / source | Context and recovery evidence |
| --- | --- |
| `StoryScreen.tsx` operation collection/render | Named query/save/create/delete/free AI failures. Same nested mutation/dirty-save error is announced once. Episode title, full story, estimated pages and starting-state edits remain local on failed save. Query refresh does not resubmit a mutation. Resource/workspace changes reset old errors; late dirty-save catches are scope-checked. The hierarchy's own query error is not repeated by Story. |
| `CharactersScreen.tsx` operation collection/render | Named entity/detail/reference/state/job reads and character/state/reference writes. Query refresh includes the selected entity detail. Local retention depends on the current dirty editor. Error scopes include session, organization, work, entity and selected state. A failed explicit reload is identified as a read, not a save. |
| `PagesScreen.tsx`, `PageErrorRecoveryNotice.tsx` | Named page/panel/frame reads and writes, design/autofill/cancel/image/export operations. The same generation failure no longer renders twice. Scope resets and the existing confirmed stale reload remain. Quote/job cards remain the authority for settlement; timeout and cancellation errors never invent a charge or refund. |
| `AccountScreen.tsx` job actions | Cancel/hide/retry failures retain their operation and `mutation.variables.id`. Recovery reads job history only. Session/workspace changes reset these errors. Hide-history explicitly changes visibility only, not job state or credits. Existing `JobStatusCard` still displays the server's settlement. |
| `StoryHierarchySheet.tsx` | Create/rename/reorder/delete/title-read errors retain operation and target. A title failure is displayed once inside the active title modal, not behind it, with the typed title retained. A successful write followed by refresh failure states that the server confirmed the write. Error presentation is scoped to session/workspace. |
| `WorkspaceContextPicker.tsx`, `WorkspaceHierarchyNavigator.tsx` | Existing selection heading/path identifies the subject; notices now name the hierarchy read and label refetch as status refresh. No save is replayed. |
| `MangaLibrary.tsx` | Existing library/resume target remains; hierarchy and production-progress reads now have separate names and status-refresh labels. |
| `InvitationScreen.tsx` | Preview read now has an explicit operation and refresh label. Acceptance error remains adjacent to the organization, invited email, role, signed-in account and accept button; its existing retry actually invokes acceptance, so it keeps the retry label. No editor draft or image charge is involved. |
| `JobStatusCard.tsx` | Existing job type/ID, unknown-read guidance, current status, server settlement and refetch already provide context. This pass preserves them. |
| `PageGenerationQuoteDialog.tsx`, `AssetGenerationQuoteDialog.tsx` | Existing operation/target, quote, phase, unknown-outcome reconciliation and re-quote actions provide context. This pass neither changes admission nor derives settlement from an error. |
| `EntityStateEditor.tsx` | Separate coordinated fix distinguishes state save, reference confirmation and later refresh failures; its state-specific outcomes are not replaced by the generic helper. See the state-outcome tests/design. |
| `StoryCollaborationPanel.tsx` | Error is colocated with the named free-story consultation action, instruction and proposal; apply-to-draft remains separate. No automatic application or paid generation is introduced. |
| `AccountScreen.tsx` organization creation and `OrganizationManagementPanel.tsx` usage CSV | Existing operation-specific section/CTA and current organization identify these actions. CSV transfer errors use the safe file-transfer reason. The shared 5xx reason no longer makes an unconditional input-preservation claim. |
| `SessionBootstrapRecovery.tsx`, `AuthScreen.tsx` | Existing connection/login explanation and retry/account-switch controls identify recovery; there is no content save or image-settlement result to infer. |

This inventory is source and rendered-behavior reconciliation, not an assertion
that every legacy organization-settings notice was redesigned or that native
accessibility has been accepted. Existing member/invitation/billing management
notices remain within their named sections and original permissions. The concrete
new-editor, job-action and hidden-title-modal gaps above are closed locally.

## Test evidence

- The operation render suite failed before its helper existed, then passed the
  save/load/network/free AI/paid AI/cancel/stale/dedup cases in Japanese and English.
- A real Story render regression first failed because operation context was absent;
  it now checks all four retained field groups and proves refresh does not save.
- Real Character and Pages render tests check retained values and no write replay.
- The Account cancel/hide/retry render tests and active title-modal error test each
  failed before their wiring changes and pass afterward.
- Confirmed hierarchy creation followed by refresh failure disables submitting the
  create action again. Its status-refresh test proves only reads occur and closes
  the title dialog after successful recovery.
- Notice rendering exposes one polite alert and a separate labeled recovery button.
- Translation-key parity, shared 5xx uncertainty, scope-change regression and
  confirmed-write/failed-refresh copy are covered. TypeScript and full Mobile lint
  pass. The full suite passed 186 files / 1001 tests before the final additional
  confirmed-create recovery regression; that regression and related suites pass.
  The coordinating release check records final combined totals.

## Final combined UI checkpoint

After all coordinated changes froze, the full Mobile suite passed 186 files /
1,011 tests, typecheck, full lint, generated contracts and mojibake checks. Earlier
in-progress sibling failures and intermediate counts above are historical evidence,
not the final result. The delivered manifest pins this result to the final source
commit; browser/native and live external acceptance remain unrun.
