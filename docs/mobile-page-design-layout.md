# Mobile ページ設計 UI 配置変更

## 目的と範囲

- Mobile の「作品・章・話」を「作品・章・話を選択」へ変更する。
- ページ画面の冒頭に、話からページ骨格とコマ入力を作る二段階の「ページ設計」を配置する。
- 選択中ページの通常プレビューを、ページ生成操作と画像保存操作の間へ移動する。
- Backend API、永続化、クレジット処理、Web 版は変更しない。

## Spec 根拠

- `docs/Lyra_Unified_Spec_v4.md` §2 Primary flow 4:
  ページ骨格生成後、話の内容を編集可能なコマ入力へ反映する。
- 同 §2 Primary flow 6:
  現在保存されているページ入力からページ画像を生成する。
- 同 §6 Generation jobs:
  生成処理は既存の非同期ジョブ契約とジョブ状態を正として扱う。

## 影響レイヤーとインターフェース

- 影響レイヤー: Mobile のみ。
- ページ骨格: 既存 `generatePageSkeleton` API を使用する。
- ストーリー反映: 既存 `autofillEpisodePagesFromStory` API を使用する。
- ジョブ状態: 話 ID を対象に `episode_page_skeleton` と
  `episode_story_autofill` を追跡する。
- 完了時はページ、ページ詳細、コマ、枠、話一覧の React Query cache を再取得する。
- ページ画像生成の `page_generate` ジョブとは別の状態として管理する。

## セキュリティ

- 既存の認証済み API client と organization scope をそのまま使用する。
- `generate` capability がない利用者には操作を許可しない。
- ユーザー入力を URL、storage key、SQL、シークレットへ追加しない。

## テスト方針

- 先に UI 文言、画面上の配置順、画像プレビュー位置を契約テストへ追加し、失敗を確認する。
- コンポーネントテストで二段階の説明と操作名を確認する。
- 実装後に Mobile の対象 Vitest、TypeScript、lint、既存 UI 契約テストを実行する。

## Sol / Terra

- Terra は既存 Story 画面の API、ジョブ追跡、無効化処理を read-only で調査する。
- Sol がページ画面への統合、競合防止、テスト、最終レビューを担当する。
