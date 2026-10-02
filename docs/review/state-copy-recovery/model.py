"""Bounded abstract protocol exploration. No network, SDK, DB, or credentials.

This is a design model, not an S3 emulator or a production recovery command.
Atomic conditional writes and immutable marker occupancy are explicit assumptions.
"""
from collections import deque
from dataclasses import dataclass, replace
import json


@dataclass(frozen=True)
class State:
    current: str = "absent"
    image_versions: int = 0
    image_requests: int = 0
    marker_requests: int = 0
    db_evidence: bool = False
    erased: bool = False
    marker_removed: bool = False


def transitions(s, *, versioned=False, unconditional=False,
                allow_marker_removal=False, unsafe_plain_delete=False,
                separate_marker=False, ignore_versions=False):
    # Every request may be delayed arbitrarily. Local timeout/crash adds no
    # information and is intentionally not a state-changing event in this model.
    if s.image_requests:
        next_s = replace(s, image_requests=s.image_requests - 1)
        if unconditional or s.current in ("absent", "delete_marker"):
            next_s = replace(next_s, current="image",
                             image_versions=s.image_versions + 1 if versioned else 1)
        yield "image_request_finishes", next_s
    if s.marker_requests:
        next_s = replace(s, marker_requests=s.marker_requests - 1)
        if separate_marker:
            # A different object's marker cannot participate in same-key CAS.
            next_s = replace(next_s, db_evidence=True)
        else:
            # Absent: IfNoneMatch='*'. Image: IfMatch=observed image ETag.
            # This abstracts a successful observation + CAS/retry into one step.
            # Stale-ETag conflicts and retry scheduling are NOT modeled here.
            next_s = replace(next_s, current="fence",
                             image_versions=s.image_versions if versioned else 0)
        yield "marker_CAS_finishes", next_s
    if s.current == "fence" and not s.db_evidence:
        # A lost DB acknowledgement simply delays this action; no expiry exists.
        yield "verified_marker_persisted", replace(s, db_evidence=True)
    if versioned and s.current == "fence" and s.image_versions:
        # Delete only the exact non-current image version, never current fence.
        yield "purge_one_image_version", replace(s, image_versions=s.image_versions - 1)
    if not s.erased and s.db_evidence and (s.image_versions == 0 or ignore_versions):
        yield "declare_erased", replace(s, erased=True)
    if unsafe_plain_delete and s.current == "image":
        # Represents deleting a successful image instead of atomic replacement.
        yield "plain_DeleteObject_then_declare", replace(s, current="absent",
                                                          image_versions=0, erased=True)
    if allow_marker_removal and s.current == "fence" and not s.marker_removed:
        # Lifecycle/delete marker/cleanup can reopen the conditional key.
        yield "marker_expired_or_deleted", replace(s, current="delete_marker" if versioned else "absent",
                                                     marker_removed=True)


def explore(initial, require_marker=True, **options):
    seen = {initial}
    queue = deque([(initial, [])])
    edges = 0
    erased_states = 0
    while queue:
        state, path = queue.popleft()
        if state.erased:
            erased_states += 1
        if state.erased and (state.current == "image" or state.image_versions > 0
                             or (require_marker and state.current != "fence")):
            return {"safe": False, "states": len(seen), "transitions": edges,
                    "counterexample": path}
        for label, next_state in transitions(state, **options):
            edges += 1
            if next_state not in seen:
                seen.add(next_state)
                queue.append((next_state, path + [label]))
    return {"safe": True, "states": len(seen), "transitions": edges,
            "erased_states": erased_states}


def main():
    checks = []
    for versioned in (False, True):
        for writers in range(4):
            for recoverers in range(1, 4):
                result = explore(State(image_requests=writers, marker_requests=recoverers), versioned=versioned)
                assert result["safe"] and result["erased_states"] > 0
                checks.append({"name": f"safe_v{int(versioned)}_writers{writers}_recovery{recoverers}", **result})
    negative = [
        ("legacy_unconditional_writer", State(image_requests=1, marker_requests=1), {"unconditional": True}),
        ("marker_expiration_unversioned", State(image_requests=1, marker_requests=1), {"allow_marker_removal": True}),
        ("version_delete_marker_reopens_key", State(image_requests=1, marker_requests=1), {"versioned": True, "allow_marker_removal": True}),
        ("separate_receipt_key", State(image_requests=1, marker_requests=1), {"separate_marker": True}),
        ("plain_delete_after_image_wins", State(image_requests=2, marker_requests=0), {"unsafe_plain_delete": True}),
        ("versioned_image_retained", State(image_requests=1, marker_requests=1), {"versioned": True, "ignore_versions": True}),
    ]
    for name, initial, options in negative:
        result = explore(initial, require_marker=False, **options)
        assert not result["safe"], f"Expected image counterexample: {name}"
        occupancy = explore(initial, **options)
        assert not occupancy["safe"], f"Expected occupancy counterexample: {name}"
        result["occupancy_counterexample"] = occupancy["counterexample"]
        checks.append({"name": name, **result})
    print(json.dumps({
        "model": "conditional_same_key_fence_v1", "checks": len(checks),
        "safe_scenarios": 24, "expected_counterexamples": 6,
        "checked_invariants": ["erased implies current ordinary fence", "erased implies no current or historical image"],
        "scope": "All reachable abstract states for 0..3 pending image requests, 1..3 recovery requests, versioning disabled/enabled, initially no object",
        "not_proven": ["real S3/IAM behavior", "timing or liveness bounds", "unbounded implementation correctness", "legacy operation settlement", "costs or erasure compliance"],
        "results": checks,
    }, indent=2))


if __name__ == "__main__":
    main()
