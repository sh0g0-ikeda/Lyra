# Episode page plan continuity v3 design

## Purpose

The story-to-pages compiler currently compiles long episodes in independent
three-page chunks. Each chunk sees the source story, but it does not receive a
binding record of which beats earlier chunks already used. This permits repeated
dialogue, repeated discoveries, and timeline rewinds across chunk boundaries.

Continuity v3 keeps the existing route, queue, page/panel persistence contract,
and three-page detail compiler. It adds an in-memory episode plan before the
detail chunks and an in-memory audit after them. No database migration or public
API shape change is required.

## Responsibilities

### Episode beat planner

The planner reads the complete episode context once and assigns every existing
page:

- owned story beats
- entry and exit state
- new information introduced on the page
- dialogue intent
- handoff into the next page

Every existing page must appear exactly once. Unknown, missing, or duplicated
page identifiers fail the job before persistence.

Each page entry also exposes its current `frame_count`. The planner must use it
as capacity for distinct visual beats rather than filling additional panels by
repeating an action or line. Scene-level character state notes (costume, injury,
hair, expression, and other continuity notes) are included with canonical entity
names so those facts remain stable across page and chunk boundaries.

The source fields accepted by the story API are preserved in the planner brief.
Scenes, aliases, and malformed over-limit data continue to use the existing
prompt-compaction limits. Planner output has enough response-token headroom for
the maximum supported 32 pages, while schema bounds still cap provider cost.

### Existing detail compiler

The current episode page compiler remains responsible for editable page and
panel fields. Each three-page chunk additionally receives:

- the complete episode ledger
- the exact ownership for its pages
- summaries of already compiled pages
- beats reserved for later pages
- repair instructions when a bounded retry is required

This preserves the established schema and field-level quality repair.

### Episode auditor

After all chunks are combined, deterministic checks detect exact repeated
dialogue/narration and exact visual beats across every pair of pages, including
adjacent pages. A continuous scene must still advance the visible action instead of
reusing the same panel situation text. An LLM audit checks
semantic repetition, dialogue placement, character knowledge, chronology, and
page-boundary handoffs.

Only chunks containing reported pages may be compiled again, and each affected
chunk may be retried at most once. The complete result is audited again. Any
remaining material issue fails closed and no page/panel content is persisted.
During repair, the target chunk receives compact summaries of every unaffected
compiled page on both sides, so an earlier-page handoff can be corrected without
breaking a later destination. The current chunk draft is supplied separately
with all editable visual, dialogue, entity, and note fields under its own prompt
budget. After the repair compiler returns, pages in that chunk which were not
explicitly named by the audit are deterministically restored from the pre-repair
draft. The model therefore cannot rewrite an otherwise valid neighboring page
merely because it shares the same three-page chunk.

### Concurrency guard

A stable fingerprint of the editable episode context is captured after layout
metadata repair. The same authorized context is fetched again after compilation
and before persistence. A mismatch raises a conflict instead of overwriting user
edits made while the long-running job was active.

## Layer placement

- `services/page`: planner/auditor ports, deterministic continuity checks, and
  orchestration in `PageService`
- `infrastructure/openai`: strict structured-output planner and auditor adapters
- `lib/validators`: bounded Zod contracts for both structured outputs
- `app.ts` and `worker/dependencies.ts`: identical feature-flagged dependency
  wiring so local/API and SQS worker behavior cannot drift

## Failure and rollback policy

- Planner, detail compiler, or auditor configuration/schema failure: no content
  persistence.
- Invalid page coverage: no content persistence.
- Duplicate story ownership, including duplication within one page: no content
  persistence.
- Audit still failing after bounded repair: no content persistence.
- Context changed during compilation: conflict, no content persistence.
- `EPISODE_PAGE_PLAN_CONTINUITY_V3_ENABLED=false`: use the existing v2 chunk
  orchestration without planner/auditor calls.

## Security and cost boundaries

- Existing user/organization-scoped repository reads and writes remain in use.
- No new public endpoint, user-supplied identifier, secret, or storage location
  is introduced.
- All LLM responses are strict-schema validated and bounded.
- Story text is treated as untrusted data rather than instructions in planner,
  detail-compiler, and auditor system prompts.
- Ledger, completed-page, and audit summaries use adaptive character budgets.
  Every page remains represented at the 32-page production contract boundary;
  panel-summary compaction is also stress-tested beyond the normal eight-panel
  story-AI limit without repeatedly sending multi-megabyte prompts.
- Repair prompts split the global completed-page budget from the current-draft
  budget. This keeps every episode page visible while preserving enough detail
  to repair shot, angle, composition, background, notes, effects, dialogue, and
  entity assignments without silently erasing unrelated fields.
- Normal long-episode cost is one planning call, the existing detail chunk calls,
  and one audit call. Repair is bounded to one retry per affected chunk plus one
  final audit, preventing unbounded token or API cost.

## Progress stages

The existing asynchronous job records these additional stages:

1. `planning_episode`
2. `compiling_chunk`
3. `auditing_episode`
4. `repairing_chunk`
5. `applying`

The UI continues to use the current persisted progress message and progress bar
contract.
