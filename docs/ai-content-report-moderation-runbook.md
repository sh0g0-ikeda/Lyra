# AI-generated content report moderation runbook

## Purpose

Lyra Mobile lets an authenticated user report an inappropriate StoryAI proposal
or generated image without leaving the app. The report is a safety signal, not a
public-post or social-network moderation workflow.

Private organization members can also report inappropriate workspace content or a
member from Organization management. This is delivered as an
`organization_safety_report_received` event after the API verifies active membership.

## Data received

The API writes one structured `ai_content_report_received` event containing only:

- opaque report ID;
- opaque authenticated user ID;
- `generated_image` or `story_proposal`;
- optional opaque page, entity, or episode ID;
- the fixed reason `unsafe_or_inappropriate`;
- request correlation ID and receipt time.

Do not add story text, prompts, generated text, image URLs, email addresses,
authentication tokens, provider responses, or stack traces to this event.

The organization event contains only an opaque report ID, organization ID,
authenticated reporter ID, `workspace_content` or `member`, the fixed reason,
request correlation ID, and receipt time. It never identifies a target member or
attaches workspace content.

## Review cadence

1. During normal operation, the designated operator checks the `lyra-prod-api`
   CloudWatch log group at least once each business day for
   `ai_content_report_received`.
   Include `organization_safety_report_received` in the same review.
2. During a store review or after a safety incident, check at the start and end of
   each support shift.
3. Record the report ID, disposition, category, action, and completion time in the
   restricted operator incident register. Do not copy user content into that register.

Example CloudWatch Logs Insights query:

```text
fields @timestamp, report_id, user_id, content_kind, content_id, request_id
| filter event = "ai_content_report_received"
| sort @timestamp desc
| limit 100
```

Run the same query with `event = "organization_safety_report_received"` and fields
`organization_id`, `reporter_user_id`, and `target_kind` for organization reports.

## Triage and action

- If the report suggests child sexual exploitation, a credible threat, self-harm,
  fraud, or other illegal or imminently harmful material, restrict further access
  as appropriate and escalate immediately under applicable law and provider rules.
- For other offensive or unsafe output, reproduce only when safe using a controlled
  test account, classify the failure, and update prompt constraints, provider safety
  settings, or deterministic filters.
- Do not access another tenant's content merely because an opaque ID was reported.
  Any content lookup must use an authorized operator procedure with a recorded reason.
- For an organization content/member report, use the reporter ID through the
  authorized account-support procedure to contact the reporter, identify the exact
  target, record consent and scope for any investigation, and act on confirmed
  violations. The initial event intentionally contains no raw content or target ID.
- Close false positives without penalizing the reporting user.

## Verification

Before each store submission:

1. Use a dedicated reviewer/test account to generate safe test content.
2. Tap the in-app report action and confirm the app displays the receipt success state.
3. Confirm the matching report ID appears in `lyra-prod-api` logs.
4. Confirm the event has no raw story, prompt, image URL, email, or token.
5. Record the verification date and build number in the release checklist.
6. From a private organization member account, send both organization report types
   and verify the two privacy-minimized receipt events.

If delivery cannot be confirmed, the store artifact is not ready for submission.
