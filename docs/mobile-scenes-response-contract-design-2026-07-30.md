# Mobile scenes response contract design

## 目的と範囲

PR #67 の Mobile API response contract から、現行SceneとEntity state Routeの成功応答だけを独立して共通Zod schemaへ接続する。

対象 endpoint:

- `POST /api/episodes/:id/scenes`
- `GET /api/episodes/:id/scenes`
- `PUT /api/scenes/:id`
- `POST /api/entities/:id/states`
- `PUT /api/entities/:id/states/:state_id`

`DELETE /api/scenes/:id`はbodyのない204のため対象外とする。PR #67にある新規`GET /api/entities/:id/states`はService、Repository、SQL、認可契約を追加するため、このresponse-only変更へ混ぜず後続の独立PRで扱う。

JSON wire payload、HTTP status、DB、Service、監査ログ、認証・認可、入力検証は変更しない。Backend内部が契約外の値を返した場合だけ、壊れた成功応答を返さず既存の`CONFIGURATION_ERROR`とする。

## Spec 根拠

- `docs/Lyra_Unified_Spec_v4.md` §3: Routeのレスポンス変換責務
- `docs/Lyra_Unified_Spec_v4.md` §4: personal ownership / organization membership
- `docs/Lyra_Unified_Spec_v4.md` §8: 出力のschema validation
- `docs/Lyra_Unified_Spec_v4.md` §10: release verification gate
- `docs/mobile-release-task-list-2026-07-30.md` GIT-110 PR-A

## 現行契約と互換性の監査

現行Domain、Repository mapping、request validator、Webの`SceneRecord`、PR #67案を比較した。

- Scene status 3種、正のorder、nullable text、timestampは一致する
- `involved_entity_ids`と`entity_states`は空配列を含む配列で一致する
- Scene内のstate referenceは`entity_id`と`state_id`の組で一致する
- Entity stateのsceneと各noteはnullableで一致する
- `expression_default`は既存入力上限どおり1〜100文字である
- Scene一覧だけが`{ scenes: [...] }`、他は単一itemを返す

未選択のEntity、Sceneに紐づかないstate、stateが0件のSceneは正常なdomain状態であり、空配列や`scene_id: null`を失敗として扱わない。

## 影響レイヤーとインターフェース

- Route: 現行5つの成功payloadの返却直前に共通schema検証を追加する
- Shared contract: Scene item、Scene一覧wrapper、Entity state itemを追加する
- Tests: schemaの正常・empty state・異常と5 endpointのfail-closedを追加する
- Service / Repository / Domain / Infrastructure / Worker / Web / Mobile / Ops / Migration: 変更しない
- 永続化、外部API、ジョブ、クレジット: 変更しない

## セキュリティ

既存のJWT、rate limit、UUID validation、personal ownership、organizationの`view_work` / `edit_work` capability、organization auditを維持する。schema issue、Scene内容、秘密情報はerror messageやログへ追加しない。

## 必要十分条件

1. 現行Scene、Scene一覧、Entity stateを受理する。
2. 空の`involved_entity_ids`、空の`entity_states`、nullableな`scene_id`とnoteを受理する。
3. 非正order、不正status、不完全なstate reference、空の`expression_default`を拒否する。
4. Sceneの作成・一覧・更新が同じScene schemaを使う。
5. Entity stateの作成・更新が同じEntity state schemaを使う。
6. 正常時のfield、値、status、監査ログ順序を変えない。
7. 契約違反時は既存の`CONFIGURATION_ERROR`だけを返す。

## テスト方針

先に共通schemaと5 endpointの失敗テストを追加し、schema未実装・Route未接続で失敗することを確認する。その後、focused Vitest、全Vitest / Bun、migration / invariant、Backend build、Web lint / build、Playwright smokeを実行する。

## Sol / Terra

指定された`skills/lyra-sol-terra-orchestration`は現行mainに存在せず、sub-agent委譲の明示指示もない。変更は単一resourceのRoute、共通schema、限定テストに閉じるため、ここに設計・境界・検証方針を残し、Sol単独で実装とレビューを行う。
