---
name: lyra-sol-terra-orchestration
description: Coordinate Lyra repository work with GPT-5.6 Sol as design owner and GPT-5.6 Terra as the delegated orchestration/execution agent. Use for Lyra feature work, bug fixes, refactors, migrations, production-readiness work, or any task where a Sol-led design brief should be split into Terra task packets, parallel investigation, bounded implementation, validation, and integration while honoring AGENTS.md and docs/Lyra_Unified_Spec_v4.md.
---

# Lyra Sol/Terra Orchestration

## Operating Model

Use Sol as the design owner and final integrator. Use Terra only for bounded work that can run beside Sol's current critical path: codebase investigation, implementation in a disjoint file set, test repair inside a clear scope, or validation of a completed plan.

Before editing, Sol must produce a design brief:

- Purpose and scope
- Spec basis from `docs/Lyra_Unified_Spec_v4.md`
- Affected layers: Route, Service, Repository, Domain, Infrastructure, Worker, or app
- Security risks and required controls
- Test plan and verification command
- Terra delegation plan, or "no delegation" with reason

Persist the design brief as a repository-persisted design/implementation comment before changing behavior. Prefer a short comment in a design note, test, or relevant implementation file that will remain useful after the change; do not use an ephemeral chat-only note as the AGENTS.md design comment.

For role details, read `references/role-contract.md` when assigning work between Sol and Terra.

## Workflow

1. Read `AGENTS.md`, `docs/Lyra_Unified_Spec_v4.md`, `git status --short --branch`, and `git log --oneline -10`.
2. Establish the Git baseline: clean `main`, `git pull origin main`, and a new typed branch are the default. If the worktree is dirty, do not switch or pull across user changes; create a branch from the current HEAD only when safe, record the deviation, and keep pre-existing changed paths out of commits.
3. Map the requested task to the current Lyra contract. If the old phase label is absent, use the closest current spec section and state that mapping.
4. Write the design brief before implementation.
5. Write or update tests first for code changes. Confirm the new test fails for the expected reason before implementing unless the task is documentation-only or a genuinely non-testable wiring change; record the reason for any exception.
6. Decide whether Terra is useful. Delegate only if the task has a self-contained sidecar or disjoint write scope.
7. If `multi_agent_v1.spawn_agent` is available and Terra delegation is justified, spawn Terra with `model: "gpt-5.6-terra"` and a concrete task packet. Use `agent_type: "explorer"` for read-only questions and `agent_type: "worker"` for bounded edits. If the tool is unavailable, run the Terra packet locally as a checklist and report that fallback.
8. Continue Sol's non-overlapping critical-path work while Terra runs.
9. Review Terra output before integration. Do not accept broad refactors, reverted user edits, missing tests, or changes outside the assigned ownership.
10. Run task-local verification first, then run PR/release gates when the change is intended to ship.
11. For implementation tasks, commit one logical change at a time, push the branch, and open a PR using the AGENTS.md template. Only skip commit, push, or PR when the active user instruction explicitly requests local-only/no-commit/no-push work or credentials/tooling make it impossible; record the exception.
12. Report what changed, why, user-visible behavior, technical notes, and residual risks in the AGENTS.md completion format.

For Lyra-specific gates, read `references/lyra-gates.md` before implementing code, migrations, external API calls, credit logic, auth-sensitive routes, or generated-output persistence.

## Terra Delegation

Use `references/terra-task-packets.md` for prompt templates. Every Terra task packet must include:

- Objective
- Owned files or explicit read-only scope
- Inputs and relevant spec sections
- Constraints: do not revert others' work, no secrets, no production operations
- Expected output: changed paths or findings, tests run, risks

Prefer one Terra worker per disjoint write set. Prefer a Terra explorer for independent questions whose answer would improve design without blocking Sol's immediate next step.

Do not delegate:

- The design brief itself
- Final integration decisions
- Secrets handling, production deployment, or destructive Git operations
- Any task whose result blocks Sol's very next action

## Validation

For Skill changes, run:

```bash
python C:\Users\shogo\.codex\skills\.system\skill-creator\scripts\quick_validate.py skills\lyra-sol-terra-orchestration
```

For Lyra implementation changes, use the repo's normal gates from `package.json`, starting with the most relevant test command and including `npm test`, `npm run build`, `npm run web:lint`, `npm run web:build`, `npm run db:check-invariants`, or Playwright only when the changed surface warrants it.

For release or PR-ready work, use the full contract from `docs/Lyra_Unified_Spec_v4.md`: Vitest and Bun test entrypoints, PostgreSQL migration and invariant checks, backend TypeScript build, frontend lint and production build, Playwright auth and authenticated-console smoke tests, and any deployment-specific checks for production rollout.
