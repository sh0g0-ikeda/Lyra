# Mobile panel assignments response contract design

## 目的と範囲

PR #67 の Mobile API response contract から、Panel に割り当てた Entity の保存応答だけを独立して共通 Zod schema へ接続する。対象 endpoint は `PUT /api/panels/:id/entities` とする。

JSON wire payload、HTTP status、DB、Service、認証・認可、入力検証は変更しない。Backend 内部が契約外の値を返した場合だけ、壊れた成功応答を返さず既存の安定した `CONFIGURATION_ERROR` とする。

## Spec 根拠

- `docs/Lyra_Unified_Spec_v4.md` §3: Route のレスポンス変換責務
- `docs/Lyra_Unified_Spec_v4.md` §4: personal ownership / organization membership
- `docs/Lyra_Unified_Spec_v4.md` §8: 出力の schema validation
- `docs/Lyra_Unified_Spec_v4.md` §10: release verification gate
- `docs/mobile-release-task-list-2026-07-30.md` GIT-110 PR-A

## 現行契約の監査

現行 Domain、request validator、Web の `PanelEntityAssignmentRecord` は次の点で一致している。

- role: `primary` / `secondary` / `background`
- expression: `determined` / `calm` / `angry` / `sad` / `surprised` / `custom`
- action: `standing_firm` / `attacking` / `defending` / `running` / `custom`
- position: `left` / `center` / `right` / `background`
- facing direction: 6種類または `null`
- custom expression、custom action、effect note、state id: 文字列または `null`
- 応答 wrapper: `{ entities: [...] }`

共通 schema はこの現行契約をそのまま表し、request 側だけにある UUID、最大長、custom 値の相関制約を response に新しく課さない。これは、既存 wire 契約を狭めず、型・列挙値・必須 field の drift だけを検出するためである。

## 影響レイヤーとインターフェース

- Route: 成功 payload の返却直前に共通 schema 検証を追加する
- Shared contract: assignment item と `{ entities }` response schema を追加する
- Tests: schema の正常・境界・異常と、Route の fail-closed を追加する
- Service / Repository / Domain / Infrastructure / Worker / Web / Mobile / Ops / Migration: 変更しない
- 永続化、外部 API、ジョブ、クレジット: 変更しない

## セキュリティ

既存の JWT、rate limit、UUID validation、personal ownership、organization `edit_work` capability を維持する。schema issue、payload 内容、秘密情報は error message やログへ追加しない。

## 必要十分条件

1. 現行の全 enum、nullable field、wrapper を受理する。
2. enum 外の role など、Mobile/Web が安全に扱えない成功 payload を拒否する。
3. 正常時の field、値、status、処理順を変えない。
4. 既存の認証・入力・ownership テストを維持する。
5. 契約違反時は既存の `CONFIGURATION_ERROR` だけを返す。

## テスト方針

先に共通 schema と Route の失敗テストを追加し、schema 未実装・未接続で失敗することを確認する。その後、focused Vitest、全 Vitest / Bun、migration / invariant、Backend build、Web lint / build、Playwright smoke を実行する。

## Sol / Terra

利用可能と指定された `skills/lyra-sol-terra-orchestration` は現行 main に存在せず、sub-agent 委譲の明示指示もない。変更は単一 Route、共通 schema、限定テストに閉じるため、ここに設計・境界・検証方針を残し、Sol 単独で実装とレビューを行う。
