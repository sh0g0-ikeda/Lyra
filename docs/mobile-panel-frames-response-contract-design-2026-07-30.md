# Mobile panel frames response contract design

## 目的と範囲

PR #67 の Mobile API response contract から、Panel frame の一覧、一括保存、テンプレート適用の成功応答を独立して共通 Zod schema へ接続する。

対象 endpoint:

- `GET /api/pages/:id/frames`
- `PUT /api/pages/:id/frames`
- `POST /api/pages/:id/frames/apply-template`

JSON wire payload、HTTP status、DB、Service、監査ログ、認証・認可、入力検証は変更しない。Backend 内部が契約外の値を返した場合だけ、壊れた成功応答を返さず既存の `CONFIGURATION_ERROR` とする。

## Spec 根拠

- `docs/Lyra_Unified_Spec_v4.md` §3: Route のレスポンス変換責務
- `docs/Lyra_Unified_Spec_v4.md` §4: personal ownership / organization membership
- `docs/Lyra_Unified_Spec_v4.md` §8: 出力の schema validation
- `docs/Lyra_Unified_Spec_v4.md` §10: release verification gate
- `docs/mobile-release-task-list-2026-07-30.md` GIT-110 PR-A

## 現行契約と互換性の監査

現行 Domain、Repository mapping、Web の `PanelFrameRecord`、PR #67 案はfield名と型が一致する。一方、request validatorは新規入力を4頂点、座標0〜1、色形式、幅などへ限定するが、Domainと既存DBには同じ制約がない。

既存データへ新しい制約を遡及適用しないため、response schemaはPR #67と同じ広い互換境界を使う。

- vertices: 数値のx/yを持つ3頂点以上
- border style: `solid` / `dashed` / `none`
- border width: 非負
- z index: 整数
- reading order: 非負整数
- ID、色、template ID: 既存wireどおり空でない文字列または文字列

request 側だけの4頂点、座標範囲、16進色、上限はresponseへ新しく課さない。

## 影響レイヤーとインターフェース

- Route: 3つの成功 payload の返却直前に共通 schema 検証を追加する
- Shared contract: frame item、一覧 wrapper、template application schemaを追加する
- Tests: schemaの正常・互換境界・異常と、3 endpointのfail-closedを追加する
- Service / Repository / Domain / Infrastructure / Worker / Web / Mobile / Ops / Migration: 変更しない
- 永続化、外部API、ジョブ、クレジット: 変更しない

## セキュリティ

既存のJWT、rate limit、UUID validation、personal ownership、organizationの`view_work` / `edit_work` capability、organization auditを維持する。schema issue、payload、秘密情報はerror messageやログへ追加しない。

## 必要十分条件

1. 現行frame item、`{ frames }`、template applicationを受理する。
2. 既存DBで表現可能な3頂点や広い座標値を不必要に拒否しない。
3. enum外のborder style、負のwidth、壊れた頂点、欠落fieldを拒否する。
4. 3つの成功endpointがすべて同じitem schemaを使う。
5. 正常時のfield、値、status、監査ログ順序を変えない。
6. 契約違反時は既存の`CONFIGURATION_ERROR`だけを返す。

## テスト方針

先に共通schemaと3 endpointの失敗テストを追加し、schema未実装・Route未接続で失敗することを確認する。その後、focused Vitest、全Vitest / Bun、migration / invariant、Backend build、Web lint / build、Playwright smokeを実行する。

## Sol / Terra

指定された`skills/lyra-sol-terra-orchestration`は現行mainに存在せず、sub-agent委譲の明示指示もない。変更は単一resourceのRoute、共通schema、限定テストに閉じるため、ここに設計・境界・検証方針を残し、Sol単独で実装とレビューを行う。
