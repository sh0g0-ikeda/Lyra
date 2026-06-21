# Lyra production ops guardrails - 2026-06-21

This document records the low-cost production guardrails added after the CloudFront migration. It intentionally excludes secret values.

## Scope

WAF was intentionally not enabled in this change. The change only added cost controls, log retention, and operational alarms.

## Cost guardrail

- AWS Budget: `lyra-prod-monthly-cost-guardrail`
- Budget limit: `200 USD / month`
- Notifications:
  - Actual cost over `25%` of budget, equivalent to about `50 USD`
  - Actual cost over `50%` of budget, equivalent to about `100 USD`
  - Forecasted cost over `75%` of budget, equivalent to about `150 USD`
  - Actual cost over `100%` of budget, equivalent to about `200 USD`
- Budget subscribers:
  - `shogoa24@gmail.com`
  - `lyra.japan.official@gmail.com`

## Notification topics

- Regional ops topic: `arn:aws:sns:ap-northeast-1:452284481392:lyra-prod-ops-alerts`
- Edge ops topic: `arn:aws:sns:us-east-1:452284481392:lyra-prod-edge-alerts`
- Email subscriptions were created for:
  - `shogoa24@gmail.com`
  - `lyra.japan.official@gmail.com`
- Both SNS topics require email confirmation before CloudWatch alarm mail delivery works.

## Log retention

The following CloudWatch Logs groups are pinned to 30-day retention:

- `lyra-prod-api`
- `lyra-prod-worker`

## CloudWatch alarms

Regional alarms in `ap-northeast-1`:

- `lyra-prod-dlq-visible-messages`
  - Triggers when the generation DLQ has one or more visible messages.
- `lyra-prod-generation-oldest-message-30m`
  - Triggers when the oldest visible generation queue message is at least 30 minutes old.
- `lyra-prod-generation-inflight-30m`
  - Triggers when one or more generation messages remain in flight for 30 minutes.
- `lyra-prod-alb-elb-5xx`
  - Triggers when the ALB itself emits repeated 5xx responses.
- `lyra-prod-alb-target-5xx`
  - Triggers when the API target emits repeated 5xx responses.
- `lyra-prod-alb-target-response-p95-50s`
  - Triggers when API p95 target response time exceeds 50 seconds.
- `lyra-prod-api-healthy-hosts-zero`
  - Triggers when the ALB target group has no healthy API targets.
- `lyra-prod-api-cpu-high`
  - Triggers when ECS API CPU stays above 85% for 15 minutes.
- `lyra-prod-api-memory-high`
  - Triggers when ECS API memory stays above 85% for 15 minutes.

CloudFront alarms in `us-east-1`:

- `lyra-prod-cloudfront-5xx-rate`
  - Triggers when CloudFront 5xx error rate stays high.
- `lyra-prod-cloudfront-total-error-rate`
  - Triggers when total CloudFront error rate stays high.

## Verification

- Budget exists with four notification thresholds.
- Regional SNS topic exists; email subscriptions are pending confirmation.
- Edge SNS topic exists; email subscriptions are pending confirmation.
- `lyra-prod-api` and `lyra-prod-worker` log groups have 30-day retention.
- All regional CloudWatch alarms reported `OK` after creation.
- CloudFront alarms reported `INSUFFICIENT_DATA` after creation because there were not enough recent metrics yet; missing data is configured as `notBreaching`.

## Expected monthly cost impact

The added fixed cost is intentionally small:

- CloudWatch alarms: roughly low single-digit USD per month.
- SNS email notifications: negligible.
- AWS Budget: negligible for this single-budget use.
- Log retention: prevents unbounded log growth and should reduce long-term storage cost.

