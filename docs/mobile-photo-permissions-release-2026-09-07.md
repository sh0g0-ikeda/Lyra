# Android 1.0.5 写真権限修正 リリース記録

## 変更内容と目的

Google Playの2026-09-07の通知は、version code 92/95について写真・動画の広範な読み取り権限を指摘した。前回AAB 95の実際のManifestにはREAD_MEDIA_IMAGES、READ_MEDIA_VISUAL_USER_SELECTED、READ_EXTERNAL_STORAGEが含まれていた。

- 写真・動画・音声・選択済みメディア・旧ストレージの読み取りとメディア位置情報の6権限を除外。
- 画像取り込みは既存のシステム選択画面を維持。ユーザーが選択した画像へのアクセス許可を使って、従来どおりアップロードできる。`CharactersScreen.tsx`とアップロードAPIのコードは変更していない。
- Android API 30以降は読み取り許可を求めず、検証した画像をMediaStoreへ保存。API 24〜29では保存に必要な書き込み専用許可を取得。
- iOSの画像追加専用許可と保存処理を維持。新しい日英メッセージは追加せず、既存のエラー表示を利用。
- 旧ネイティブ権限用OTAコードの混入を防ぐため、appVersion/runtimeを1.0.5に更新。

設計: [mobile-photo-permissions-design-2026-09-07.md](./mobile-photo-permissions-design-2026-09-07.md)

API、バックエンド、DB、AWS本番、課金、認証の変更・デプロイは行っていない。既存EAS production設定の本番API接続先と署名資格情報を利用する。今回の対象はAndroidビルドであり、Appleの提出情報は1.0.4を維持している。

## ソースとレビュー

コードcommit: `300a392205481e67d68fe0458581ff5910ea0c25`

[PR #205](https://github.com/sh0g0-ikeda/Lyra/pull/205)。直前のUI改善を保持するため、PR #204のブランチ`feature/mobile-panel-settings-dialogs`をベースにした。

主作業フォルダーの既存削除・文書修正・画像素材を保護し、`00dbabf`から専用worktreeで作業。今回のコミットへそれらを含めていない。Solが設計と実装をレビューし、Terraが固定されたExpo 57ネイティブ実装を調査。レビューで重大な指摘なし。

## 検証

- TDD: 変更前8件の期待した失敗 → 関連49件成功。
- Mobile: 134ファイル681件成功、型チェック・lint・文字化け検査成功。
- Mobile API契約、112メソッド/124ルートinventory、Web parity成功。
- Expo依存関係検査、doctor 21/21成功。
- 本番設定でAndroid/iOS export成功（各7.1 MBのHermes bundle）。
- バックエンド: 236ファイル1,636件成功。通常実行時のDB依存4件は専用ローカルDBへ接続して追加実行し、全件成功。
- Bun: 3ファイル26件成功。
- 専用ローカルPostgreSQLへmigration適用、50項目のinvariant成功。
- Backend build、Web lint/build、Playwright smoke 21件成功。
- コードcommitに対するGitHub CIはmobile-verify、verifyともに成功。
- 完成したAAB/APKのManifest・署名・runtime検査は下記のとおり成功。

実機・エミュレーターでのAndroid API 24〜36の操作、iPhone/iPadの写真保存操作は未実施。APIレベルごとのユニットテスト、Expoネイティブソースの確認、配布ファイルの検査は、端末操作そのものの検証とは区別する。

## ビルド

| 成果物 | バージョン | 番号 | EASビルドページ |
| --- | --- | --- | --- |
| Google Play用AAB | 1.0.5 | 97 | [AAB](https://expo.dev/accounts/sh0g0/projects/lyra-mobile/builds/7bce9156-3995-45f3-bdb9-056ec7ba0c04) |
| 直接インストール用APK | 1.0.5 | 98 | [APK](https://expo.dev/accounts/sh0g0/projects/lyra-mobile/builds/98a346d7-434e-4968-a8f1-d9e1e7265c1b) |

両ビルドは上記コードcommitから作成され、`FINISHED`を確認した。AABの完了日時は2026-09-07 06:35:42 UTC、APKは06:35:41 UTC。

| 成果物 | SHA-256 |
| --- | --- |
| AAB 97 | `41d901cd5ed05b4aae303c0bf686f010b61e469d92f3cf62ff07d789e72fde1c` |
| APK 98 | `882a954bdad4de66f2a441985deb2e3cbd1b035291f125b5dbf739ea7c10a226` |

実ファイルの検査結果:

- AABをbundletool、APKをaapt2で解析し、両方ともpackage `com.lyra.mobile`、version `1.0.5`、minimum SDK24、target SDK36を確認。
- READ_MEDIA_IMAGES、READ_MEDIA_VIDEO、READ_MEDIA_AUDIO、READ_MEDIA_VISUAL_USER_SELECTED、READ_EXTERNAL_STORAGE、ACCESS_MEDIA_LOCATIONは両方の最終Manifestに存在しない。既存のCAMERA、RECORD_AUDIO、SYSTEM_ALERT_WINDOW除外も維持。
- メディア保存用に残るWRITE_EXTERNAL_STORAGEはmaxSdkVersion=32。実際に書き込み許可を要求する分岐はAPI 24〜29のみ。AABの全モジュールはbaseだけで、追加モジュールからの権限追加もない。
- AABのbundletool validate成功。全1,436個の非META-INFエントリーの署名が既存アップロード証明書に一致し、重複ZIP pathなし。
- APKのapksigner検査成功（v2署名）。AAB/APK共通の証明書SHA-256は`dddf947c55aebb158251379205d8774729dfbdc0979008eb93476696b878200b`で、1.0.4と一致。
- APKのzipalign 16KB検査成功。両形式それぞれ48個の64bit native libraryのELF LOAD alignmentが16KB以上。
- 両形式の実際のnative resourceでruntime `1.0.5`を確認。本番API URLをHermes bundle内で確認し、AABのproduction更新channelと非debuggableを確認。
- 検査手順の確認として旧AAB/APKを検査し、以前のREAD_MEDIA_IMAGESなど3権限を期待どおり検出した。

ローカル成果物と詳細検査ログは、主作業フォルダーのignoredディレクトリ`.tmp/mobile-photo-permissions-evidence/`に保存。主作業フォルダーの既存変更19エントリーは存在状態・SHA-256・Git statusが作業前と一致する。一時検証用PostgreSQLコンテナーは停止・削除済み。

## Google Play再提出で必要な操作

この作業ではPlay Consoleのアップロード・トラック変更・審査提出は行わない。

完成したAABを利用し、製品版と各テストトラックを確認する。通知で指摘された92/95など、問題のある権限を含む版を修正版へ差し替え、必要に応じて旧リリースを無効化する。そのうえで「公開の概要」から再審査へ送信する。アップロード履歴自体の消去と、トラックでの有効な配布版の置き換えは別の操作である。

申告は修正版の実際の権限に合わせる。Android 11以降は画像保存前のライブラリ許可がなくなり、旧Androidでは書き込み許可のみを利用する。利用者による画像選択と漫画画像の保存機能は維持する。

```text
<ja-JP>
画像の取り込み・保存に必要な権限を見直しました。Android 11以降では写真ライブラリへの読み取り許可なしで漫画画像を保存できます。
</ja-JP>
<en-US>
Updated permissions for image import and saving. On Android 11 and later, manga images can be saved without photo library read access.
</en-US>
```

根拠: [Google Playの権限ポリシー](https://support.google.com/googleplay/android-developer/answer/16935362?hl=ja)、[Expo 57 MediaLibrary](https://docs.expo.dev/versions/v57.0.0/sdk/media-library/)。
