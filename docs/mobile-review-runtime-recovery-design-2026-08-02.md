# Mobile review runtime recovery design (2026-08-02)

## Purpose and scope

This change removes four review-facing mobile failures without changing backend persistence, API payloads, billing behavior, or existing screen layout/colors.

- Give StoryAI's synchronous improvement request enough time to receive a response through the current CloudFront path, and classify a real client timeout deterministically.
- Consume the progress stage already present in legacy generation-job results so page-skeleton jobs do not appear stuck after their pages become visible.
- Clear the local page-design latch for every terminal state: completed, failed, or canceled.
- Keep Terms, Privacy, and Support reachable from the authenticated Account screen.
- Do not render transient Account balance/job-history query failures as red review-facing banners. Existing cached content and pull-to-refresh remain available; individual job outcomes and recovery actions remain truthful.

Out of scope:

- Backend routes, services, repositories, migrations, worker ordering, job payloads, credit settlement, and billing enablement.
- Moving controls or changing the established visual palette.
- Enabling App Store / Google Play products or organization checkout in mobile.

## Spec basis

- `docs/Lyra_Unified_Spec_v4.md`: generation-job lifecycle and recovery (section 6), safety and user-facing error boundaries (section 8), availability (section 9), and verification gates (section 10).
- `docs/Lyra_StoryAI_SubSpec.md`: episode improvement save-before-request flow and bounded StoryAI input/output contracts (sections 4-7).

## Affected layers and interfaces

- Mobile only: request policy/API client, job compatibility normalization, job status card, Pages/Story/Account screens, i18n, and tests.
- StoryAI input/output and episode save order remain unchanged. Only the client wait budget changes from the generic 30 seconds to a dedicated 55 seconds, below CloudFront's 60-second origin response limit.
- Job progress remains read-only. The client maps known `result.progress_stage` strings from the existing backend response into display labels.
- Legal links use fixed HTTPS URLs on `app.lyra-editor.com` and the existing safe external-link opener.

## Security and data safety

- No authentication, authorization, tenancy, credit, database, file, or provider changes.
- No raw provider/backend errors are added to the UI.
- External navigation remains HTTPS-only.
- Timeout handling distinguishes the client's own timer from an external/user cancellation and does not retry writes automatically.

## Test-first plan

1. Add failing tests for the dedicated StoryAI timeout and deterministic `REQUEST_TIMEOUT` error.
2. Add failing compatibility tests for existing backend story-plan progress stages.
3. Add failing component tests for initial failed/canceled terminal notifications and the story-plan progress copy.
4. Add failing source/integration contracts for Account legal links and absence of transient Account query-error banners.
5. Implement the smallest mobile-only changes, then run focused Vitest, mobile lint/type checks, and the production export/build verification available in the repository.

## Sol/Terra integration record

Read-only investigations were delegated for runtime-log correlation and mobile UI state analysis. Sol retains the design, implementation, integration, security review, and release decision. The investigations identified (a) a successful 30.858-second StoryAI backend response racing the mobile 30-second timeout and (b) a page-skeleton job whose pages were persisted before a long `applying_story_plan` phase completed.
