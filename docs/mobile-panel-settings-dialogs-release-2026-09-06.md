# Mobile 1.0.4 コマ設定ダイアログ リリース記録

## 変更内容

- 選択コマの行を黄色にし、コマ名・役割・操作アイコンを濃い色へ変更。黄色と文字のコントラスト比は11.28:1。
- 状況・背景、構図・カメラ、コマ内キャラクター、セリフ、効果・メモを個別の設定ダイアログで編集。
- 上部の閉じる操作を固定し、本文だけをスクロール。Modal自身のSafeAreaProvider/SafeAreaViewでシステム操作領域を避ける。
- 入力は既存PagesScreenのdraftに直結し、閉じても保持。ページ・コマ切替時は設定画面をリセット。
- 日本語・英語に対応。API・バックエンド・DB・AWS設定は変更なし。

設計: [mobile-panel-settings-dialogs-2026-09-06.md](./mobile-panel-settings-dialogs-2026-09-06.md)

## 本番との互換性

2026-09-06の読み取り確認でAPIは`lyra-prod-api:129`（2/2）、Workerは`lyra-prod-worker:73`（1/1）、`https://app.lyra-editor.com/readyz`は200。APIのECRイメージは`web-page-list-oom-dda4fda-arm64`に対応し、`src/routes`、`migrations`、`packages/api-contract`にはこのcommitからの差分がない。

ビルドは既存のEAS production設定を利用し、AWS本番APIへ接続する。Androidは`com.lyra.mobile`、iOSは`jp.lyra.mobile`、App Store Connect app IDは`6797564060`。iPad対応は維持する。

## 検証

- 選択表示・バージョンの追加テスト: 変更前に期待した3件の失敗を確認後、関連テスト22件成功。
- ダイアログは既存accordionで期待した失敗を確認後に実装。最終レビュー対象は4ファイル35件成功。nullの新規コマ、ロック解除後の再表示防止、日英切替中のdraft保持、iOS/Androidのfocus復帰も確認。
- Mobile全Vitest: 134ファイル670件成功。型チェック、全体lint、文字化け確認成功。
- バックエンドVitest: 236ファイル、1,636件成功。
- Bun: 3ファイル、26件成功。
- ローカル専用PostgreSQLへmigration適用、50項目のinvariant成功。
- バックエンドbuild、Web lint/build、Playwright smoke 21件成功。
- Mobile API契約・112メソッド/124ルートのinventory・Web parity確認成功。
- Expo依存関係整合性、Expo doctor 21/21成功。
- Android/iOS export、署名成果物と提出結果は完了後に追記する。

実機は未接続で、iPhone/iPad/Androidの実機操作・VoiceOver/TalkBack・ネストした選択画面の実機smokeは未実施。安全領域・キーボード回避・スクロールのコンポーネント検証は、実機表示を直接確認した証拠とは区別する。

既存の未コミット変更（cloud関連2文書、`scripts/createDockerLearningDocx.py`）と未追跡のHANDOFF、root app.json、mockups、Google Play素材は保持し、リリースに含めない。ビルドは今回のcommitだけを取り出したclean worktreeから行う。

## 各ストアへの提出手順

### Google Play

1. EASのAABビルドページを開き、Build artifactから`.aab`をダウンロードする。APKは端末へ直接インストールして確認する用途。
2. [Play Console](https://play.google.com/console/)でLyra Mobile（`com.lyra.mobile`）を開く。
3. 「テストとリリース」→「製品版」（確認用なら「テスト」→「内部テスト」）→「新しいリリースを作成」を選ぶ。
4. AABをアップロードし、リリース名を`1.0.4`にする。下記の日英リリースノートを入力する。
5. 「次へ」で検出されたエラーを解消し、保存する。「公開の概要」で変更を審査へ送信する。画面が直接「公開」を提示するトラックでは、選んだ配布範囲を確認して公開する。

Google Play側へのAABアップロード・審査申請・公開は、この作業では実行していない。

根拠: [Google Play公式のリリース手順](https://support.google.com/googleplay/android-developer/answer/9859348?hl=ja)

### App Store

1. [App Store ConnectのLyra Mobile](https://appstoreconnect.apple.com/apps/6797564060)を開き、TestFlightで今回の`1.0.4`ビルドの処理完了を確認する。
2. 「配信」でiOSの`1.0.4`バージョンを作成または選択し、「ビルド」に今回のビルド番号を指定する。
3. 日英の「このバージョンの最新情報」、必要なスクリーンショット、審査用ログイン情報、輸出コンプライアンスなど画面上の必須項目を確認する。
4. 「審査用に追加」→提出内容を確認→「審査へ提出」を選ぶ。公開方法は既存設定どおり手動。

EAS Submitによるビルドアップロードと、App Reviewへの審査申請・一般公開は別の状態。今回のアップロード結果は完了後に下記へ記録する。

根拠: [Expo iOS提出手順](https://docs.expo.dev/submit/ios/)、[Apple公式の審査提出手順](https://developer.apple.com/help/app-store-connect/manage-submissions-to-app-review/submit-an-app)

### リリースノート

```text
<ja-JP>
選択中のコマを黄色で分かりやすく表示し、5つのコマ設定をポップアップで編集できるようにしました。設定画面のスクロールと操作ボタンの配置を改善しました。
</ja-JP>
<en-US>
Selected panels now stand out in yellow. Edit the five panel settings in separate dialogs with improved scrolling and button placement.
</en-US>
```

## 成果物と提出結果

検証・レビュー完了後に、commit、PR、AAB/APK/iOSのビルド番号・EASページ・署名確認・iOS提出結果を追記する。
