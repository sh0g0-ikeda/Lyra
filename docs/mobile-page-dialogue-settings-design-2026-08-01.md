# Mobile ページ台詞設定編集 設計

## 目的と範囲

Mobile のページ画面で、保存済み Page の `dialogue_mode` と
`page_dialogue_toggle` だけを編集・保存できるようにする。

この変更では以下を行わない。

- Backend、DB、Worker、Web、共有 API schema の変更
- Page、Panel、Scene、Entity のデータ構造変更
- Page 作成・削除、画像生成、Story AI、クレジット処理の変更
- `style_reference`、`source_scene_ids`、`purpose`、`continuity_note` の編集
- Panel の Entity assignment や Dialogue の編集

既存の本番パイプラインへ渡る情報と永続化規則は変えず、Mobile が既存の
`PUT /api/pages/:id` に既存 schema の部分更新 payload を送る UI だけを追加する。

## Spec 根拠

- `docs/Lyra_Unified_Spec_v4.md` 2章: Page plan と Panel は既存制作フローの一部であり、
  生成は現在保存済みの入力を使う。
- 同 4・5章: personal ownership または active organization membership の scope を維持する。
- 同 6章: active generation の重複防止と、現在保存済み入力からの生成契約を維持する。
- 同 8章: 既存の bounded schema と sanitized error をそのまま利用する。
- 同 10章: Mobile の局所テストに加え、PR 前に release verification gate を実行する。

現行契約の一次根拠は `src/lib/validators/page.schema.ts`、`src/routes/pages.ts`、
`src/services/page/PageService.ts`、`packages/api-contract/src/mobileApiSchemas.ts` とする。

## 影響レイヤー

- Mobile API client: 既存 endpoint の型付き呼び出しを追加
- Mobile Domain: dirty 判定、changed-field-only payload、remote conflict 判定の純粋ロジックを追加
- Mobile UI: Page 選択、2項目の編集、保存・破棄・取消、競合表示を追加
- Mobile query cache: 現在の session / workspace / episode key に一致する Page 一覧だけを更新

Route / Service / Repository / Infrastructure / Worker / Web / migration は変更しない。

## インターフェースとデータ契約

入力は既存 contract の次の部分集合だけとする。

```ts
type UpdateMobilePageDialogueSettingsInput = {
  dialogue_mode?: "image_baked" | "balloon_only" | "mixed";
  page_dialogue_toggle?: boolean;
};
```

- `PUT /api/pages/:pageId`
- organization workspace では既存 client 規約どおり `organization_id` query を付ける
- 変更された field だけを送る。未変更 field、`undefined`、他の Page 設定は送らない
- response は既存 strict `pageSchema` で検証し、requested Page ID と episode ID の一致を確認する
- 永続化、外部 API、generation job、credit ledger への新しい書き込みは追加しない

## 状態遷移と競合制御

1. Page を選ぶと、server response から保存済み baseline と draft を作る。
2. 別 Page、別 episode、別 tab、別 workspace への移動前に、dirty draft を
   保存・破棄・取消の既存遷移へ接続する。
3. 保存直前に Page 一覧を再取得する。
4. Page が消えた、別 episode になった、または対象2項目が baseline から remote 変更された場合は、
   PUT せず fail-closed にして draft を保持する。
5. `updated_at` だけが変わり対象2項目が同じ場合は、Panel 更新等の無関係な変更として
   最新 baseline を採用し、保存を続行できる。
6. `confirmed` / `generating` Page、active planning job、job 読込失敗中は編集・保存を止める。
7. 保存 request は single-flight とし、response ID / episode mismatch や失敗時は draft を保持する。
8. session / workspace / episode / Page scope が変わった後に古い request が完了しても、
   新しい scope の UI や cache を更新しない。

## セキュリティ

- 認証 token、organization scope、エラー変換は既存 Mobile API client を再利用する。
- client から user ID、work ID、credit、job、storage identifier を送らない。
- Page ID は path、organization ID は既存 query helper だけで渡す。
- server response を schema と ID scope の両方で検証する。
- raw provider error、秘密情報、draft 内容をログへ追加しない。

## TDD 方針

実装前に以下の失敗テストを追加する。

- API: personal / organization request、変更 field だけの body、strict response、ID mismatch
- Domain: draft 作成、changed-field-only、remote relevant change、unrelated `updated_at` change
- UI: Page 選択と保存、locked status、active/error job、dirty 保存・破棄・取消、single-flight
- UI: remote conflict、response mismatch、scope 切替後の遅延 completion 隔離

対象テストの期待失敗を確認後に実装する。局所確認後、Mobile 全体、contract drift、
Backend test/build、migration/invariant、Web lint/build、Playwright smoke を実行する。

## Terra 委譲方針

初期の候補比較と既存 contract 調査は Terra の read-only 調査結果を Sol が確認済み。
実装は画面遷移と cache scope の統合判断が集中するため Sol が行う。実装後に Terra へ
read-only の独立監査を依頼し、pipeline contract、scope isolation、stale write、
dirty transition、single-flight の P0/P1 問題がないか確認する。
