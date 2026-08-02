# Mobile 保存確認・生成時間・名称変更 UI 設計（2026-08-02）

## 目的と範囲

- ストーリー編集の未保存確認は維持する。
- ページ、コマ、枠の編集は、別ページ・別コマ・別枠・別タブへの移動を保存確認で止めない。未保存内容が失われる可能性は許容する。
- サーバー値を初回表示しただけの状態を未保存変更として扱わない。
- 画像生成中は「5分程度」、ストーリーから設定を自動入力中は「20分程度」かかる可能性を日本語・英語で表示する。
- 作品名・章名・話名の入力ダイアログをキーボードより上の画面中上部に配置する。
- 画面遷移でページ設計ジョブを停止しないことを契約テストで固定する。

バックエンド、API、DB、生成 payload、クレジット、ジョブ投入・取消契約、既存の色と主要レイアウトは変更しない。

## Spec 根拠

- `docs/Lyra_Unified_Spec_v4.md` の Architecture / Generation jobs / Mobile client。
- ジョブはサーバーへ永続化され、`queued` / `processing` の間はクライアントが状態を再取得する。画面の unmount は取消 API を呼ぶ理由にしない。
- LLM 出力の検証、原子的保存、active job uniqueness、クレジット精算の契約は変更しない。

## 影響レイヤーとインターフェース

- Mobile Domain / State: dirty editor 登録へ「画面遷移を止めるか」の属性を追加する。既定値は従来どおり止める。
- Mobile Pages: `pages-editor` だけ画面遷移を止めない。生成前の `saveAllPageDrafts` と明示的な保存ボタンは維持する。
- Mobile Job UI / i18n: job type に応じた所要時間の目安を active 状態だけ表示する。
- Mobile Hierarchy UI: 名称入力ダイアログの safe-area と keyboard avoidance を中上部配置に変更する。

## セキュリティとデータ整合性

- 認証、認可、organization scope、Zod schema、SQL、シークレット、ファイル、課金処理に変更なし。
- ページ移動時の未保存ローカル draft は破棄され得るが、保存済みデータは変更しない。
- 画像生成とストーリー自動入力の開始前保存は維持し、生成 payload の整合性は変えない。
- ジョブの停止は既存の明示的な取消操作だけが API を呼ぶ。

## テスト方針

1. dirty-state policy: 非 blocking editor は保存確認対象から外れ、background save には残る。
2. Pages contract: page editor は非 blocking、初回同期判定は resource ID と server snapshot を要求する。
3. JobStatusCard: image job は5分、story autofill job は20分、完了後は目安を表示しない。
4. StoryGenerationControls: 実行前にも20分の目安を表示する。
5. StoryHierarchySheet: title dialog が keyboard avoidance 内の中上部配置である。
6. Page design recovery: unmount cleanup に cancel API がなく、再表示時は active server job を問い合わせる。
7. 対象 Vitest、mobile typecheck / lint / contracts / Android export を実行する。

## 委譲方針

指定された `skills/lyra-sol-terra-orchestration` がリポジトリおよびローカル skill 領域に存在しないため、委譲なし。上記を Terra task packet 相当のローカルチェックリストとして扱い、実装と統合判断を単独で行う。
