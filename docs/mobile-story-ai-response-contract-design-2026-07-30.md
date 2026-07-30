# Story AI response contract 接続設計

## 目的と範囲

Story AIの既存wire応答を共有Mobile API contractへ接続し、AI/Service由来の契約外値をクライアントへ成功データとして流さない。

対象:

- `POST /api/story/improve-episode-draft`のJSON
- `POST /api/episodes/:id/generate-page-skeleton`の同期201・queue 202 JSON
- `POST /api/story/collaborate`の`chunk` / `done` / `error` SSE event

Story AIのprompt、生成内容、保存、queue、クレジット、認証・組織認可、既存wire形式は変更しない。

## Spec根拠

- `docs/Lyra_Unified_Spec_v4.md` Architecture / Long Running Jobs / Security / Test and Verification
- `docs/Lyra_StoryAI_SubSpec.md` Story AI output boundary
- `docs/mobile-release-task-list-2026-07-30.md` GIT-110 PR-A

## 影響レイヤーとインターフェース

- API contract: 改善結果、page skeletonの同期/queue union、SSE event envelopeを追加する。
- Route: JSON送信直前とSSE encode直前に共有contractを検証する。
- Service / Repository / Domain / Infrastructure / Worker / DB / Web / Mobile: 変更しない。
- 正常時のHTTP status、JSON field、SSE wire text、エラーeventを維持する。

## 互換境界

- 改善draftの全編集fieldは現行どおりnullable stringを許可する。
- providerは現行Domainの`openai` / `fallback`だけを許可する。
- 同期page skeletonの件数は0以上、queue job IDは非空文字列とする。
- `story_plan_job_id`は現行どおりnullを許可する。
- SSE chunkはService全体上限24,000文字より広い単一event上限25,000文字とし、通常Service出力を狭めない。
- 契約外SSE chunkはencodeせずstreamをerror終了し、payloadをエラー本文やログへ追加しない。

## セキュリティ

- 既存auth、`edit_work` capability、personal/org ownershipを維持する。
- raw AI payload、provider error、prompt、stack traceを新たに返却・記録しない。
- queue投入、credit settlement、retry classificationは変更しない。

## TDDと検証

1. JSON schemaの正常・境界値、SSE event unionを先にテストする。
2. 改善結果、同期page skeleton、queue page skeleton、SSE chunkの契約外値を先にRouteテストし、失敗を確認する。
3. contractとRoute encode boundaryだけを実装する。
4. focused Vitest、全Vitest/Bun、backend build、migration/invariant、Web lint/build、Playwright smokeを実行する。

## Terra委譲

委譲なし。単一Route内の3つのresponse boundaryを同じwire互換判断で扱う限定変更であり、分割するとSSEとJSONの検証方針がずれるため、Solローカルチェックリストで一貫してレビューする。
