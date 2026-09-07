# Entity candidate preview API release — 2026-09-07

## Outcome

The organization-scoped candidate-image query repair is deployed as API task definition `lyra-prod-api:130`. ECS completed the deployment at 23:15:42 JST with two running tasks, no pending tasks, and no failed tasks. The worker remains on revision 73 with one running task.

This fixes a valid `organization_id` being rejected as an unknown query field after organization authorization had already succeeded. It preserves organization membership, candidate-token binding, and strict rejection of other unknown fields.

## Artifact provenance and rollback

- Source commit: `c28718657af41804e21958e6dbae3212558a9df2`.
- Review: <https://github.com/sh0g0-ikeda/Lyra/pull/207>, based on the deployed `dda4fda` source line.
- Base image digest: `sha256:d166522f350f93131f91c5519d335da14ea23076d46b29727b6d419c5e6269f4`.
- Deployed image digest: `sha256:b6883fe10b21f7c64a626cbc71b5a6c11a25211d991928595036bd6cecb48ead`.
- Compiled `dist/src/routes/entities.js` SHA-256: `08e3d0c0cfad218cca944667c612d475a69e64e8f5ce8d2ad1f62af35e59f45e`.
- Rollback target: API task definition `lyra-prod-api:129` and its base image digest above.

The ARM64 image preserves every layer of the exact running production image and adds one layer replacing only the reviewed compiled route. Runtime file ownership is 65532:65532 and mode 644. The registered task definition was compared against revision 129: only the API container image differs. CPU, memory, roles, environment, secrets, network settings, and logging are identical. No database, migration, worker, queue, or frontend deployment was performed.

## Verification

- TDD reproduced the valid organization request returning 422 before the fix.
- Focused route/security tests: 26 passed, including organization scope transfer, non-member rejection, invalid UUID, unknown query fields, personal candidate access, and rejection of a token for another character.
- Backend Vitest: 1,657 passed; four DB-dependent tests are separated into the repository DB gate. Backend build passed.
- GitHub backend `verify` passed: <https://github.com/sh0g0-ikeda/Lyra/actions/runs/34130659764/job/101769718143>.
- A network-isolated container smoke test imported the actual application and returned health 200 from the built ARM64 image. Image architecture, inherited layers, route hash, file ownership, and mode were verified.
- Both running production tasks report the deployed digest above. ALB reports both new targets healthy; the old targets were draining after ECS completed the rollout.
- Public `/healthz` and `/readyz` both returned 200 after the rollout completed.
- Logs observed from 23:13 through 23:17:46 JST contained 69 successful HTTP responses, no error-level entries, and no 5xx responses. This is a bounded observation window, not proof against future failures.
- Generation queue and dead-letter queue each reported zero visible, in-flight, and delayed messages.

## Existing CI exception and limits

PR #207's `mobile-verify` failed at `npx expo install --check` because its old deployed base contains earlier Expo/RN patch versions. Failed job: <https://github.com/sh0g0-ikeda/Lyra/actions/runs/34130659764/job/101769717917>.

`git diff dda4fda -- apps/mobile .github/workflows` is empty. This API artifact changes only the compiled backend route. Sol reviewed this as a non-blocking baseline exception for this API-only incident rollout; the PR as a whole is not described as green. Updating old-base mobile dependencies would expand the hotfix beyond the deployed API contract. The actual mobile release is independently based on the current mobile dependencies, and both of its CI jobs passed in PR #206.

Organization/personal authenticated candidate behavior was verified in route tests; a live authenticated phone preview was not performed. No paid generation was initiated solely for release verification.

## Related mobile repair

<https://github.com/sh0g0-ikeda/Lyra/pull/206> synchronizes successful saves before generation, preserves current edits and imported candidates, and binds new image imports to a resolved saved character. APK 1.0.6 / 99: <https://expo.dev/accounts/sh0g0/projects/lyra-mobile/builds/56df57bb-818d-4a4b-8d12-0f0312132d0a>.

An image candidate previously issued without a character binding must be imported again for the selected saved character in the fixed app; the signed token cannot be repaired by relabeling it in the client.
