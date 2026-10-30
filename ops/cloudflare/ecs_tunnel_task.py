"""Pure local Cloudflare Tunnel ECS task-definition planner (no AWS I/O)."""
from __future__ import annotations

import argparse
import copy
import json
import re
from pathlib import Path
from typing import Any, Mapping

# Design: preserve only ECS registerable fields; never read token values. The API
# image is immutable, and the sidecar starts only after PostgreSQL-backed /readyz.
# ECS rejects an empty ``tags`` request member, so omit it while preserving tags.
REGISTERABLE_KEYS = ("family", "taskRoleArn", "executionRoleArn", "networkMode", "containerDefinitions", "volumes", "placementConstraints", "requiresCompatibilities", "cpu", "memory", "runtimePlatform", "proxyConfiguration", "ephemeralStorage", "pidMode", "ipcMode", "inferenceAccelerators", "tags")
DIGEST = re.compile(r"^sha256:[0-9a-f]{64}$")
PINNED = re.compile(r"^.+@sha256:[0-9a-f]{64}$")
SECRET_ARN = re.compile(r"^arn:[^:]+:secretsmanager:([^:]+):(\d{12}):secret:.+$")
ROLE_ARN = re.compile(r"^arn:[^:]+:iam::(\d{12}):role/.+$")
# The pinned API runtime is distroless (Dockerfile runtime stage): no /bin/sh.
# Bound the probe below ECS's five-second timeout and execute Bun directly.
API_HEALTH = {"command": ["CMD", "/usr/local/bin/bun", "-e", "const response = await fetch('http://127.0.0.1:3000/readyz', { signal: AbortSignal.timeout(4000) }); if (response.status !== 200) process.exit(1)"], "interval": 30, "timeout": 5, "retries": 3, "startPeriod": 60}


def _text(name: str, value: object) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{name} is required")
    return value.strip()


def _pinned(name: str, value: object) -> str:
    text = _text(name, value)
    if not PINNED.fullmatch(text):
        raise ValueError(f"{name} must be pinned by sha256 digest")
    return text


def build_tunnel_plan(*, source: Mapping[str, Any], api_container_name: str, expected_image_digest: str | None = None, expected_image: str | None = None, tunnel_image: str, tunnel_token_secret_arn: str, log_group: str, region: str) -> dict[str, Any]:
    """Build local registration payload/validation gates without mutating source."""
    if not isinstance(source, Mapping):
        raise ValueError("source must be an object")
    if bool(expected_image_digest) == bool(expected_image):
        raise ValueError("exactly one expected image constraint is required")
    outer_tags = copy.deepcopy(source.get("tags")) if "taskDefinition" in source else None
    source = source.get("taskDefinition", source)
    if not isinstance(source, Mapping):
        raise ValueError("taskDefinition must be an object")
    payload = {key: copy.deepcopy(source[key]) for key in REGISTERABLE_KEYS if key in source}
    if outer_tags:
        payload["tags"] = outer_tags
    elif outer_tags == [] or payload.get("tags") == []:
        payload.pop("tags", None)
    for key in ("family", "containerDefinitions", "requiresCompatibilities", "cpu", "memory", "runtimePlatform"):
        if key not in payload:
            raise ValueError(f"source is missing required registerable field: {key}")
    runtime = payload["runtimePlatform"]
    if not isinstance(runtime, Mapping):
        raise ValueError("source runtimePlatform must be an object")
    if runtime.get("cpuArchitecture") != "ARM64":
        raise ValueError("source runtimePlatform must be ARM64")
    if runtime.get("operatingSystemFamily") != "LINUX":
        raise ValueError("source runtimePlatform must be LINUX")
    if "FARGATE" not in payload["requiresCompatibilities"]:
        raise ValueError("source requiresCompatibilities must include FARGATE")
    if payload.get("networkMode") != "awsvpc":
        raise ValueError("source networkMode must be awsvpc")
    api_name = _text("api_container_name", api_container_name)
    containers = payload["containerDefinitions"]
    if not isinstance(containers, list) or not all(isinstance(c, dict) for c in containers):
        raise ValueError("containerDefinitions must be a list of objects")
    matches = [c for c in containers if c.get("name") == api_name]
    if len(matches) != 1:
        raise ValueError(f"source must contain exactly one API container named {api_name}")
    if any(c.get("name") == "cloudflared" for c in containers):
        raise ValueError("cloudflared sidecar already exists; refusing non-idempotent plan")
    api = matches[0]
    api_image = _pinned("API image", api.get("image"))
    if expected_image_digest:
        digest = _text("expected image digest", expected_image_digest)
        if not DIGEST.fullmatch(digest):
            raise ValueError("expected image digest must be sha256 pinned")
        if not api_image.endswith("@" + digest):
            raise ValueError("API image does not match expected image digest")
    elif api_image != _pinned("expected image", expected_image):
        raise ValueError("API image does not match expected image")
    token_arn = _text("tunnel token secret ARN", tunnel_token_secret_arn)
    secret_match = SECRET_ARN.fullmatch(token_arn)
    if secret_match is None:
        raise ValueError("tunnel token secret ARN must be a Secrets Manager ARN reference")
    tunnel = _pinned("tunnel_image", tunnel_image)
    group, aws_region = _text("log group", log_group), _text("region", region)
    if secret_match.group(1) != aws_region:
        raise ValueError("tunnel token secret ARN region must match region")
    role_match = ROLE_ARN.fullmatch(str(payload.get("executionRoleArn", "")))
    if role_match is None:
        raise ValueError("executionRoleArn must be an IAM role ARN with an account")
    if secret_match.group(2) != role_match.group(1):
        raise ValueError("tunnel token secret ARN account must match execution role account")
    health_added = "healthCheck" not in api
    if health_added:
        api["healthCheck"] = copy.deepcopy(API_HEALTH)
    sidecar = {
        "name": "cloudflared",
        "image": tunnel,
        "essential": True,
        "dependsOn": [{"containerName": api_name, "condition": "HEALTHY"}],
        "command": [
            "tunnel", "--no-autoupdate", "--protocol", "http2", "--metrics",
            "127.0.0.1:2000", "--grace-period", "110s", "run",
        ],
        "secrets": [{"name": "TUNNEL_TOKEN", "valueFrom": token_arn}],
        "memoryReservation": 64,
        "stopTimeout": 120,
        "logConfiguration": {
            "logDriver": "awslogs",
            "options": {"awslogs-group": group, "awslogs-region": aws_region, "awslogs-stream-prefix": "cloudflared"},
        },
    }
    containers.append(sidecar)
    return {
        "register_task_definition": payload,
        "source_api_image": api_image,
        "api_health_check_added": health_added,
        "capacity_gate": {"required": True, "source_task_cpu": payload["cpu"], "source_task_memory_mib": payload["memory"], "sidecar_memory_reservation_mib": 64, "requirement": "Measure API and cloudflared CPU/memory in a live canary before changing task size."},
        "shutdown_gate": {"api_stop_timeout_seconds": api.get("stopTimeout", 30), "sidecar_stop_timeout_seconds": 120, "requirement": "Treat an unset API stopTimeout as the existing 30-second default; measure long-request ALB drain and both essential-container stop behavior during a two-replica rollout."},
        "deployment_gate": {"required_connector_replicas": 2, "api_container": api_name, "sidecar_health_check_omitted": "cloudflared image must not receive a fabricated curl or shell health check"},
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Build local Cloudflare Tunnel ECS plan; never calls AWS.")
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--api-container", default="api")
    expected = parser.add_mutually_exclusive_group(required=True)
    expected.add_argument("--expected-image-digest")
    expected.add_argument("--expected-image")
    parser.add_argument("--tunnel-image", required=True)
    parser.add_argument("--tunnel-token-secret-arn", required=True)
    parser.add_argument("--log-group", required=True)
    parser.add_argument("--region", required=True)
    args = parser.parse_args()
    source = json.loads(args.input.read_text(encoding="utf-8"))
    plan = build_tunnel_plan(source=source, api_container_name=args.api_container, expected_image_digest=args.expected_image_digest, expected_image=args.expected_image, tunnel_image=args.tunnel_image, tunnel_token_secret_arn=args.tunnel_token_secret_arn, log_group=args.log_group, region=args.region)
    args.output.write_text(json.dumps(plan, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
