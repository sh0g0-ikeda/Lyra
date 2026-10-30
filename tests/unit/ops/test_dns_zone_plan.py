import copy
import json
import tempfile
import unittest
from pathlib import Path

from ops.cloudflare.dns_zone_plan import build_dns_only_plan, main


ZONE = "example.test"
ACCOUNT_ID = "123456789012"
CLOUDFLARE_ZONE_ID = "cf-zone-id"


def record(name, record_type, value=None, ttl=300, **extra):
    item = {"Name": name, "Type": record_type, "TTL": ttl}
    if value is not None:
        values = value if isinstance(value, list) else [value]
        item["ResourceRecords"] = [{"Value": entry} for entry in values]
    item.update(extra)
    return item


def alias(name, record_type, target, **extra):
    item = {"Name": name, "Type": record_type, "AliasTarget": {"DNSName": target, "EvaluateTargetHealth": False}}
    item.update(extra)
    return item


def standard_records():
    return [
        record("example.test.", "NS", "ns-1.awsdns.example."),
        record("example.test.", "SOA", "ns-1.awsdns.example. hostmaster.example. 1 2 3 4 5"),
        record("example.test.", "TXT", '"v=spf1 " "include:mail.example"'),
        record("_dmarc.example.test.", "TXT", '"v=DMARC1; p=none"'),
        record("dkim._domainkey.example.test.", "CNAME", "selector.example.net."),
        record("mail.example.test.", "MX", "10 inbound.example.net."),
        record("delegated.example.test.", "NS", "ns.partner.example."),
        record("ipv4.example.test.", "A", "192.0.2.10"),
        record("ipv6.example.test.", "AAAA", "2001:db8::10"),
    ]


class DnsOnlyPlanTests(unittest.TestCase):
    def build(self, records=None, **kwargs):
        return build_dns_only_plan(
            records if records is not None else standard_records(),
            zone_name=ZONE,
            account_id=ACCOUNT_ID,
            cloudflare_zone_id=CLOUDFLARE_ZONE_ID,
            **kwargs,
        )

    def test_converts_supported_records_without_proxying_and_excludes_apex_authority(self):
        """正常系: 通常レコードをDNS onlyに変換し、apex NS/SOAだけ除外する。"""
        source = standard_records()
        plan = self.build(source)

        self.assertEqual(7, len(plan["cf_dns_records"]))
        self.assertEqual(2, plan["excluded_apex_authority_count"])
        self.assertTrue(all(item["proxied"] is False for item in plan["cf_dns_records"]))
        self.assertEqual("v=spf1 include:mail.example", plan["cf_dns_records"][0]["content"])
        self.assertEqual("selector.example.net", plan["cf_dns_records"][2]["content"])
        self.assertEqual(10, plan["cf_dns_records"][3]["priority"])
        self.assertEqual("inbound.example.net", plan["cf_dns_records"][3]["content"])
        self.assertEqual(CLOUDFLARE_ZONE_ID, plan["registration_context"]["cloudflare_zone_id"])
        self.assertEqual(source, standard_records())

    def test_merges_same_target_alias_a_and_aaaa_into_one_dns_only_cname(self):
        """正常系: 同一targetのAlias A/AAAAはTTL 60秒のCNAME一件へ統合する。"""
        plan = self.build([
            alias("app.example.test.", "A", "dualstack.edge.example."),
            alias("app.example.test.", "AAAA", "dualstack.edge.example."),
        ])

        self.assertEqual([{
            "type": "CNAME", "name": "app.example.test", "content": "dualstack.edge.example",
            "ttl": 60, "proxied": False,
        }], plan["cf_dns_records"])
        self.assertEqual(2, plan["source_record_coverage"]["alias_source_record_count"])
        self.assertEqual(1, plan["source_record_coverage"]["coalesced_alias_pair_count"])

    def test_preserves_single_alias_as_dns_only_cname(self):
        """境界値: AだけのAliasも一件のDNS only CNAMEとして保持する。"""
        plan = self.build([alias("origin.example.test.", "A", "edge.example.")])
        self.assertEqual("CNAME", plan["cf_dns_records"][0]["type"])
        self.assertEqual("edge.example", plan["cf_dns_records"][0]["content"])
        self.assertEqual(60, plan["cf_dns_records"][0]["ttl"])

    def test_rejects_alias_target_mismatch_or_unsafe_alias_metadata(self):
        """異常系: target不一致、health評価あり、policy routing付きAliasは拒否する。"""
        mismatch = [alias("app.example.test.", "A", "one.example."), alias("app.example.test.", "AAAA", "two.example.")]
        with self.assertRaisesRegex(ValueError, "target"):
            self.build(mismatch)
        health_enabled = alias("app.example.test.", "A", "edge.example.")
        health_enabled["AliasTarget"]["EvaluateTargetHealth"] = True
        with self.assertRaisesRegex(ValueError, "EvaluateTargetHealth"):
            self.build([health_enabled])
        with self.assertRaisesRegex(ValueError, "policy"):
            self.build([alias("app.example.test.", "A", "edge.example.", SetIdentifier="blue")])

    def test_rejects_conflicts_unknown_types_invalid_ttl_and_names_outside_zone(self):
        """異常系: CNAME衝突、未知型、TTL範囲外、zone外名を拒否する。"""
        with self.assertRaisesRegex(ValueError, "CNAME conflict"):
            self.build([alias("app.example.test.", "A", "edge.example."), record("app.example.test.", "TXT", '"x"')])
        with self.assertRaisesRegex(ValueError, "unsupported"):
            self.build([record("example.test.", "CAA", "0 issue letsencrypt.org")])
        with self.assertRaisesRegex(ValueError, "TTL"):
            self.build([record("example.test.", "TXT", '"x"', ttl=59)])
        with self.assertRaisesRegex(ValueError, "outside"):
            self.build([record("other.test.", "TXT", '"x"')])

    def test_rejects_unparseable_txt_and_policy_routing_on_plain_records(self):
        """異常系: 未対応TXT escapeと通常レコードのpolicy routingを拒否する。"""
        with self.assertRaisesRegex(ValueError, "TXT"):
            self.build([record("example.test.", "TXT", '"bad\\"escape"')])
        with self.assertRaisesRegex(ValueError, "policy"):
            self.build([record("example.test.", "TXT", '"x"', SetIdentifier="blue")])

    def test_rejects_aws_cidr_and_geoproximity_routing_fields(self):
        """異常系: 実AWSのCIDR・近接ルーティングを黙って通常DNSへ変換しない。"""
        policies = {
            "CidrRoutingConfig": {"CollectionId": "example-id", "LocationName": "*"},
            "GeoProximityLocation": {"AWSRegion": "ap-northeast-1", "Bias": 0},
        }
        for key, policy in policies.items():
            with self.subTest(policy=key):
                with self.assertRaisesRegex(ValueError, "policy"):
                    self.build([record("app.example.test.", "A", "192.0.2.10", **{key: policy})])

    def test_does_not_mutate_source_records(self):
        """安全性: plannerは入力スナップショットを破壊しない。"""
        source = standard_records()
        original = copy.deepcopy(source)
        self.build(source)
        self.assertEqual(original, source)

    def test_cli_reads_only_local_snapshot_and_writes_a_plan(self):
        """CLI: ローカル入力から計画JSONだけを書き、外部APIを呼ばない。"""
        with tempfile.TemporaryDirectory() as temporary_directory:
            input_path = Path(temporary_directory) / "input.json"
            output_path = Path(temporary_directory) / "output.json"
            input_path.write_text(json.dumps({"dns": {"records": {"route53-zone": standard_records()}}}), encoding="utf-8")
            exit_code = main([
                "--input", str(input_path), "--output", str(output_path),
                "--route53-zone-id", "route53-zone", "--zone-name", ZONE,
                "--account-id", ACCOUNT_ID, "--cloudflare-zone-id", CLOUDFLARE_ZONE_ID,
            ])
            payload = json.loads(output_path.read_text(encoding="utf-8"))
        self.assertEqual(0, exit_code)
        self.assertEqual(7, len(payload["cf_dns_records"]))
