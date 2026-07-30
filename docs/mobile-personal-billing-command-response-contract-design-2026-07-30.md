# Personal billing command response contract 接続設計

## 目的と範囲

個人向けStripe checkout・credit checkout・customer portalの既存JSON応答を共有Mobile API contractへ接続し、契約外Service値を成功データとして返さない。

対象:

- subscription checkout
- credit checkout
- customer portal

balanceはPR #88で接続済み。Stripe処理、webhook、credit計算、organization課金、DBは変更しない。

## Spec根拠

- `docs/Lyra_Unified_Spec_v4.md` sections 7–8
- `docs/mobile-release-task-list-2026-07-30.md` GIT-110 PR-A

## 影響レイヤーとインターフェース

- API contract: 法人課金と同一wireのcheckout / portal schemaに個人課金用export名を追加する。
- Route: 現行Service結果をwireへ変換後、HTTP送信直前に共有contractを検証する。
- Service / Repository / Domain / Infrastructure / DB / Web / Mobile: 変更しない。
- request、201/200 status、認証、rate limit、Stripe session作成を維持する。

## 互換境界

- subscription checkoutは`session_id`と`url`を返す。
- credit checkoutは`session_id`、現行3種の`package_code`、`url`を返す。
- portalは`url`を返す。
- 個人・法人のService、認可、残高、契約は共有せず、同一の公開wire schemaだけを再利用する。

## セキュリティ

- 既存認証とrate limitを変更しない。
- wrapperをstrict schemaで検証する。
- checkoutで既に公開しているsession IDと遷移URL以外のStripe内部fieldを許可しない。
- 契約不一致は既存の汎用ConfigurationErrorとしてfail closedする。

## TDDと検証

1. 同一wire aliasの正常値と空必須値・未知field拒否を先にテストする。
2. 対象3 endpointが契約外Service値を500にするテストを先に追加し、失敗を確認する。
3. schema aliasとRoute guardだけを実装する。
4. focused Vitest、全Vitest/Bun、backend build、migration/invariant、Web lint/build、Playwright smokeを実行する。

## Terra委譲

委譲なし。上位指示によりsub-agentは使用せず、個人課金と法人課金の処理境界をSolローカルチェックリストで確認する。
