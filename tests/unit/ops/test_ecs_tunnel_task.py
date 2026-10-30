import copy
import unittest

from ops.cloudflare.ecs_tunnel_task import build_tunnel_plan


API_DIGEST = "sha256:" + "a" * 64
TUNNEL_DIGEST = "sha256:" + "b" * 64
ACCOUNT_ID = "123456789012"
REGION = "ap-northeast-1"


def source_definition():
    return {
        "taskDefinitionArn": f"arn:aws:ecs:{REGION}:{ACCOUNT_ID}:task-definition/lyra-prod-api:147",
        "revision": 147,
        "status": "ACTIVE",
        "registeredAt": "2026-10-30T00:00:00Z",
        "registeredBy": f"arn:aws:iam::{ACCOUNT_ID}:user/example",
        "tags": [{"key": "environment", "value": "production"}],
        "compatibilities": ["EC2", "FARGATE"],
        "requiresAttributes": [{"name": "com.amazonaws.ecs.capability.logging-driver.awslogs"}],
        "family": "lyra-prod-api",
        "taskRoleArn": f"arn:aws:iam::{ACCOUNT_ID}:role/api-task",
        "executionRoleArn": f"arn:aws:iam::{ACCOUNT_ID}:role/execution",
        "networkMode": "awsvpc",
        "requiresCompatibilities": ["FARGATE"],
        "cpu": "256",
        "memory": "512",
        "runtimePlatform": {"cpuArchitecture": "ARM64", "operatingSystemFamily": "LINUX"},
        "volumes": [{"name": "scratch"}],
        "containerDefinitions": [
            {
                "name": "api",
                "image": "example.invalid/lyra-api@" + API_DIGEST,
                "essential": True,
                "portMappings": [{"containerPort": 3000, "protocol": "tcp"}],
                "environment": [{"name": "APP_PUBLIC_URL", "value": "https://app.example.test"}],
                "secrets": [{"name": "DATABASE_URL", "valueFrom": f"arn:aws:secretsmanager:{REGION}:{ACCOUNT_ID}:secret:db"}],
                "logConfiguration": {"logDriver": "awslogs", "options": {"awslogs-group": "api-log", "awslogs-region": "ap-northeast-1", "awslogs-stream-prefix": "api"}},
            }
        ],
        "unknownReadOnlyOrUnsafe": "must not be copied",
    }


class TunnelTaskPlanTests(unittest.TestCase):
    def build(self, source=None, **overrides):
        options = {
            "source": source or source_definition(),
            "api_container_name": "api",
            "expected_image_digest": API_DIGEST,
            "tunnel_image": "cloudflare/cloudflared@" + TUNNEL_DIGEST,
            "tunnel_token_secret_arn": f"arn:aws:secretsmanager:{REGION}:{ACCOUNT_ID}:secret:tunnel-token",
            "log_group": "/lyra/prod/cloudflared",
            "region": REGION,
        }
        options.update(overrides)
        return build_tunnel_plan(**options)

    def test_adds_pinned_sidecar_without_changing_api_or_source(self):
        "正常系: API定義を保ったまま、制約付きsidecarを追加する。"
        source = source_definition()
        original = copy.deepcopy(source)

        plan = self.build(source)

        payload = plan["register_task_definition"]
        self.assertEqual(source, original)
        self.assertNotIn("taskDefinitionArn", payload)
        self.assertNotIn("unknownReadOnlyOrUnsafe", payload)
        self.assertEqual(payload["runtimePlatform"]["cpuArchitecture"], "ARM64")
        self.assertEqual(payload["cpu"], "256")
        self.assertEqual(payload["memory"], "512")
        self.assertEqual(payload["volumes"], original["volumes"])
        api = payload["containerDefinitions"][0]
        self.assertEqual(api["image"], original["containerDefinitions"][0]["image"])
        self.assertEqual(api["environment"], original["containerDefinitions"][0]["environment"])
        self.assertEqual(api["secrets"], original["containerDefinitions"][0]["secrets"])
        self.assertEqual(api["portMappings"], original["containerDefinitions"][0]["portMappings"])
        self.assertEqual(api["healthCheck"]["command"][:3], ["CMD", "/usr/local/bin/bun", "-e"])
        self.assertIn("127.0.0.1:3000/readyz", api["healthCheck"]["command"][3])
        self.assertIn("AbortSignal.timeout(4000)", api["healthCheck"]["command"][3])
        self.assertEqual(api["healthCheck"]["timeout"], 5)

        sidecar = payload["containerDefinitions"][1]
        self.assertEqual(sidecar["name"], "cloudflared")
        self.assertTrue(sidecar["essential"])
        self.assertEqual(sidecar["dependsOn"], [{"containerName": "api", "condition": "HEALTHY"}])
        self.assertEqual(sidecar["secrets"], [{"name": "TUNNEL_TOKEN", "valueFrom": f"arn:aws:secretsmanager:{REGION}:{ACCOUNT_ID}:secret:tunnel-token"}])
        self.assertEqual(sidecar["memoryReservation"], 64)
        self.assertNotIn("healthCheck", sidecar)
        self.assertEqual(sidecar["command"], ["tunnel", "--no-autoupdate", "--protocol", "http2", "--metrics", "127.0.0.1:2000", "--grace-period", "110s", "run"])
        self.assertEqual(sidecar["stopTimeout"], 120)
        self.assertEqual(plan["capacity_gate"]["required"], True)

    def test_preserves_existing_api_health_check_and_stop_timeout(self):
        "境界値: APIに既存health checkとstop timeoutがあれば上書きしない。"
        source = source_definition()
        source["containerDefinitions"][0]["healthCheck"] = {"command": ["CMD-SHELL", "true"], "interval": 15, "timeout": 4, "retries": 2, "startPeriod": 9}
        source["containerDefinitions"][0]["stopTimeout"] = 45

        plan = self.build(source)

        api = plan["register_task_definition"]["containerDefinitions"][0]
        self.assertEqual(api["healthCheck"]["command"], ["CMD-SHELL", "true"])
        self.assertEqual(api["stopTimeout"], 45)
        self.assertEqual(plan["shutdown_gate"]["api_stop_timeout_seconds"], 45)

    def test_rejects_missing_expected_image_constraint(self):
        "異常系: 期待API imageの制約なしでは計画を拒否する。"
        with self.assertRaisesRegex(ValueError, "expected image"):
            self.build(expected_image_digest=None)

    def test_rejects_wrong_or_unpinned_images(self):
        "異常系: API digest不一致とlatestのsidecar imageを拒否する。"
        with self.assertRaisesRegex(ValueError, "does not match"):
            self.build(expected_image_digest="sha256:" + "c" * 64)
        with self.assertRaisesRegex(ValueError, "pinned"):
            self.build(tunnel_image="cloudflare/cloudflared:latest")

    def test_rejects_missing_secret_log_group_duplicate_api_or_existing_sidecar(self):
        "異常系: secret、log group、API一意性、sidecar重複を検証する。"
        with self.assertRaisesRegex(ValueError, "secret ARN"):
            self.build(tunnel_token_secret_arn="not-an-arn")
        with self.assertRaisesRegex(ValueError, "log group"):
            self.build(log_group="")
        duplicate = source_definition()
        duplicate["containerDefinitions"].append(copy.deepcopy(duplicate["containerDefinitions"][0]))
        with self.assertRaisesRegex(ValueError, "exactly one"):
            self.build(source=duplicate)
        existing = source_definition()
        existing["containerDefinitions"].append({"name": "cloudflared", "image": "x@" + TUNNEL_DIGEST})
        with self.assertRaisesRegex(ValueError, "already exists"):
            self.build(source=existing)

    def test_exact_expected_image_can_be_used_instead_of_digest(self):
        "正常系: 完全一致するimage指定はdigest指定の代替として使える。"
        source = source_definition()
        image = source["containerDefinitions"][0]["image"]
        plan = self.build(expected_image_digest=None, expected_image=image)
        self.assertEqual(plan["source_api_image"], image)

    def test_preserves_outer_describe_response_tags(self):
        "正常系: describe_task_definitionの外側tagsもregister payloadへ保持する。"
        outer = {"taskDefinition": source_definition(), "tags": [{"key": "outer", "value": "kept"}]}

        plan = self.build(source=outer)

        self.assertEqual(plan["register_task_definition"]["tags"], [{"key": "outer", "value": "kept"}])

    def test_omits_empty_outer_describe_response_tags(self):
        "回帰: AWSが拒否するdescribe_task_definition外側の空tagsはregister payloadへ渡さない。"
        outer = {"taskDefinition": source_definition(), "tags": []}

        plan = self.build(source=outer)

        self.assertNotIn("tags", plan["register_task_definition"])

    def test_rejects_secret_arn_with_wrong_service_region_or_account(self):
        "異常系: SSM、別リージョン、別アカウントのtoken参照を拒否する。"
        with self.assertRaisesRegex(ValueError, "Secrets Manager"):
            self.build(tunnel_token_secret_arn=f"arn:aws:ssm:{REGION}:{ACCOUNT_ID}:parameter/tunnel")
        with self.assertRaisesRegex(ValueError, "region"):
            self.build(tunnel_token_secret_arn=f"arn:aws:secretsmanager:us-east-1:{ACCOUNT_ID}:secret:tunnel")
        with self.assertRaisesRegex(ValueError, "account"):
            self.build(tunnel_token_secret_arn=f"arn:aws:secretsmanager:{REGION}:210987654321:secret:tunnel")

    def test_rejects_non_fargate_non_awsvpc_or_non_linux_arm64(self):
        "異常系: Fargate awsvpc Linux ARM64でない元task定義を拒否する。"
        source = source_definition()
        source["requiresCompatibilities"] = ["EC2"]
        with self.assertRaisesRegex(ValueError, "FARGATE"):
            self.build(source=source)
        source = source_definition()
        source["networkMode"] = "bridge"
        with self.assertRaisesRegex(ValueError, "awsvpc"):
            self.build(source=source)
        source = source_definition()
        source["runtimePlatform"] = {"cpuArchitecture": "ARM64", "operatingSystemFamily": "WINDOWS_SERVER_2019_CORE"}
        with self.assertRaisesRegex(ValueError, "LINUX"):
            self.build(source=source)


if __name__ == "__main__":
    unittest.main()
