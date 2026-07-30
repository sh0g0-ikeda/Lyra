# Page summary response contract 接続設計

## 目的と範囲

ページ一覧とページ設定更新の既存JSON応答を共有Mobile API contractへ接続し、内部画像情報や契約外Service値を成功データとして返さない。

対象:

- `GET /api/episodes/:id/pages`
- `PUT /api/pages/:id`

ページ生成、Story autofill、layout template、画像export、確定・再編集、pagination、Service / Repository / DBは変更しない。

## Spec根拠

- `docs/Lyra_Unified_Spec_v4.md` Architecture / Files and Images / Long Running Jobs / Security / Test and Verification
- `docs/mobile-release-task-list-2026-07-30.md` GIT-110 PR-A

## 影響レイヤーとインターフェース

- API contract: 現行`PageSummary` wireと一覧wrapperのschemaを追加する。
- Route: 現行mapperと画像URL署名後、HTTP送信直前に共有contractを検証する。
- Infrastructure / Service / Repository / Domain / DB / Web / Mobile: 変更しない。
- request、HTTP status、wire field、認証・組織認可、監査ログを維持する。

## 互換境界

- `layout_config`は任意key/value object、scene IDは0件以上を許可する。
- purpose、continuity note、generation modeは現行どおりnullを許可する。
- `generated_image`はnullを許可し、署名できない場合の`cdn_url`省略を正常値とする。
- 生成日時は現行Domainに合わせてnullも許可する。
- status、dialogue mode、generation modeは現行Domainの値だけを許可する。
- countは0以上、page numberは1以上とする。
- `generated_image.s3_key`はstrict schemaで拒否し、内部storage keyを公開しない。
- 一覧wrapperは将来paginationを別PRで追加できるよう、今回は現行`pages`だけを検証する。

## セキュリティ

- 既存auth、organization `view_work` / `edit_work`を維持する。
- CloudFront署名URL処理とS3 ownershipを変更しない。
- S3 key、ユーザーID、provider error、contract検証詳細をログ・応答へ追加しない。
- 契約不一致は既存の汎用ConfigurationErrorとしてfail closedする。

## TDDと検証

1. page schemaの正常・null・省略境界と内部S3 key、未知enum、負数拒否を先にテストする。
2. 一覧と設定更新の両endpointが契約外Service値を500にするテストを先に追加し、失敗を確認する。
3. contractとRoute guardだけを実装する。
4. focused Vitest、全Vitest/Bun、backend build、migration/invariant、Web lint/build、Playwright smokeを実行する。

## Terra委譲

委譲なし。上位指示によりsub-agentは使用せず、response-onlyの単一Route差分とS3非開示をSolローカルチェックリストで一貫して確認する。
