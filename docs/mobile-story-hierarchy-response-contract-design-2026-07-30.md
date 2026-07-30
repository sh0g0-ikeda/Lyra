# Story hierarchy response contract 接続設計

## 目的と範囲

既存の作品・章・話CRUDが返すwire payloadを共有Mobile API contractへ接続し、Serviceまたは永続化層の不正値を成功応答として配信しないようにする。

対象は既存の成功JSONを返す次の12 endpointである。

- Work: 作成、一覧、単体取得、更新
- Chapter: 作成、一覧、更新、移動
- Episode: 作成、一覧、更新、移動

削除の204応答、Story AI、SSE、page skeleton、pagination、Service / Repository / DBは変更しない。

## Spec根拠

- `docs/Lyra_Unified_Spec_v4.md` Architecture
- 同 Security の「LLM structured output はschema validationとquality gate後に保存」
- 同 Test and Verification
- `docs/mobile-release-task-list-2026-07-30.md` GIT-110 PR-A

## 影響レイヤーとインターフェース

- API contract: 現行wire fieldだけを表す`workSchema`、`chapterSchema`、`episodeSchema`と一覧wrapperを追加する。
- Route: `to*Response`後、HTTP送信前に`assertMobileResponseContract`を通す。
- Service / Repository / Domain / DB / Web / Mobile: 変更しない。
- 入力、永続化、外部API、ジョブ、エラー形式: 変更しない。
- 契約外の内部成功値だけを既存`CONFIGURATION_ERROR`へfail closedする。

## 互換境界

- IDとtimestampは既存共有contractと同じ非空文字列境界を使い、UUID/dateの遡及強制は行わない。
- nullable text、空のentity配列、空のkey beat配列を維持する。
- orderとestimated pagesは現行validator/DB契約に合わせて正整数とする。
- versionは既存行と移動処理を受理できる非負整数とする。
- statusとstory input modeは現行Domain unionだけを許可する。
- 既存wire field、HTTP status、配列wrapper、認証・組織認可は変更しない。

## セキュリティ

- 既存認証、personal ownership、organization capabilityをそのまま利用する。
- payload、編集履歴、内部ID、契約検証詳細をログやエラーへ追加しない。
- request validation、parameterized SQL、クレジット、ファイル処理には変更を加えない。

## TDDと検証

1. 3 item schemaと3 empty-list wrapperの正常値、および境界外値を先にテストする。
2. 12 endpointすべてについて、対応Serviceが契約外値を返した場合に500となるRouteテストを先に追加し、失敗を確認する。
3. contractとRoute接続を最小実装する。
4. focused Vitest、全Vitest/Bun、backend build、migration/invariant、Web lint/build、Playwright smokeを実行する。

## Terra委譲

委譲なし。共有contractと単一Routeファイルのresponse-only変更であり、設計・実装・全endpoint配線のレビューを同一コンテキストで行うほうが境界漏れを減らせる。利用可能なオーケストレーションskillも存在しないため、Solローカルチェックリストとして実施する。
