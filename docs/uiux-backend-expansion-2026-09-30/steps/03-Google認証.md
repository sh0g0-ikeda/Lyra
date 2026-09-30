# 工程03 — Google/Cognito認証の安全な追加

## 読むもの

[Google認証](../design/02-Google認証.md)、共通契約、Spec §4/5/7/8/10。Google/AWS/Apple一次資料は設計内のリンクから当該箇所を確認。

## Codexへの指示

1. `src/services/auth/UserProvisioningService.ts`, `src/repositories/UserRepository.ts`, `src/middleware/auth.ts` を調査し、subject未一致・email一致の危険な付替えケースを失敗テストとして追加する。既存移行の依存も確認。
2. native/Google双方の本人確認に基づくlink flow、challengeの一回性/期限/tenant/session束縛、衝突errorを実装する。existing user ID/bonus/ledgerを保つ。必要なら小さいchallenge migrationを追加。
3. Google IdP設定・callback・scope・属性mapping・app client変更、衝突をprofile作成前に拒否するPre sign-up triggerを検証環境のrunbookへまとめる。通常ログインと連携専用OAuth client/callbackを分離。秘密値は環境管理から読み、文書には名前だけ記載。設定権限がなければコード/テストは継続し、外部設定だけ未実施にする。
4. 既存PKCEとJWT検証を使い、provider指定を接続する最小の内部検証導線を準備する。一般利用者向けの画面再編は工程08。
5. 既存ログインとGoogleで同じuser ID・作品・残高・orgへ到達することをstagingで検証。iOS 4.8の対応判断を記録する。Apple追加や独自ドメイン導入を黙って同時実装しない。

## 所有・禁止範囲

auth Service/Repository/middlewareの関連箇所、新link route/challenge保存、認証設定の例・検証testsのみ。Mobileは既存auth helperの最小接続まで。User table丸ごと移行、Cognito廃止、同メール行の自動統合、購入移動、ユーザー削除、外部IdPの本番ONはこの工程の通常コード変更に含めない。

## 検証・完了条件

`tests/unit/services/auth/UserProvisioningService.test.ts` を起点に、link/nonce/所有/期限/再送/同時signup/bonus/旧移行/callback cancelを検証。API authテスト、backend build、関連クライアント契約も確認。

mock成功とGoogle実ログイン成功は別記録。既存nativeが使える、同メール未連携は安全に案内される、連携済みは内部userが同じ、秘密/個人情報が漏れないことが完了条件。外部権限/Apple判断待ちは機能公開ゲートとして残す。

次: [工程04](04-状態変化.md) はGoogle外部設定待ちでも進行可能。
