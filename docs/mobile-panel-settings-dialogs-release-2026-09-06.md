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
- Android/iOSのproduction export成功（それぞれ7.1MBのHermes bundle）。配布ファイルの検査結果とiOS提出結果は下記のとおり。

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

EAS Submitによるビルドアップロードは完了。App Reviewへの審査申請・一般公開は別の状態で、この作業では実行していない。

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

コードcommit: `c3f76fc204184d75db0a4746b910dd3fb82f4f5d`。
[PR #204](https://github.com/sh0g0-ikeda/Lyra/pull/204)。コードcommitのGitHub CIは`mobile-verify`、`verify`ともに成功。

| 成果物 | バージョン | 番号 | EASビルドページ |
| --- | --- | --- | --- |
| Google Play用AAB | 1.0.4 | 95 | [AAB](https://expo.dev/accounts/sh0g0/projects/lyra-mobile/builds/671c64c4-02f5-4978-9d88-b5ad60a87494) |
| 直接インストール用APK | 1.0.4 | 96 | [APK](https://expo.dev/accounts/sh0g0/projects/lyra-mobile/builds/68a8569c-f79a-4a76-a10b-c5a033e70cc2) |
| App Store用iOS | 1.0.4 | 36 | [iOS](https://expo.dev/accounts/sh0g0/projects/lyra-mobile/builds/89b2363d-9867-49d3-9fc1-411e043994e5) |

iOSは2026-09-06 06:56:02 UTCに`FINISHED`。実際のIPAでbundle ID、1.0.4/build36、iPhone/iPad対応、最低iOS16.4、本番API、runtime1.0.4、production更新channel、署名関連ファイルの存在を確認。Windows上のためnative codesignによる検証は行っていない。

IPA SHA-256: `cd917a56639521b691094fcda0d76b5b8adcbefa3a8df462f0b5b461f764e41f`。

[iOS提出ページ](https://expo.dev/accounts/sh0g0/projects/lyra-mobile/submissions/49cc29a1-16cc-491c-b24e-e8e385647c85)。対象を上記iOS build IDに固定してEAS Submitへ投入し、2026-09-06 07:01:04 UTCに`FINISHED`を確認した。これはApp Store Connectへのアップロード完了の証拠であり、Apple側の処理完了・App Review申請・承認・一般公開を確認したものではない。

AABは2026-09-06 07:05:38 UTC、APKは07:08:08 UTCに`FINISHED`。3成果物の`gitCommitHash`はすべて上記コードcommitに一致する。

Android成果物の検査:

- AABのbundletool validate成功。package `com.lyra.mobile`、version `1.0.4`、code `95`、minimum SDK24、target SDK36を確認。
- AABの1,436個の非META-INFエントリーをJarFileで読み、署名証明書の一致と重複pathがないことを確認。
- APKのapksigner検査成功（v2署名）、同じpackage/version、code `96`、target SDK36を確認。zipalignの16KBページ検査も成功。
- 両形式の本番API URLを確認し、それぞれ48個の64bit native libraryのELF LOAD alignmentが16KB以上であることを確認。
- 両形式の署名証明書SHA-256: `dddf947c55aebb158251379205d8774729dfbdc0979008eb93476696b878200b`。

AAB SHA-256: `d62bf2faac9b086e975e52b459e145d6b6887cb91f14ef8dbfe99c5df9a10142`。

APK SHA-256: `e224679f34c75bebb2816c480fd6cb466950b5558b5c20edebdce6cfc2c1809c`。

ローカル成果物はignoredの`.tmp/mobile-panel-dialogs-20260906/`に保存した。Gitにバイナリー・認証情報を含めていない。
