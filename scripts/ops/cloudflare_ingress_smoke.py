"""Public, unauthenticated Cloudflare ingress health smoke for GitHub runners.

The probe is intentionally fixed to three health URLs. It follows no redirects,
never sends cookies or credentials, and prints metadata plus a body digest only.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import ssl
from collections.abc import Mapping, Sequence
from typing import Any, Protocol
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, Request, build_opener


APP_URL = "https://app.lyra-editor.com/healthz"
CANARY_URL = "https://lyra-tunnel-canary.lyra-editor.com/healthz"
CLOUDFRONT_URL = "https://d1a1300ysx6i1r.cloudfront.net/healthz"
FIXED_URLS = (APP_URL, CANARY_URL, CLOUDFRONT_URL)
MAX_BODY_BYTES = 64 * 1024


class Opener(Protocol):
    def open(self, request: Request, timeout: float) -> Any: ...


class NoRedirect(HTTPRedirectHandler):
    """Return redirect status to the caller instead of following another URL."""

    def redirect_request(self, request: Request, fp: Any, code: int, message: str, headers: Mapping[str, str], newurl: str) -> None:
        return None


def _header(headers: Any, name: str) -> str | None:
    value = headers.get(name)
    return value if isinstance(value, str) else None


def _cache_tokens(value: str | None) -> set[str]:
    if value is None:
        return set()
    return {token.strip().lower() for token in value.split(",") if token.strip()}


def _cf_ray_pop(value: str | None) -> str | None:
    if value is None or "-" not in value:
        return None
    pop = value.rsplit("-", 1)[1].strip()
    return pop or None


def _probe(url: str, opener: Opener, timeout_seconds: float) -> dict[str, Any]:
    request = Request(url, method="GET", headers={"Accept": "application/json", "User-Agent": "lyra-cloudflare-ingress-smoke/1.0"})
    result: dict[str, Any] = {
        "url": url,
        "status": None,
        "body_bytes": None,
        "body_sha256": None,
        "cache_control": None,
        "cf_ray_pop": None,
        "x_amz_cf_pop": None,
        "failures": [],
    }
    try:
        with opener.open(request, timeout=timeout_seconds) as response:
            body = response.read(MAX_BODY_BYTES + 1)
            status = int(response.status)
            headers = response.headers
    except HTTPError as error:
        try:
            result["status"] = error.code
            result["failures"].append("status_not_200")
        finally:
            error.close()
        return result
    except (URLError, ssl.SSLError, TimeoutError) as error:
        result["failures"].append(f"request_{type(error).__name__}")
        return result

    content_type = _header(headers, "Content-Type")
    cache_control = _header(headers, "Cache-Control")
    cf_ray = _header(headers, "CF-Ray")
    result.update({
        "status": status,
        "body_bytes": len(body),
        "body_sha256": hashlib.sha256(body).hexdigest(),
        "cache_control": cache_control,
        "cf_ray_pop": _cf_ray_pop(cf_ray),
        "x_amz_cf_pop": _header(headers, "X-Amz-Cf-Pop"),
    })
    if status != 200:
        result["failures"].append("status_not_200")
    if len(body) > MAX_BODY_BYTES:
        result["failures"].append("body_too_large")
        return result
    media_type = content_type.split(";", 1)[0].strip().lower() if content_type is not None else None
    if media_type != "application/json":
        result["failures"].append("content_type_not_json")
    try:
        parsed = json.loads(body.decode("utf-8"))
        if not isinstance(parsed, Mapping):
            result["failures"].append("body_not_json_object")
        elif parsed.get("status") != "ok":
            result["failures"].append("health_status_not_ok")
    except (UnicodeDecodeError, json.JSONDecodeError):
        result["failures"].append("body_not_json")
    if url == CANARY_URL:
        tokens = _cache_tokens(cache_control)
        if "no-store" not in tokens:
            result["failures"].append("missing_no_store")
        if "no-transform" not in tokens:
            result["failures"].append("missing_no_transform")
        if result["cf_ray_pop"] is None:
            result["failures"].append("missing_cf_ray")
    return result


def run_smoke(*, opener: Opener, timeout_seconds: float) -> dict[str, Any]:
    """Run the fixed public checks and return only limited diagnostic metadata."""
    if timeout_seconds <= 0 or timeout_seconds > 60:
        raise ValueError("timeout_seconds must be between 0 and 60")
    results = [_probe(url, opener, timeout_seconds) for url in FIXED_URLS]
    return {"ok": all(not result["failures"] for result in results), "results": results}


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Probe fixed public Cloudflare ingress health URLs.")
    parser.add_argument("--timeout-seconds", type=float, default=15)
    args = parser.parse_args(argv)
    report = run_smoke(opener=build_opener(NoRedirect()), timeout_seconds=args.timeout_seconds)
    print(json.dumps(report, ensure_ascii=False, sort_keys=True))
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
