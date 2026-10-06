# Account deletion integration for fenced state references

Local-only implementation under the default-OFF v2 design, grounded in the
account-deletion and persistence contracts in Unified Spec §§4–6. Existing v1
unknown copies keep their legacy active-job hold. A separate personal v2 count
requires asset acknowledgement without preventing the user-lock deletion claim.

Once claimed and legacy blockers are rechecked, fencing and complete historical
image erasure precede subscriptions, ordinary object deletion, anonymization and
identity changes. Missing recovery, unknown outcomes, or invalid receipts remain
durable pending work. The same 25-request / 15-second budget spans nested SDK
requests and ordinary external steps; a budget continuation adds no failure.
Reserved v2 keys never enter ordinary deletion, including malformed keys or old
key checkpoints. The final user-lock transaction checks durable v2 evidence again
and atomically scrubs terminal personal journal payloads before job/work cleanup.
Organization journal rows and the opaque marker evidence survive personal cleanup.

Tests use mock remote storage and disposable PostgreSQL only. They cover explicit
acknowledgement, ordering, budget continuation, legacy holds, delayed writes,
confirmed-image fencing, partial version erasure, and rollback of the final scrub.
No AWS, credentials, retention settings, fees, deployment or publication are used.

Independent review found that the journal may outlive its original job/work, so its unscrubbed personal candidate source must remain in the ordinary deletion inventory. The final implementation validates the original owner/entity namespace, excludes organization sources and conflicting surviving ownership, and fails closed on malformed/foreign journal sources before finalization can erase the last pointer. Destination markers are excluded from every ordinary deletion adapter, including general image maintenance. Local regressions model orphaned source records and assert the exact source deletion occurs before terminal scrub.
