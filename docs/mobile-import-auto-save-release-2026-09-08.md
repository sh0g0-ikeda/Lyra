# 画像取り込み前の自動保存 — 作業報告

## 何を作ったか（一言で）

「画像取り込み」を押すと、先にキャラ情報を保存してからアルバムを開くAPK **1.0.7 / 100** を作成しました。

https://expo.dev/accounts/sh0g0/projects/lyra-mobile/builds/9827a1d7-9176-48df-a3bb-447722bb6404

## なぜそれを作ったか

1.0.6ではキャラと画像を確実に紐付けるため、最初に「作成」を押す必要がありました。しかし、名前を入力した後にそのまま画像取り込みへ進む操作が自然なため、その順序を自動処理にしました。

## 具体的にどういう動きをするか（ユーザー目線で）

新規キャラ → 名前入力 → 画像取り込み（キャラを自動保存 → アルバムが開く）→ 画像選択 → 必要に応じて特徴を編集・保存 → プレビュー生成 → 画像を確認して確定、の順で進めます。生成前にも変更したキャラ情報を自動保存するため、取り込み後の手動保存は任意です。

- 新規は一度だけ作成し、既存キャラは変更がある場合だけ更新します。
- 名前が空の場合や保存に失敗した場合、アルバムとアップロードは開始しません。
- アルバムをキャンセルしても保存したキャラは残ります。再度取り込みを押すと同じキャラを使います。
- 保存中に追加入力した内容を保持します。別キャラや別作品へ移動した後に、古い取り込み結果を移動先へ適用しません。
- 日英の案内とガイドを更新し、画像取り込み・写真権限の従来機能を維持しています。

## 技術的に工夫した点（プログラマー向け）

保存APIの返却entityを画像取り込みの固定IDとして使い、Reactで選択キャラが再描画される時刻に依存しません。新規保存から選択反映までの一時情報を、セッション・組織・作品・編集世代で限定しました。新規から保存済みへ移る予定された遷移だけ、入力や画像候補のリセットを抑止します。

通常保存・生成前保存・取り込み前保存を共有し、同期ロックで連打や競合する操作を抑止します。保存後のキャッシュは元のscopeにだけ同期し、画面が切り替わった場合は選択変更やアルバム起動を中断します。API130、AWS設定、DB、認可、クレジット、候補トークン、画像のMIME/サイズ制限には変更ありません。

## 検証と成果物

- ソースコミット: `aa6b7bd36f42262f257d2a3bda23dd580928f9db`。
- EAS `production-apk` / Androidビルドは2026-09-08 00:16:48 JSTにFINISHED。
- [PR #208](https://github.com/sh0g0-ikeda/Lyra/pull/208)。APK99の変更を含む `0799f47` から分岐。
- TDD: 自動保存のPOST/PUTが未実行になる失敗、保存失敗時やキャンセル再試行・連打の失敗を確認してから実装。
- 実際のCharactersScreenで21件成功。新規保存、失敗時の抑止、キャンセル再試行、連打、Create/Import競合、遅延選択反映、追加入力、候補保持、scope切替を確認。
- Mobile全体136ファイル710件、型検査、lint成功。日英ガイド更新後の追加検査は3ファイル10件成功。
- API契約、API inventory（Mobile112 methods / backend124 routes）、Web parity、文字化け検査成功。
- Expo依存検査とdoctor 21/21成功。`expo-sharing` は既存の明示的な依存検査除外を維持。
- 本番設定のAndroid export成功（3,534 modules、18 assets）。
- GitHubのソースコミットに対する `mobile-verify` と `verify` は両方成功。CI: https://github.com/sh0g0-ikeda/Lyra/actions/runs/34135574887
- backend/Web/DB/ルートpackage/CI workflowは0799f47から差分なし。直前リリースのbackend Vitest、Bun、backend build、DB migration/invariants/integration、Web lint/build、Playwright成功記録を継承し、GitHub backend verifyでも検査済み。
- Solが設計・最終実装レビュー、Terraが実画面テストと独立したリリースゲートを実施。

EAS送信前に、宛先が既存の `@sh0g0/lyra-mobile` であることと、公開済みソースコミットとの対応を確認しました。送信アーカイブの秘密設定・秘密鍵・認証情報・ローカル生成データ・ビルド成果物を検査し、検出候補はありません。公開CA証明書と追跡済みの公開ストア画像は公開ファイルとして確認しています。

完成APK（108,232,220 bytes）の検査結果:

- SHA-256: `8b9898f2e97ee257394853641e833d415871e8df0d9db9a386d7809b69dcc0bd`。
- package `com.lyra.mobile`、versionName `1.0.7`、versionCode `100`、minSdk 24、targetSdk 36、Expo runtime `1.0.7`、production channelを確認。
- `apksigner verify` 成功。署名証明書はAPK99と同じ `dddf947c55aebb158251379205d8774729dfbdc0979008eb93476696b878200b`。
- READ_MEDIA_IMAGES / VIDEO / AUDIO / VISUAL_USER_SELECTED、READ_EXTERNAL_STORAGE、ACCESS_MEDIA_LOCATION、CAMERA、RECORD_AUDIO、SYSTEM_ALERT_WINDOWの宣言なし。WRITE_EXTERNAL_STORAGEのmaxSdkVersion 32を維持。
- 全ZIPエントリのCRCと `zipalign -c -P 16 -v 4` 成功。
- 64bitネイティブライブラリ48本の全PT_LOADで16KB以上のalignmentとoffset/vaddrの16KB整合を確認。32bit48本のalignmentはAPK99と同一。

## 残課題・注意点

Android実機でのアルバム操作からプレビュー生成までの通し確認は未実施です。外部生成サービス由来のエラー全般の解消を主張するものではありません。

主作業ツリーにある既存の未コミット変更を保持し、保護対象19項目の存在状態とハッシュが同一であることを確認しました。専用ブランチで実装・コミット・push・PR作成を行いました。本タスクではAWSへの変更や、新たなPlay Console / App Store提出は行っていません。
