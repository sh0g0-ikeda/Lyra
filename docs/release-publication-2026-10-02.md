# Release candidate publication record

## Source identity

The initial published commit `f83018e14c4ccaf658351f126594ac56130c9f6d` uses
the runtime and test source from local commit
`a847ba15dfd33105d00c13bf2fa547315840b0dd`, plus the recovery review and local model
from `3bd2bd57ad4bbc8d0217a8cf7154230374635fc9`. Publication-only documentation
removes private operational observations and an original conversation identifier.
No runtime, migration or client behavior is changed by those documentation edits.

That initial GitHub commit was created from the complete reviewed tree, with the existing
public PR #220 commit `2bb4e2dabd24c3116c5dae86a177754b367e245d` as its parent.
Its commit SHA therefore differs from the local work commits. The draft PR targets
main and includes the earlier integration chain. The exact remote commit and its
CI results must be read from that PR, not inferred from local commit IDs or old CI.
Intermediate local documentation versions are not added to the public history.

## Checks and authorization boundary

Local runtime verification is recorded in
`release-state-copy-addendum-2026-10-02.md`. The recovery review's model and SDK
wire checks are documented in `review/state-copy-recovery/README.md`.

Before publication, the repository installation included Lyra with push permission,
and the previously denied Git data write succeeded through the same connector.
A public-source review checked new tracked content for credentials, personal data,
and private operational observations. The single CI workflow runs isolated test
PostgreSQL databases, tests, builds, browser smoke tests and local Expo exports.
It has no deployment, EAS cloud build, store submission, OTA update, provider
credential injection or paid image-generation command. The public repository's
standard GitHub-hosted Linux jobs are used; no larger runner is requested.

Publication and CI do not authorize merge, migration, deployment or store release.
The production, provider, visual and device gates in
`release-readiness-2026-10-01.md` remain. The recovery packet is a design with local
model evidence; its future storage protocol is not implemented or accepted in S3.

## CI-discovered correction

The initial run [36903079413](https://github.com/sh0g0-ikeda/Lyra/actions/runs/36903079413)
passed the full PostgreSQL 16 Vitest suite (2,512 tests) and the complete Mobile job
(926 tests, 20/20 Expo doctor checks, Android and iOS local exports). Its additional
PostgreSQL 18.3 integration suite found an intermittent same-subject first-login
race: the subject lookup missed, another transaction committed, and the email
lookup then incorrectly required account linking. That integration stage failed
1 of 193 tests; later backend/build/browser stages in that run were skipped.

The correction and deterministic interleaving regression are separate source
changes after a847ba1; the updated candidate must not be described as runtime
byte-identical to that earlier commit. The verified identity subject must match
the stored subject exactly before reusing a concurrently created account.
Different-subject email collisions still require explicit linking, and this path
must not grant another signup bonus. Final CI evidence belongs to the latest
exact PR head, not this failed initial run.

The next run [36904280774](https://github.com/sh0g0-ikeda/Lyra/actions/runs/36904280774)
passed all 2,519 Vitest tests, all 197 PostgreSQL 18.3 integration tests and the
complete Mobile job. Bun 1.4.2 passed all 2,519 test assertions, but the lineage
fixture suite's final cleanup hit its default five-second hook limit while
closing and dropping the accumulated test schemas. The resulting hook failure
kept CI red and skipped the later build/browser stages. Its bounded test-only
cleanup correction must not change migration checks or production lock limits.
