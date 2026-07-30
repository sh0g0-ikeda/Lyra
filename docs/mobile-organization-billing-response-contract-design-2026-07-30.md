# Organization billing response contract 接続設計

## 目的と範囲

法人workspaceの残高・Stripe課金に関する既存JSON応答を共有Mobile API contractへ接続し、Stripe内部情報や契約外Service値を成功データとして返さない。

対象:

- credit balance
- enterprise plan catalog
- subscription checkoutの2 alias
- credit checkoutの2 alias
- customer portalの2 alias
- billing summary
- invoice list

usage、CSV、audit、admin、個人課金、Stripe処理、credit計算、DBは別PRとし、この差分では変更しない。

## Spec根拠

- `docs/Lyra_Unified_Spec_v4.md` sections 7–8
- `docs/mobile-release-task-list-2026-07-30.md` GIT-110 PR-A

## 影響レイヤーとインターフェース

- API contract: organization credit balance、plan catalog、checkout、portal、subscription summary、invoiceと各wrapper schemaを追加する。
- Route: 現行mapperでwireへ変換後、HTTP送信直前に共有contractを検証する。
- Service / Repository / Domain / Infrastructure / DB / Web / Mobile: 変更しない。
- request、HTTP status、認証、organization capability、Stripe session作成、監査を維持する。

## 互換境界

- billing summaryのsubscription `null`、workspace balance `null`、invoice URL `null`を維持する。
- planとinvoiceの0件を正常値とする。
- organization subscription summaryは現行Domainが許す全plan/statusを受理する。
- checkoutとportalの既存field名、201/200 status、aliasを変更しない。
- 金額・credit・契約月数・試用日数は0以上の整数とする。

## セキュリティ

- 既存認証、`view_billing` / `manage_billing` capability判定を変更しない。
- itemとwrapperをstrict schemaで検証する。
- Stripe customer、subscription、checkout、invoiceの内部IDをinvoice/billing payloadへ追加できないようにする。
- checkoutで既に公開しているsession IDは既存wireとして維持し、それ以外のStripe内部fieldは許可しない。
- 契約不一致は既存の汎用ConfigurationErrorとしてfail closedする。

## TDDと検証

1. null・空一覧・0値と既存enumの受理、内部field・未知enum・負数の拒否を先にテストする。
2. 対象10 endpointが契約外Service値を500にするテストを先に追加し、失敗を確認する。
3. contractとRoute guardだけを実装する。
4. focused Vitest、全Vitest/Bun、backend build、migration/invariant、Web lint/build、Playwright smokeを実行する。

## Terra委譲

委譲なし。上位指示によりsub-agentは使用せず、個人課金と法人課金を混同しない境界をSolローカルチェックリストで確認する。
