# Organization usage / audit response contract 接続設計

## 目的と範囲

法人workspaceのusage履歴とaudit logの既存JSON応答を共有Mobile API contractへ接続し、契約外Service値を成功データとして返さない。

対象:

- usage JSON
- audit log JSON

usage CSV、集計ロジック、メタデータ除去ロジック、billing、admin、DBは変更しない。

## Spec根拠

- `docs/Lyra_Unified_Spec_v4.md` sections 7–8
- `docs/mobile-release-task-list-2026-07-30.md` GIT-110 PR-A

## 影響レイヤーとインターフェース

- API contract: usage event、usage summary、audit logとwrapper schemaを追加する。
- Route: 現行mapperとメタデータ除去後、HTTP送信直前に共有contractを検証する。
- Service / Repository / Domain / Infrastructure / DB / Web / Mobile: 変更しない。
- request、HTTP status、認証、`view_usage` / `view_audit_logs`判定を維持する。

## 互換境界

- event/logの0件とsummaryの空groupを正常値とする。
- usageのcredit amountと集計値は消費を表す負数、付与を表す正数、0を受理する。
- user、work、job、actor、target IDのnullを維持する。
- metadataは機密key除去後の任意JSON recordを維持する。

## セキュリティ

- 既存認証とorganization capability判定を変更しない。
- event/log、summary group、wrapperをstrict schemaで検証する。
- Stripe/OpenAI内部ID、prompt、S3/image URLは既存sanitizerで除去した後に検証・返却する。
- 契約不一致は既存の汎用ConfigurationErrorとしてfail closedする。

## TDDと検証

1. 空一覧・null ID・正負credit・metadataの受理と未知root field・空IDの拒否を先にテストする。
2. 対象2 endpointが契約外Service値を500にするテストを先に追加し、失敗を確認する。
3. contractとRoute guardだけを実装する。
4. focused Vitest、全Vitest/Bun、backend build、migration/invariant、Web lint/build、Playwright smokeを実行する。

## Terra委譲

委譲なし。上位指示によりsub-agentは使用せず、ログの機密情報除去と既存権限境界をSolローカルチェックリストで確認する。
