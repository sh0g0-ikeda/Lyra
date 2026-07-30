# Page command response contract 接続設計

## 目的と範囲

ページ操作の既存JSON応答を共有Mobile API contractへ接続し、queue受付・layout同期・Story autofillの契約外Service値を成功データとして返さない。

対象:

- `POST /api/episodes/:id/autofill-pages-from-story`
- `POST /api/pages/:id/layout-template`
- `POST /api/pages/:id/autofill-from-scenes`
- `POST /api/pages/:id/generate`

ページ一覧・設定、job取得・停止、画像export、確定・再編集、Service / Repository / Worker / DBは変更しない。

## Spec根拠

- `docs/Lyra_Unified_Spec_v4.md` Architecture / Long Running Jobs / Security / Test and Verification
- `docs/mobile-release-task-list-2026-07-30.md` GIT-110 PR-A

## 影響レイヤーとインターフェース

- API contract: job受付、page layout適用、page autofill集計の3 schemaを追加する。
- Route: 現行Service結果を現行wireへ変換後、HTTP送信直前に共有contractを検証する。
- Service / Repository / Domain / Infrastructure / Worker / DB / Web / Mobile: 変更しない。
- request、HTTP status、wire field、認証・組織認可、監査ログ、課金・queue順序を維持する。

## 互換境界

- 2つの非同期受付は現行どおり`{ job_id }`と202を返し、非空IDだけを許可する。
- layout応答は既存template ID、非負のpanel集計、既存PanelFrame wireを維持する。
- autofill応答は非負の更新集計、compiler使用有無、`openai` / `fallback`、nullable metadata/errorを維持する。
- response guardはService完了後の既存位置に置き、job作成、クレジット、queue、永続化の実行条件や順序を変えない。

## セキュリティ

- 既存auth、organization `edit_work` / `generate`を維持する。
- job ID以外のqueue情報、ユーザーID、S3 key、provider request IDを追加しない。
- raw provider errorの扱いは変更せず、contract検証詳細を応答へ追加しない。
- 契約不一致は既存の汎用ConfigurationErrorとしてfail closedする。

## TDDと検証

1. 3 schemaの正常・nullable境界と空job ID、未知enum、負数拒否を先にテストする。
2. 4 endpointが契約外Service値を500にするRouteテストを先に追加し、失敗を確認する。
3. contractとRoute guardだけを実装する。
4. focused Vitest、全Vitest/Bun、backend build、migration/invariant、Web lint/build、Playwright smokeを実行する。

## Terra委譲

委譲なし。上位指示によりsub-agentは使用せず、queue・課金を変更しないresponse-only差分をSolローカルチェックリストで一貫して確認する。
