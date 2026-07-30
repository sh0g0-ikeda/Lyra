# Page story metadata migration 028 compatibility design

## 目的と範囲

PR #67の`028_add_page_story_metadata_columns.sql`を現mainへそのまま移植せず、既存の`pages.layout_config`保存契約を維持したままmigration番号028を確定する。

対象はmigration履歴と契約テストだけである。Page API、Repository、Service、Web UI、Mobile UI、生成prompt、既存データは変更しない。

## Spec根拠

- `docs/Lyra_Unified_Spec_v4.md` Data and migrations
- 同Specの「適用済みmigrationを編集しない」「契約変更はmigration・テスト・Spec更新を組にする」
- `docs/mobile-release-task-list-2026-07-30.md` DB-300 migration 028

## 現行実装の確認

現mainは以下をすでに満たす。

- `PageService`が`story_source_scene_ids`、`story_page_purpose`、`story_continuity_note`を`layout_config`へ保存する。
- `PageRepository`が同じ3 keyを`layout_config`から読み出す。
- Route validatorがscene ID数、page purpose、continuity noteの長さを制限する。
- Page response contractが同じwire fieldを返す。
- 生成promptはRepositoryが返すpage story metadataを利用する。

PR #67案は同じ値を物理列へbackfillし、Repositoryを物理列優先へ切り替える。現行機能に必要な情報は増えず、移植するとJSONと列の二重保存・移行期間・切替不整合が新たに生じる。

## 設計

`028_preserve_page_story_metadata_in_layout_config.sql`を互換性checkpointとして追加する。SQLは意図を記録するコメントだけで、`pages`を変更しない。

これによりmigration 027の次に028が適用済みとして記録され、後続migrationを番号順に追加できる。旧PR #67の028は統合対象外とする。

## 影響

- 話の一貫性: 変化なし。scene選択、page purpose、continuity noteの既存値と生成prompt経路を維持する。
- 反映時間: schema変更、backfill、table lockがないため、migration記録以外はほぼ発生しない。
- データ構造: 既存`pages.layout_config`を維持し、列追加やデータ移動を行わない。
- API / UI: wire fieldと画面動作を変更しない。

## セキュリティ

認証・認可・テナンシー・SQL入力・S3・クレジット・外部APIは変更しない。既存のbounded Zod validationをそのまま利用する。

## テスト方針

先に、028が存在し、物理列を追加せず、Repository / Serviceが3項目を`layout_config`で読み書きすることを要求するテストを追加する。migration不在でredを確認後、comment-only migrationを追加してgreenにする。

最終確認はVitest/Bun、fresh PostgreSQL migrationとinvariant、Backend build、Web lint/build、Playwright smokeを行う。

## Sol / Terra

利用可能な`skills/lyra-sol-terra-orchestration`が作業環境に存在せず、また本変更はmigration 1ファイルと契約テストに限定されるため委譲しない。Sol相当の設計・実装・レビュー・検証を同一作業で行う。

