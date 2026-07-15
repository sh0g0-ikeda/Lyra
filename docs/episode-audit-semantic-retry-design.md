# Episode audit semantic retry design

## Purpose and scope

Prevent `episode_story_autofill` from failing immediately when an otherwise valid
episode-audit response names a repair field but omits its required patch value. The
change is limited to the episode audit compiler contract. It does not relax final
continuity checks, change page planning, alter persistence, or add fallback output.

## Spec basis

- `docs/Lyra_Unified_Spec_v4.md` section 6: structured review repairs are validated
  before atomic persistence, unresolved errors block persistence, and provider retry
  remains coordinated with cancellation.
- `docs/Lyra_Unified_Spec_v4.md` section 8: LLM output is schema-validated and
  quality-gated before persistence.
- `docs/Lyra_StoryAI_SubSpec.md` sections 5-7: dialogue keeps explicit speakers,
  failed or partial AI output is not saved, and structured responses are bounded.

## Affected layers and interfaces

- Domain validation: add cross-field checks between `changed_fields` and `patch`.
- OpenAI infrastructure: clarify the repair contract in the system prompt and reuse
  the existing bounded semantic retry path.
- No Route, Repository, migration, credit, Web, Mobile, or persistence changes.

For nullable text fields, `null` remains a valid explicit clearing value. For fields
whose destination contract is non-nullable, naming the field requires a non-null
patch value. In particular, `dialogue` and `entities` use an empty array to clear the
field; `null` means the repair value was omitted and is retryable invalid output.

## Security and reliability

- The retry remains capped by `EPISODE_PLAN_AUDIT_COMPILER_MAX_ATTEMPTS`.
- The cancellation checkpoint runs before the second provider request.
- Invalid output is never persisted or exposed to the user.
- No story text, provider payload, credentials, or raw provider errors are added to
  logs.
- This text-AI job remains free, so credit behavior is unchanged.

## Test plan

1. Add a compiler test where `changed_fields` contains `dialogue` but
   `patch.dialogue` is `null`; verify one retry and successful recovery.
2. Verify cancellation before that retry prevents the second provider call.
3. Verify two semantically inconsistent responses still fail without returning a
   partial audit.
4. Run the targeted compiler and page service tests, then the full release gates.

## Terra delegation

Terra performs a read-only audit of remaining failure and idempotency paths. Sol owns
the design, tests, implementation, integration, production diagnosis, and rollout.
