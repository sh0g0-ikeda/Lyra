# Mobile ストア審査リジェクト要因の最小是正設計

作成日: 2026-08-02

## 目的と範囲

Apple App Review と Google Play review で明確な拒否要因になり得る箇所だけを、現行 Lyra Mobile の操作構造を変えずに是正する。

- 対象: AI へのデータ送信前の明示同意、AI 生成物のアプリ内通報、ネイティブアプリ内の外部決済導線、アカウント削除入口、審査用の法務・メタデータ・提出チェックリスト。
- 対象外: 新しい制作機能、画面再設計、色・配置変更、生成・保存・課金の Backend 契約変更、DB・migration・Worker 変更。
- Backend 変更はアカウント削除に必要な場合だけ許容する。本差分では既存削除 API を利用し、Backend ソースは変更しない。
- 既存の Web、保存データ、生成ジョブ、クレジット、personal / organization 境界を変更しない。

## Spec 根拠

- `docs/Lyra_Unified_Spec_v4.md` §2 Product boundary: 現行の物語・キャラ・ページ・書き出しフローを維持する。
- §3 Architecture: Mobile 内の表示・端末操作は `apps/mobile` に閉じ、Backend Route / Service / Repository を変更しない。
- §4 Authentication and authorization: 削除は既存の認証済みアカウント削除契約を使う。
- §7 Credits and billing: native store billing は verifier、allowlist、credential、flag が揃うまで fail closed とする。
- Verification gate: 両 OS の build/export と Mobile/Web/Backend の共有検証を行う。

## 監査結果と最小是正

1. AI への送信同意
   - 現状: 一部の生成は確認ダイアログを持つが、OpenAI への本文・画像送信が明示されていない。StoryAI 相談と画像 import は送信直前確認がない。
   - 是正: 既存の確認ダイアログ文言へ「入力した本文または画像を OpenAI に送信する」旨を追記し、StoryAI と画像 import に同じ既存ダイアログを追加する。
   - 影響: 送信前の一操作だけ増える。ボタン位置、色、API body、保存構造は不変。

2. AI 生成物の通報
   - 現状: Google Play の AI-generated content policy が求めるアプリ内通報がない。
   - 是正: 既存の StoryAI 提案と生成画像 preview 内に、小さな secondary/ghost action を追加する。通報は既存 Sentry feedback 経路へ、理由・content kind・opaque ID だけを送る。本文、prompt、画像、メール、token は送らない。
   - 影響: 生成物を表示した時だけ補助 action が増える。制作データや Backend は不変。

3. organization 外部決済導線
   - 現状: mobile の organization 管理から Stripe checkout / portal を開ける。
   - 是正: 共通 component に `allowExternalBillingActions` を追加し、Mobile 呼び出しだけ `false` にする。請求状態・invoice 閲覧は維持する。
   - 影響: Web/Backend は不変。Mobile から購入・プラン変更・portal への CTA だけを隠す。

4. アカウント削除
   - 現状: UI と API は存在するが production client flag が設定されていない。
   - 是正: production build profile で client flag を有効化する。サーバー flag、IAM、recovery の有効化・実機確認は外部環境作業として残す。
   - 影響: 既存の削除 section が見えるようになるだけで、新しい API / DB 契約は作らない。

5. 法務・ストアメタデータ
   - 現状: 公開 privacy page は日本語のみ、Sentry・AI 共有同意の説明が不足し、Google 用削除 URL が削除申請専用ページではない。
   - 是正: version 管理された日英の privacy / terms / support / account-deletion 静的ページを追加し、store metadata を言語別 URL と専用削除 URLへ更新する。現運営者名の最終確定、法務承認、公開環境への配置は人間作業として明記する。
   - 影響: アプリ機能・API・UI 色配置は不変。Auth 画面の既存リンク先だけ言語別になる。

## 影響レイヤーとインターフェース

- Mobile: 既存 confirmation、preview、billing component、build config、i18n、tests。
- Web: `apps/web/public` の静的法務ページのみ。React application と Backend proxy は変更しない。
- Ops/store: EAS env、App Store / Play metadata、review notes、AASA 事前検査、task list。
- Backend / Worker / DB: 変更なし。
- 外部送信: AI 通報は Sentry feedback。送信値は固定理由、content kind、opaque resource ID に限定する。

## セキュリティ

- AI 同意前には provider request を開始しない。
- 通報へ story 本文、prompt、画像 URL、access token、user ID、email を含めない。
- URL は HTTPS 固定とし、store metadata の公開 URL だけを使う。
- Mobile から Stripe checkout / portal を開始しない。
- account deletion request は既存どおり認証済み user 自身、明示 acknowledgement、blocker 検査に従う。

## テスト方針

先に次の失敗テストを追加し、失敗を確認してから実装する。

1. production profile が account deletion client flag を有効にする。
2. Mobile の organization panel が外部決済 action を非表示にできる。
3. AI 通報がアプリ内から送れ、payload に本文・画像・識別情報を含めない。
4. StoryAI 提案と生成画像に通報 action が出る。
5. AI request / image import の送信前同意が呼ばれる。
6. 日英 metadata が日英の privacy/support と専用 deletion URL を参照する。
7. 法務ページが必要な disclosure と削除申請導線を持つ。

最終検証は Mobile test/typecheck/lint/contracts/doctor/export、Web lint/build、root test/build、DB invariant、Playwright smoke を実行する。

## Sol / Terra 分担記録

- Sol: 制約確定、設計、統合、セキュリティ判断、最終レビュー、release gate。
- Terra read-only 監査: Apple 審査、Google Play 審査、production preflight、購入実装整合性を分担済み。
- 統合判断: 監査候補のうち、Backend 新規開発や UI 再配置が必要な案は採用しない。明文化された審査要件に直接対応する上記だけを実装する。
