# Generation job response contract 接続設計

## 目的と範囲

job取得と停止の既存JSON応答を共有Mobile API contractへ接続し、4種類のjobごとに許可されたparams/resultだけを成功データとして返す。

対象:

- `GET /api/jobs/:id`
- `POST /api/jobs/:id/cancel`
- `page_generate`
- `entity_generate`
- `episode_story_autofill`
- `episode_page_skeleton`

job作成・停止判定、queue、Worker、refund、Repository、DB、既存response sanitizerは変更しない。

## Spec根拠

- `docs/Lyra_Unified_Spec_v4.md` Architecture / Long Running Jobs / Files and Images / Security / Test and Verification
- `docs/mobile-release-task-list-2026-07-30.md` GIT-110 PR-A

## 影響レイヤーとインターフェース

- API contract: 共通job metadataとjob type別params/resultのdiscriminated union schemaを追加する。
- Route: 既存`toJobResponse`で内部情報を除去・署名・token化した後、HTTP送信直前に共有contractを検証する。
- Service / Repository / Domain / Infrastructure / Worker / DB / Web / Mobile: 変更しない。
- request、HTTP status、認証・組織認可、停止条件、永続化、refundを維持する。

## 互換境界

- queued/processing等で`result`がnullまたは部分objectの状態を許可する。
- params/resultの各既知fieldは、進行中・失敗・旧jobを考慮してoptionalとする。
- cancel/progress timestampとcompiler metadataのnullを維持する。
- entity候補の署名`cdn_url`省略を許可し、候補tokenを維持する。
- page生成画像は現行sanitizerが残すgeneration modeと生成日時だけを許可する。
- Story autofillとpage skeletonは現行進捗fieldと完了集計だけを許可する。

## セキュリティ

- 既存auth、personal/org tenancy、organization `view_work` / `edit_work`を維持する。
- root、params、result、候補、生成画像、story plan resultをstrict schemaで検証する。
- `user_id`、`organization_id`、SQS/OpenAI request ID、S3 key、raw CDN URL、内部prompt、compiler brief、cost metadataを許可しない。
- 既存のcandidate token scope/signatureとCloudFront署名処理を変更しない。
- 契約不一致は既存の汎用ConfigurationErrorとしてfail closedする。

## TDDと検証

1. 4 job typeのnull/partial/完了応答と内部field拒否を先にcontractテストする。
2. GET/停止の両endpointが契約外Service値を500にするRouteテストを先に追加し、失敗を確認する。
3. job type別contractとRoute guardだけを実装する。
4. focused Vitest、全Vitest/Bun、backend build、migration/invariant、Web lint/build、Playwright smokeを実行する。

## Terra委譲

委譲なし。上位指示によりsub-agentは使用せず、security-sensitiveな既存sanitizer出力とstrict schemaをSolローカルチェックリストで一貫して確認する。
