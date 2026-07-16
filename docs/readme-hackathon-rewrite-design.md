# Hackathon README rewrite design

## Purpose and scope

Rewrite `README.md` so a first-time hackathon reviewer can understand Lyra's
problem, user flow, differentiators, architecture, live demo, and local startup
path without reading operations documentation first.

This change does not modify application behavior, APIs, persistence, billing,
authentication, generation jobs, or cloud resources. Detailed production
configuration remains in the existing specification and operations documents.

## Specification basis

- `docs/Lyra_Unified_Spec_v4.md` section 2 for the product boundary and primary
  user flow.
- Section 3 for architecture boundaries.
- Sections 4 through 9 for authentication, tenancy, generation, billing,
  safety, and availability claims.
- Section 10 for verification commands.

## Information order

1. Product name, one-sentence value, visual, live demo, and CI state.
2. User problem and Lyra's editable story-to-page approach.
3. Main features and an end-to-end user flow.
4. Technical differentiators and a Mermaid architecture diagram.
5. Technology stack and repository map.
6. Minimal local startup with image generation disabled by default.
7. Optional provider setup, verification commands, and documentation links.
8. Current operational notes and project status without exposing secrets.

## Security and accuracy controls

- Do not include credentials, account IDs, private endpoints, or secret values.
- Describe only features present in current code and the maintained spec.
- Make it explicit that local AI/image generation requires provider credentials.
- Keep production configuration in referenced documents instead of encouraging
  readers to paste production secrets into local files.

## Verification

This is documentation-only, so a new failing automated test is not useful.
Verify Markdown links and image paths, Mermaid syntax, documented package
scripts, UTF-8 text integrity, `git diff --check`, and the existing CI workflow.

## Delegation

No Terra delegation. The write scope is one README plus this short design note,
and the product claims must be reviewed together against the current spec.
