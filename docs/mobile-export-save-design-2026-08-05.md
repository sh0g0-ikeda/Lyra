# Mobile 画像・PDF保存の実機信頼性修正設計

## 目的と範囲

- iOS / Android の同じ画面と同じ操作で、生成画像を端末の写真ライブラリへ保存できるようにする。
- PDF / ZIP エクスポートは、ダウンロード操作時に有効な URL を取り直し、端末の標準保存・共有画面へ渡す。
- 参照画像アップロードの既存フローを回帰テストし、今回の修正で壊さない。
- Mobile クライアント内の保存・取得経路だけを対象とする。バックエンドの API、データ構造、認証、生成ジョブ、クレジット処理、UI の位置・色は変更しない。

## Spec 根拠

- `docs/Lyra_Unified_Spec_v4.md` の主要フロー「選択したページを画像または PDF でエクスポートする」。
- 同 Spec の File / Image security。認証済み取得または短命 URL を使い、秘密情報を永続化しない。
- 同 Spec の Verification gates。対象テストから開始し、Mobile lint / typecheck / test とリリースビルドを確認する。

## 影響レイヤー

- Mobile: `apps/mobile/src/lib/download.ts`、エクスポートカード、ページ画面、関連テスト。
- Backend / Worker / Web / DB / Infrastructure: 変更しない。

## インターフェースと動作

1. 個別画像保存
   - 入力: API から取得した画像 Blob。
   - 処理: 一時ファイルへ書き込み、現行 Expo MediaLibrary API で写真ライブラリへ保存。
   - 出力: 保存成功、権限拒否、ストレージ書き込み失敗、写真ライブラリ保存失敗を区別する。
2. PDF / ZIP 保存
   - 入力: 完了済み export job ID。
   - 処理: ボタン押下時に export job を再取得し、新しい短命 URL を得る。ドキュメント領域へダウンロードし、OS 標準の保存・共有画面へ渡す。
   - 出力: 端末側で Files / Downloads 等を選択できる。失効済み URL を再利用しない。
3. 参照画像アップロード
   - 既存の presign -> PUT -> finalize の順序と、2xx 完了後だけ finalize する契約を維持する。

## セキュリティ

- download URL、upload token、認証情報をログ・テスト fixture・PR 本文へ残さない。
- PDF の短命 URL は操作時にのみ取得し、永続化しない。
- 画像保存先にはユーザー入力を直接パスとして使わず、既存の安全なファイル名生成を維持する。

## テスト方針

1. 現行 SDK で削除済みの旧 MediaLibrary API を使わず、`MediaLibrary.Asset.create` を呼ぶテストを先に追加して失敗を確認する。
2. エクスポートの保存ボタンが、カードに残っている古い URL ではなく API から再取得した URL を渡すテストを先に追加して失敗を確認する。
3. 参照画像アップロードの既存 unit test を実行する。
4. Mobile の test / lint / typecheck / Expo doctor を実行する。
5. iOS production build を App Store Connect へ提出し、Android production AAB と production APK を生成する。

## Sol / Terra 方針と Git ベースライン

- 保存処理、UI 接続、リリース認証が同じクリティカルパス上にあり、共有ワークツリーで安全に統合する必要があるため、今回は Terra へ委譲せず Sol が一貫して実装・レビュー・検証する。
- 開始時点でユーザー所有の未コミット変更が存在するため main への切り替え・pull は行わず、安全な現行 HEAD `51ae11f` から `fix/mobile-export-reliability` を作成した。既存 dirty path は編集・コミットしない。

## 検証結果

- 先行テストでは、旧 `createAssetAsync` 呼び出しと、保存時に短命 URL を再取得しない挙動をそれぞれ再現した。
- Mobile unit test 119 files / 517 tests、typecheck、lint、契約チェック、mojibake チェックに合格した。
- Expo doctor 20 / 20、iOS / Android のローカル bundle export に合格した。
- Backend build、Web lint / build、Mobile-Web parity check に合格した。今回 Backend / DB は変更していない。
- ルート全体テストのうち、ユーザー所有の未コミット `docs/mobile-backend-route-inventory.md` と現行実装の差分を検査する既存テストだけが失敗した。本変更の対象外のため同資料は変更しない。
- DB invariant はローカル PostgreSQL が起動しておらず `127.0.0.1:5432` への接続を確立できなかったため、実行環境上未検証とする。
