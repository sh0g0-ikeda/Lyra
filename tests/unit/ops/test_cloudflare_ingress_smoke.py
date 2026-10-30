import json
import unittest
from email.message import Message
from io import BytesIO
from urllib.error import HTTPError

from scripts.ops.cloudflare_ingress_smoke import CANARY_URL, run_smoke


class FakeResponse:
    def __init__(self, status, body, headers):
        self.status = status
        self._body = body
        self.headers = Message()
        for key, value in headers.items():
            self.headers[key] = value

    def read(self, _limit=None):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, _type, _value, _traceback):
        return False


class FakeOpener:
    def __init__(self, responses):
        self.responses = responses
        self.requests = []

    def open(self, request, timeout):
        self.requests.append((request, timeout))
        result = self.responses[request.full_url]
        if isinstance(result, Exception):
            raise result
        return result


def healthy_response(url, **headers):
    base_headers = {"Content-Type": "application/json"}
    if url == CANARY_URL:
        base_headers.update({"CF-Ray": "abc123-NRT", "Cache-Control": "no-store, no-transform"})
    base_headers.update(headers)
    return FakeResponse(200, b'{"status":"ok"}', base_headers)


class CloudflareIngressSmokeTests(unittest.TestCase):
    def test_all_fixed_urls_require_200_json_and_canary_metadata_without_body_output(self):
        """正常系: 固定3 URLのhealth JSONとcanary metadataだけを要約する。"""
        from scripts.ops.cloudflare_ingress_smoke import FIXED_URLS
        opener = FakeOpener({url: healthy_response(url) for url in FIXED_URLS})

        report = run_smoke(opener=opener, timeout_seconds=3)

        self.assertTrue(report["ok"])
        self.assertEqual(3, len(report["results"]))
        canary = next(item for item in report["results"] if item["url"] == CANARY_URL)
        self.assertEqual(200, canary["status"])
        self.assertEqual("NRT", canary["cf_ray_pop"])
        self.assertNotIn('"body":', json.dumps(report))
        self.assertTrue(all(request.get_method() == "GET" for request, _timeout in opener.requests))

    def test_rejects_redirect_without_following_it(self):
        """異常系: redirectは成功扱いせず、追従しない。"""
        from scripts.ops.cloudflare_ingress_smoke import FIXED_URLS
        redirect = HTTPError(FIXED_URLS[0], 302, "Found", Message(), BytesIO())
        opener = FakeOpener({FIXED_URLS[0]: redirect, **{url: healthy_response(url) for url in FIXED_URLS[1:]}})

        report = run_smoke(opener=opener, timeout_seconds=3)

        self.assertFalse(report["ok"])
        self.assertEqual(302, report["results"][0]["status"])
        self.assertIn("status_not_200", report["results"][0]["failures"])
        self.assertTrue(redirect.fp.closed)

    def test_rejects_200_error_json_without_the_healthz_ok_status(self):
        """回帰: 200のエラーJSONはhealthz成功として扱わない。"""
        from scripts.ops.cloudflare_ingress_smoke import FIXED_URLS
        opener = FakeOpener({
            FIXED_URLS[0]: FakeResponse(200, b'{"error":"unhealthy"}', {"Content-Type": "application/json; charset=utf-8"}),
            **{url: healthy_response(url) for url in FIXED_URLS[1:]},
        })

        report = run_smoke(opener=opener, timeout_seconds=3)

        self.assertFalse(report["ok"])
        self.assertIn("health_status_not_ok", report["results"][0]["failures"])

    def test_rejects_non_json_and_missing_canary_cache_or_ray(self):
        """異常系: 非JSON、canaryのno-transform不足、CF-Ray不足を拒否する。"""
        from scripts.ops.cloudflare_ingress_smoke import FIXED_URLS
        opener = FakeOpener({
            FIXED_URLS[0]: FakeResponse(200, b"not-json", {"Content-Type": "text/plain"}),
            FIXED_URLS[1]: healthy_response(CANARY_URL, **{"CF-Ray": "", "Cache-Control": "no-store"}),
            FIXED_URLS[2]: healthy_response(FIXED_URLS[2]),
        })

        report = run_smoke(opener=opener, timeout_seconds=3)

        self.assertFalse(report["ok"])
        self.assertIn("body_not_json", report["results"][0]["failures"])
        self.assertIn("missing_no_transform", report["results"][1]["failures"])
        self.assertIn("missing_cf_ray", report["results"][1]["failures"])

