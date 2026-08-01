# Mobile panel structure controls

Date: 2026-08-01

## Purpose and scope

Connect Mobile panel append, delete, and adjacent reorder controls only to the
additive `PUT /api/pages/:id/panel-structure` safety boundary introduced by PR
#155. The Mobile client must continue reading and editing the existing
`PanelRecord` shape through the existing Panel list/content/assignment APIs.

This slice does not change Backend, database, migration, prompt, SQS, Worker,
credit, Web, Panel persistence, Frame persistence, Balloon persistence, or any
existing HTTP request/response body. It does not add Frame or Balloon editing
controls.

## Specification basis

- `docs/Lyra_Unified_Spec_v4.md` Architecture and Verification contracts.
- The Page-scoped panel structure command contract in the same Spec.
- `docs/panel-structure-safety-design-2026-08-01.md`.

## User flow

- The panel list exposes append, delete, move earlier, and move later actions.
- Append is unavailable at eight Panels. Delete is unavailable when the Page
  has one Panel. Move actions are unavailable at their respective list edge.
- Delete requires explicit confirmation.
- A structure action first resolves an unsaved Page-settings draft, followed by
  the selected Panel content or entity-assignment draft. Cancel or save failure
  stops the command without changing the structure.
- One structure command may run at a time. From command acceptance through
  dirty resolution and reconciliation, Page settings, Panel selection, Panel
  content, and assignments are blocked. Cancel safely releases the block.
- Append selects the authoritative newly created Panel. Delete selects the next
  Panel at the removed position, or the previous final Panel. Reorder preserves
  selection by Panel ID.

## API and reconciliation rules

The client sends the complete currently observed ordered Panel IDs as
`expected_panel_ids`. Reorder sends every ID once in the desired order. The API
client validates the strict response schema and its semantic relation to the
request: operation-specific created/template fields, unique ordered IDs, Page
ownership of Frames, and a one-to-one Panel/Frame set.

A structure response contains IDs and Frames, not complete `PanelRecord`
objects. Mobile therefore never constructs or patches a Panel from that
response. After every accepted command it refetches both the Panel list and the
Page list and adopts only those authoritative records when their counts and
ordered IDs match the accepted response.

Append and delete are not retried automatically after a network, 5xx, timeout,
or invalid-success-response failure. Mobile records the original intent and
refetches instead:

- the desired structure means the command is treated as completed;
- the original structure means it was not completed and a later manual retry
  may use the refreshed snapshot;
- any other structure is a remote conflict and is displayed authoritatively.

If either refetch fails, structure actions remain disabled and a manual
reconciliation control is shown. A retry only refetches; it never resends the
mutation.

The existing authenticated transport has one narrow exception: an HTTP 401 is
returned before a protected route accepts a command, so Mobile refreshes the
token and sends the same request once. It does not resend after 409, any other
4xx, network failure, 5xx, timeout, or an invalid success response.

## Scope and cache safety

The operation captures session, workspace, work, Page, and Panel scope. A late
result from an old scope cannot update the current selection, notice, or query
cache. Organization scope is carried on the new request and both refetches.

## Security and compatibility

- The Backend remains responsible for authentication, ownership/membership,
  `edit_work`, transaction locks, active-job rejection, and the 1..8 invariant.
- Mobile validates bounds and response semantics as defense in depth.
- Provider errors and raw server details are never rendered.
- No optimistic structural cache mutation is used.

## Test-first plan

1. API client tests for URL/body/scope and malformed semantic responses.
2. Panel section tests for bounds, request snapshots, adjacent reorder,
   delete confirmation/selection, single-flight, dirty resolution order,
   authoritative refetch, 409, ambiguous outcome, and scope isolation.
3. Pages screen wiring test proving Page settings are resolved before the
   structure request and Page metadata is refetched.
4. Mobile typecheck/lint/tests/contracts/Expo/Android/iOS, followed by the full
   Backend/Web regression gate because the shared app contract is consumed.

## Sol/Terra delegation

Terra performed a read-only survey of the current Mobile screen, query cache,
dirty-state, and API boundaries. Sol owns this design, tests, implementation,
integration review, and release decision. No parallel implementation is used
because the API/reconciliation/UI state machine is one coupled ownership slice.
