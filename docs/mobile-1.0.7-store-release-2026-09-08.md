# Mobile 1.0.7 AAB・iOS提出記録

## 今回の作業報告

### 何を作ったか（一言で）

取り込み前のキャラ情報自動保存を含む1.0.7の、Google Play用AABとiOS提出用ビルド。

### なぜそれを作ったか

キャラ作成・画像取り込み・保存・プレビュー生成・確定を安定させた修正と、Googleの写真権限リジェクト対応をストア配布へ進めるため。

### 具体的にどういう動きをするか（ユーザー目線で）

新規キャラで名前を入力し「画像取り込み」を押すと、キャラ情報の保存が成功してから写真ライブラリが開きます。画像を選び、必要なら特徴を編集し、プレビュー生成から確定へ進めます。生成前の未保存変更も自動保存します。保存が失敗した場合には写真ライブラリを開かず、入力を保持します。

### 技術的に工夫した点（プログラマー向け）

- runtime実装は`aa6b7bd36f42262f257d2a3bda23dd580928f9db`を継承。
- ビルド元は`7188ebcf305fc3fd37aa724c570ee25e1211e855`。このリリース差分はAppleメタデータ、対応テスト、設計記録だけです。
- app/runtime `1.0.7`、production channel、本番API `https://app.lyra-editor.com`。Android package `com.lyra.mobile`、iOS bundle `jp.lyra.mobile`。
- [PR #209](https://github.com/sh0g0-ikeda/Lyra/pull/209)は[PR #208](https://github.com/sh0g0-ikeda/Lyra/pull/208)を基にした提出情報の差分です。
- AWS、本番API、Worker、DB、認証、課金、署名資格情報は変更していません。

## 検証

- Apple版数の不一致で期待したテスト失敗を確認後、メタデータ11件成功。
- iOS production export成功: 3,537 modules、17 assets。
- アプリ本体、依存関係、native設定に差分がないため、自動保存版のMobile全710件、型チェック、lint、契約・inventory・Web parity、Expo doctor 21件、Android exportの成功証跡を再利用。
- backend/Web/DBの差分なし。既存のbackend Vitest、Bun、DB migration/invariants、backend build、Web lint/build、Playwright smokeの成功証跡を再利用。今回の[リリースコミットのCI](https://github.com/sh0g0-ikeda/Lyra/actions/runs/34144101404)は`verify`、`mobile-verify`ともに成功。
- ビルド前の送信アーカイブ1,178ファイルを検査し、秘密ファイル候補0件、公開CA証明書の秘密鍵なし、一時Git設定に資格情報なしを確認。
- AAB: bundletool validate、最終Manifest、権限、runtime、production channel、署名継続性、ZIP CRC、64bit native library 48個の16KB ELF alignmentを検証し成功。1,436個の非META-INFエントリーすべての署名証明書が既存APK100と一致し、重複ZIP pathなし。
- AABのHermes JavaScript bundleは完成済みAPK100とSHA-256が完全一致 (`98515297d7a966b0bc3cfaa60a1896967d967e85b5c266845ab1b0eb2feadd18`)。
- AABに`READ_MEDIA_IMAGES`、`READ_MEDIA_VIDEO`、`READ_MEDIA_AUDIO`、`READ_MEDIA_VISUAL_USER_SELECTED`、`READ_EXTERNAL_STORAGE`、`ACCESS_MEDIA_LOCATION`、camera/microphone/overlayの権限なし。既存保存処理向け`WRITE_EXTERNAL_STORAGE`はmaxSdkVersion32。target SDK36、minimum SDK24、非debuggable。
- IPA: ZIP CRC、bundle/version/build、iPhone/iPad、minimum iOS16.4、device iOS向けarm64、日英locales、privacy tracking無効、runtime/production channel/本番API、署名関連ファイルを検証し成功。
- IPAのsigned entitlementsはapplication ID、team、`get-task-allow=false`、本番push通知、`applinks:app.lyra-editor.com`を確認。App Store用profileは端末UDID一覧なし、有効期限2027-08-03 UTC、証明書集合が旧1.0.4/36と一致。

### 残課題・注意点

実機が接続されていないため、iPhone/iPad/Androidの写真選択やアプリ内購入などの実機操作は未検証です。WindowsではAppleのnative codesign検証を実行できません。バイナリー検査とApple処理結果を区別して記録します。

主作業ツリーのcloud関連文書、DOCX作成スクリプト、承認済み削除状態、mockups、監査資料、Google Play素材を含む既存の未コミット変更を保持し、保護対象19項目の存在状態・ハッシュに変更がないことを確認しました。

## ストア画面で行う操作

### Google Play

1. 下記AABビルドページから`.aab`をダウンロードします。直接インストール用APKとは用途が異なります。
2. [Play Console](https://play.google.com/console/)でLyra Mobile (`com.lyra.mobile`)を開き、「ポリシーのステータス」でリジェクト対象を確認します。前回通知が指摘したversion codeは`92/95`です。「テストとリリース」で、その問題のある版を含む対象トラックの「新しいリリースを作成」を選びます。既存の修正可能な下書きを使う場合は「リリースを編集」を選びます。今回、各トラックの現在状態までは照会していないため、製品版を推測で指定していません。
3. 今回のAABを追加し、リリース名を`1.0.7`にします。下記の日英更新内容を入力します。
4. 提出に含まれる旧バンドルと、エラーが指摘する他トラックのバージョンコードを確認します。写真・動画の広範な読み取り権限を持つ旧版が引き続き提出対象に含まれている場合は、修正版への置換・除外が必要です。画像取り込み機能そのものは維持しており、選択した画像だけを扱います。
5. 「次へ」でエラーを確認し、保存します。「公開の概要」の「審査に送信」で申請します。管理対象の公開を有効にしている場合は、承認後に公開操作を行います。画面が直接「公開」を提示する場合は、その操作で配布が始まるので、対象トラックを確認します。

Google Playへのアップロード・審査申請・公開は、この作業では行いません。リリース作成と審査の流れは[Google公式手順](https://support.google.com/googleplay/android-developer/answer/9859348?hl=en)、権限の扱いは[写真と動画の権限ポリシー](https://support.google.com/googleplay/android-developer/answer/14115180?hl=en)に基づきます。

### App Store

作業開始時のライブ確認では、公開中は`1.0.2 (34)`、`1.0.4 (36)`が`IN_REVIEW`でした。今回のアップロードでその審査を取り消したり、差し替えたりしません。

1. [App Store Connect](https://appstoreconnect.apple.com/apps/6797564060)→Lyra Mobile→「TestFlight」で`1.0.7 (37)`の処理が完了していることを確認します。EASからのアップロードは完了済みです。Apple側の処理状態は再照会の401認証エラーで未確認のため、再アップロードせず、まず一覧とAppleからの処理通知を確認してください。
2. まず、審査中の1.0.4を継続するか、今回の修正を含む1.0.7を優先するかを判断します。1.0.4の審査を継続する場合は結果を待ち、次のバージョンを作成できる状態になってから「配信」で`1.0.7`を作成し、今回のビルドを選びます。1.0.4の公開は今回の必須作業ではありません。
3. 最新の修正版を優先して審査へ出す場合は、1.0.4の現在状態を再確認し、[Appleの取下げ手順](https://developer.apple.com/help/app-store-connect/manage-submissions-to-app-review/remove-a-submission-from-review)に従って審査を取り下げます。その後の画面状態に従って提出版数を`1.0.7`にし、今回のビルドを選びます。審査は最初からやり直しになります。既存審査を取り消す判断が必要なので、この操作は自動実行していません。
4. 日本語・英語の「このバージョンの最新情報」に下記を入力し、既存スクリーンショット、審査用アカウント、必須項目を確認します。「審査用に追加」→提出内容を確認→「審査へ提出」で申請します。
5. 手動公開設定の場合、承認後に公開操作を行います。

EAS SubmitのアップロードとApp Review申請は別の操作です。[ExpoのiOS提出手順](https://docs.expo.dev/submit/ios/)と[Appleの審査提出手順](https://developer.apple.com/help/app-store-connect/manage-submissions-to-app-review/submit-an-app)を参照してください。

## 貼り付け用の更新内容

日本語（App Store向け）:

```text
画像取り込みを押すと、キャラ情報を自動保存してから写真ライブラリを開くようになりました。キャラ情報の保存、取り込んだ画像のプレビュー生成と確定の流れを改善しました。日本語と英語に対応しています。
```

英語（App Store向け）:

```text
Character details are now automatically saved before the photo library opens when importing an image. Improved character saving and the preview generation and confirmation flow for imported images, in Japanese and English.
```

Google Play向け:

```text
<ja-JP>
画像取り込みの前にキャラ情報を自動保存するようになりました。キャラの保存、プレビュー生成と確定の流れを改善しました。画像取り込みを維持したまま、写真へのアクセス権限を見直しました。
</ja-JP>
<en-US>
Character details are now saved automatically before importing an image. Improved character saving, preview generation, and confirmation. Updated photo access permissions while keeping image import available.
</en-US>
```

## 成果物と提出状態

| 成果物 | バージョン・番号 | ビルドページ |
| --- | --- | --- |
| Google Play用AAB | 1.0.7 / 101 | https://expo.dev/accounts/sh0g0/projects/lyra-mobile/builds/0223a23c-c52a-4f43-9d97-eb7d42679bd0 |
| iOS | 1.0.7 / 37 | https://expo.dev/accounts/sh0g0/projects/lyra-mobile/builds/b2875c88-d7c9-40bd-94fa-c6b00fece3c1 |
| 実機インストール用APK（既存完成品） | 1.0.7 / 100 | https://expo.dev/accounts/sh0g0/projects/lyra-mobile/builds/9827a1d7-9176-48df-a3bb-447722bb6404 |

AABは2026-09-08 01:54:43 JSTに`FINISHED`、iOSは同日01:45:16 JSTに`FINISHED`。両方の`gitCommitHash`は`7188ebcf305fc3fd37aa724c570ee25e1211e855`。

AAB: 72,583,753 bytes、SHA-256 `807982f02f8359ad33dd59d5606f1e6b51c49451aaec031a55efdada947daf24`。

IPA: 23,451,302 bytes、SHA-256 `63455e938fdb912a4882bed7f91005809e7d06a6a6ed3c909d1db354a3ce48c0`。

Android upload certificate SHA-256: `dddf947c55aebb158251379205d8774729dfbdc0979008eb93476696b878200b`。

指定iOS build IDをEAS Submitへ投入し、2026-09-08 01:50:16 JSTに提出レコード`beece1d9-f4e7-4803-a9e2-ac1a52d223cf`の`FINISHED`、errorなしを確認しました。

iOSアップロード結果: https://expo.dev/accounts/sh0g0/projects/lyra-mobile/submissions/beece1d9-f4e7-4803-a9e2-ac1a52d223cf

これはApp Store Connectへのアップロード完了であり、Apple側のprocessing `VALID`・1.0.7のApp Review申請・承認・一般公開を確認した結果ではありません。開始時のASC照会では1.0.2/34が公開中、1.0.4/36が`IN_REVIEW`でした。提出後の2回のASC再照会は401認証エラー、ブラウザーも既存ログインが未成立で、最終processing状態は確認できていません。既存キーの再発行・再割当、審査取消し、1.0.7の審査申請、公開は行っていません。

証跡とローカル成果物はignoredの`C:/Users/shogo/Lyra/.tmp/mobile-1.0.7-store-evidence/`に保存し、Gitには含めていません。
