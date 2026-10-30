"""Build a local, DNS-only Cloudflare record plan from Route53 JSON.

Design: this module has no AWS, Cloudflare, or network dependency.  It copies
its input, rejects routing semantics that cannot be represented safely, and
emits only records with ``proxied: false``.  Account and Cloudflare zone IDs
are caller-supplied registration context; this planner never holds a token or
performs a create, update, nameserver, or registrar operation.
"""

from __future__ import annotations

import argparse
import copy
import json
import re
from collections import defaultdict
from collections.abc import Mapping, Sequence
from typing import Any


ALLOWED_TYPES = {"A", "AAAA", "CNAME", "MX", "NS", "TXT"}
POLICY_KEYS = {
    "Weight", "Failover", "HealthCheckId", "SetIdentifier", "Region",
    "GeoLocation", "MultiValueAnswer", "CidrRoutingConfig", "GeoProximityLocation",
}
TTL_MINIMUM = 60
TTL_MAXIMUM = 86400
ALIAS_TTL = 60
TXT_SEGMENT = re.compile(r'"([^"\\]*)"')
MX_VALUE = re.compile(r"^(\d{1,5})\s+(\S+)$")


def _required_text(label: str, value: object) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{label} must be a non-empty string")
    return value.strip()


def _dns_name(label: str, value: object) -> str:
    name = _required_text(label, value).rstrip(".").lower()
    if not name or any(character.isspace() for character in name):
        raise ValueError(f"{label} must be a DNS name")
    return name


def _assert_in_zone(name: str, zone_name: str) -> None:
    if name != zone_name and not name.endswith(f".{zone_name}"):
        raise ValueError(f"record name {name!r} is outside zone {zone_name!r}")


def _assert_no_policy(record: Mapping[str, Any]) -> None:
    for key in POLICY_KEYS:
        if key in record and record[key] is not None:
            raise ValueError(f"policy routing field {key} is not supported")


def _ttl(record: Mapping[str, Any]) -> int:
    value = record.get("TTL")
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError("source TTL must be an integer")
    if not TTL_MINIMUM <= value <= TTL_MAXIMUM:
        raise ValueError(f"source TTL must be between {TTL_MINIMUM} and {TTL_MAXIMUM}")
    return value


def _resource_values(record: Mapping[str, Any]) -> list[str]:
    items = record.get("ResourceRecords")
    if not isinstance(items, Sequence) or isinstance(items, (str, bytes)) or not items:
        raise ValueError("non-alias record requires non-empty ResourceRecords")
    values: list[str] = []
    for item in items:
        if not isinstance(item, Mapping):
            raise ValueError("ResourceRecords items must be objects")
        values.append(_required_text("ResourceRecords.Value", item.get("Value")))
    return values


def _txt_content(value: str) -> str:
    """Join Route53's quoted TXT segments without guessing escape semantics."""
    if "\\" in value:
        raise ValueError("TXT values with escapes are not supported safely")
    position = 0
    segments: list[str] = []
    while position < len(value):
        while position < len(value) and value[position].isspace():
            position += 1
        if position == len(value):
            break
        match = TXT_SEGMENT.match(value, position)
        if match is None:
            raise ValueError("TXT value must consist only of quoted segments")
        segments.append(match.group(1))
        position = match.end()
    if not segments:
        raise ValueError("TXT value must contain at least one quoted segment")
    return "".join(segments)


def _plain_records(name: str, record_type: str, ttl: int, values: list[str]) -> list[dict[str, Any]]:
    converted: list[dict[str, Any]] = []
    if record_type == "CNAME" and len(values) != 1:
        raise ValueError("a CNAME source record must have exactly one value")
    for value in values:
        result: dict[str, Any] = {
            "type": record_type,
            "name": name,
            "ttl": ttl,
            "proxied": False,
        }
        if record_type == "TXT":
            result["content"] = _txt_content(value)
        elif record_type == "MX":
            match = MX_VALUE.fullmatch(value)
            if match is None:
                raise ValueError("MX values must be '<priority> <target>'")
            priority = int(match.group(1))
            if priority > 65535:
                raise ValueError("MX priority must be at most 65535")
            result["priority"] = priority
            result["content"] = _dns_name("MX target", match.group(2))
        elif record_type in {"CNAME", "NS"}:
            result["content"] = _dns_name(f"{record_type} target", value)
        else:
            result["content"] = value
        converted.append(result)
    return converted


def _alias_record(name: str, records: list[Mapping[str, Any]]) -> dict[str, Any]:
    if len(records) > 2 or {str(item["Type"]) for item in records} not in ({"A"}, {"AAAA"}, {"A", "AAAA"}):
        raise ValueError("Alias records must be one A/AAAA or one matching A and AAAA pair")
    targets: set[str] = set()
    for record in records:
        alias = record.get("AliasTarget")
        if not isinstance(alias, Mapping):
            raise ValueError("AliasTarget must be an object")
        # A Cloudflare CNAME cannot retain Route53 alias health evaluation.
        # Therefore an Alias that enables it is deliberately not convertible.
        if alias.get("EvaluateTargetHealth") is not False:
            raise ValueError("AliasTarget EvaluateTargetHealth=true is not convertible")
        targets.add(_dns_name("AliasTarget.DNSName", alias.get("DNSName")))
    if len(targets) != 1:
        raise ValueError("Alias A/AAAA records for one name must have the same target")
    return {
        "type": "CNAME",
        "name": name,
        "content": targets.pop(),
        "ttl": ALIAS_TTL,
        "proxied": False,
    }


def _assert_cname_conflicts(records: list[dict[str, Any]]) -> None:
    by_name: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for record in records:
        by_name[record["name"]].append(record)
    for name, same_name in by_name.items():
        if any(record["type"] == "CNAME" for record in same_name) and len(same_name) != 1:
            raise ValueError(f"CNAME conflict at {name}")


def build_dns_only_plan(
    source_records: Sequence[Mapping[str, Any]],
    *,
    zone_name: str,
    account_id: str,
    cloudflare_zone_id: str,
) -> dict[str, Any]:
    """Return a Cloudflare DNS-only plan; never mutate ``source_records``."""
    zone = _dns_name("zone_name", zone_name)
    account = _required_text("account_id", account_id)
    cloudflare_zone = _required_text("cloudflare_zone_id", cloudflare_zone_id)
    if not isinstance(source_records, Sequence) or isinstance(source_records, (str, bytes)):
        raise ValueError("source_records must be a sequence of Route53 records")

    source = copy.deepcopy(list(source_records))
    aliases_by_name: dict[str, list[Mapping[str, Any]]] = defaultdict(list)
    converted: list[dict[str, Any]] = []
    excluded_apex_authority_count = 0
    planned_source_count = 0

    for record in source:
        if not isinstance(record, Mapping):
            raise ValueError("each source record must be an object")
        _assert_no_policy(record)
        name = _dns_name("record Name", record.get("Name"))
        _assert_in_zone(name, zone)
        record_type = _required_text("record Type", record.get("Type")).upper()

        if name == zone and record_type in {"NS", "SOA"}:
            excluded_apex_authority_count += 1
            continue
        if record_type not in ALLOWED_TYPES:
            raise ValueError(f"unsupported Route53 record type {record_type}")
        if "AliasTarget" in record:
            aliases_by_name[name].append(record)
            planned_source_count += 1
            continue
        converted.extend(_plain_records(name, record_type, _ttl(record), _resource_values(record)))
        planned_source_count += 1

    for name, aliases in aliases_by_name.items():
        converted.append(_alias_record(name, aliases))

    _assert_cname_conflicts(converted)
    alias_source_count = sum(len(items) for items in aliases_by_name.values())
    return {
        "cf_dns_records": converted,
        "source_record_coverage": {
            "source_record_count": len(source),
            "planned_source_record_count": planned_source_count,
            "excluded_apex_authority_count": excluded_apex_authority_count,
            "alias_source_record_count": alias_source_count,
            "coalesced_alias_pair_count": alias_source_count - len(aliases_by_name),
            "output_record_count": len(converted),
        },
        "excluded_apex_authority_count": excluded_apex_authority_count,
        "registration_context": {
            "account_id": account,
            "cloudflare_zone_id": cloudflare_zone,
        },
        "verification_gates": [
            "Compare every DNS-only payload record with the Route53 source before registration.",
            "Verify SES DKIM, SPF, DMARC, MX, ACM validation CNAMEs, delegated NS, and TLS after import.",
            "Verify Cloudflare-issued nameservers at the registrar before changing delegation.",
            "Keep app and staging records DNS-only; tunnel CNAME/proxy changes are a later gate.",
        ],
    }


def main(argv: Sequence[str] | None = None) -> int:
    """Read a saved preflight JSON file and write a local plan JSON file."""
    parser = argparse.ArgumentParser(description="Build a DNS-only Cloudflare onboarding plan locally.")
    parser.add_argument("--input", required=True, help="saved ingress preflight JSON")
    parser.add_argument("--output", required=True, help="local plan JSON output")
    parser.add_argument("--route53-zone-id", required=True)
    parser.add_argument("--zone-name", required=True)
    parser.add_argument("--account-id", required=True)
    parser.add_argument("--cloudflare-zone-id", required=True)
    args = parser.parse_args(argv)

    with open(args.input, encoding="utf-8") as input_file:
        snapshot = json.load(input_file)
    try:
        records = snapshot["dns"]["records"][args.route53_zone_id]
    except (KeyError, TypeError) as error:
        raise ValueError("input must contain dns.records for --route53-zone-id") from error
    plan = build_dns_only_plan(
        records,
        zone_name=args.zone_name,
        account_id=args.account_id,
        cloudflare_zone_id=args.cloudflare_zone_id,
    )
    with open(args.output, "w", encoding="utf-8", newline="\n") as output_file:
        json.dump(plan, output_file, ensure_ascii=False, indent=2)
        output_file.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
