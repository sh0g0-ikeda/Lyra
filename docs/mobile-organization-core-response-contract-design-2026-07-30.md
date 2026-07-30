# Organization core response contract 接続設計

## 目的と範囲

法人workspace、member、invitationの既存JSON応答を共有Mobile API contractへ接続し、Stripe内部情報、生招待token、契約外Service値を成功データとして返さない。

対象:

- invitation preview
- workspace一覧・作成・取得・更新・招待accept
- member一覧・更新
- invitation作成・一覧・再送・取消

member削除204、credits、billing、invoice、usage、CSV、audit、admin APIは別PRとし、この差分では変更しない。

## Spec根拠

- `docs/Lyra_Unified_Spec_v4.md` Architecture / Authentication and Authorization / Security / Billing / Test and Verification
- `docs/mobile-release-task-list-2026-07-30.md` GIT-110 PR-A

## 影響レイヤーとインターフェース

- API contract: organization、member、credit balance、workspace、invitation、preview、delivery resultと各wrapper schemaを追加する。
- Route: 現行mapperでwireへ変換後、HTTP送信直前に共有contractを検証する。
- Service / Repository / Domain / Infrastructure / DB / Web / Mobile: 変更しない。
- request、HTTP status、公開preview、認証、権限、招待処理、監査を維持する。

## 互換境界

- workspace balanceのnull、member表示名・招待者・参加日時のnullを維持する。
- workspace一覧、member一覧、invitation一覧の0件を正常値とする。
- invitationの送信・accept・revoke各timestampとerrorのnullを維持する。
- invitation deliveryは`disabled` / `sent` / `failed`とoptional errorMessageを維持する。
- invitation URLは既存field名と値を変更せず、生tokenを別fieldで追加しない。
- organization/member/invitation enumは現行DomainとWeb wireに一致させる。

## セキュリティ

- 公開previewはorganization id/nameとinvitation email/role/status/expiryだけを許可する。
- 既存public rate limit、認証、organization membership/capability判定を変更しない。
- organization、member、invitation、wrapperをstrict schemaで検証する。
- Stripe customer/subscription ID、生招待token、provider message IDを許可しない。
- 契約不一致は既存の汎用ConfigurationErrorとしてfail closedする。

## TDDと検証

1. core schemaのnull・空一覧・delivery境界と内部field拒否を先にテストする。
2. JSONを返す対象13 endpointが契約外Service値を500にするテストを先に追加し、失敗を確認する。
3. contractとRoute guardだけを実装する。
4. focused Vitest、全Vitest/Bun、backend build、migration/invariant、Web lint/build、Playwright smokeを実行する。

## Terra委譲

委譲なし。上位指示によりsub-agentは使用せず、公開previewと認証済みworkspace応答の境界をSolローカルチェックリストで一貫して確認する。
