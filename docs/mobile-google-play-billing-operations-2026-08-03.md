# Mobile Google Play Billing 運用記録

記録日: 2026-08-03

## 目的と対象範囲

Android の Google Play 課金、リアルタイム デベロッパー通知（RTDN）、
クローズドテストの設定状態を、次回の Apple 設定と本番課金有効化に引き継ぐ
ための運用記録として残す。

この文書は識別子・公開 URL・設定名だけを扱う。秘密鍵、サービスアカウント
JSON、購入トークン、JWT、AWS Secrets Manager の値は記録しない。

## Spec 根拠と影響範囲

- `docs/Lyra_Unified_Spec_v4.md` §7: 課金のトランザクション整合性と
  Webhook 検証。
- `docs/mobile-store-billing-server-design.md`: Google の製品 allowlist、
  Pub/Sub OIDC 検証、production の明示的な有効化条件。

今回の作業は Store/Google Cloud/AWS の運用設定であり、DB schema、API
contract、モバイル UI、既存の Stripe 課金経路は変更していない。

## Google Play Console

### アプリとテストトラック

| 項目 | 値 |
| --- | --- |
| Android package name | `com.lyra.mobile` |
| クローズドテスト | `Alpha` |
| テスト版 | version code `56` / version name `0.1.18` |
| 配布国・地域 | 42 国・地域 |
| ライセンステストと Alpha テスターに追加したアカウント | `lyra.japan.official@gmail.com` |

テスター用の参加リンクは、Google が Alpha の提出済みリリースを配布可能に
反映した後に `Alpha` の `テスター数` タブへ表示される。リンクが灰色の間は
リリースを作り直さず、Play Console の審査・反映状態を待つ。

### Google Play 製品カタログ

| 種別 | 表示名 | Product ID | 基本プラン ID | 日本価格 |
| --- | --- | --- | --- | --- |
| 消耗型 | Lyra クレジット 10 | `jp.lyra.credits.200` | - | 220 JPY |
| 消耗型 | Lyra クレジット 50 | `jp.lyra.credits.1000` | - | 1,100 JPY |
| 消耗型 | Lyra クレジット 150 | `jp.lyra.credits.3000` | - | 3,300 JPY |
| 定期購入 | スタンダードプラン | `jp.lyra.standard.monthly` | `monthly` | 1,000 JPY/月 |
| 定期購入 | プレミアムプラン | `jp.lyra.premium.monthly` | `monthly` | 3,500 JPY/月 |

- スタンダードは毎月 50 クレジット、プレミアムは毎月 175 クレジットを付与する設定。
- 定期購入は月次・自動更新。税カテゴリはデジタルアプリの販売。
- Google Play Billing 以外の代替課金、外部コンテンツ購入リンク、外部支払い
  プログラムは有効化しない。

### RTDN

| 項目 | 値 |
| --- | --- |
| Cloud project ID | `lyra-play-billing-prod` |
| Cloud project number | `153125107230` |
| Pub/Sub topic | `projects/lyra-play-billing-prod/topics/lyra-google-play-rtdn` |
| Pub/Sub subscription | `lyra-google-play-rtdn-push` |
| Push endpoint | `https://app.lyra-editor.com/api/webhooks/mobile-purchases/google` |
| OIDC audience | `https://app.lyra-editor.com/api/webhooks/mobile-purchases/google` |
| Pub/Sub push service account | `lyra-play-rtdn-push@lyra-play-billing-prod.iam.gserviceaccount.com` |
| Google Play Publisher principal | `google-play-developer-notifications@system.gserviceaccount.com` |
| Pub/Sub service agent | `service-153125107230@gcp-sa-pubsub.iam.gserviceaccount.com` |

- Cloud Pub/Sub API と Google Play Android Developer API を有効化済み。
- Google Play Publisher principal には topic の `Pub/Sub Publisher` を付与済み。
- Pub/Sub service agent には push OIDC token 用の `Service Account Token Creator`
  を付与済み。
- Push subscription は message unwrapping を無効のままにする。API は標準の
  Pub/Sub envelope と OIDC JWT を検証する。
- RTDN の通知内容は「定期購入、取り消し済みの購入、すべての 1 回限りの
  アイテム」を選択済み。

### 購入照合用サービスアカウント

| 項目 | 値 |
| --- | --- |
| サービスアカウント | `lyra-play-billing-prod@lyra-play-billing-prod.iam.gserviceaccount.com` |
| 用途 | Google Play Developer API による Android 購入照合 |
| Play Console 権限 | アプリ情報の閲覧（読み取り専用）、売上データの表示 |

サービスアカウント鍵は production の AWS Secrets Manager のみで保持する。
鍵ファイルをこのリポジトリ、Cloud project、Play Console、チケット、チャットに
保存しない。

## Production の安全な現状態

| 項目 | 状態 |
| --- | --- |
| AWS account | `452284481392` |
| AWS region | `ap-northeast-1` |
| API service | `lyra-prod-api` |
| Runtime secret ID | `lyra/prod/app` |
| API health | `https://app.lyra-editor.com/healthz` が 200 を確認 |
| `MOBILE_STORE_BILLING_ENABLED` | `false` のまま |

Google 側の設定だけでは API の課金 Webhook と購入照合を有効化しない。現在は
課金フラグを false のままにしているため、誤った付与や未設定の Apple 検証経路を
公開しない。

AWS secret には値ではなく、次の設定キーを保持する。

```text
GOOGLE_PLAY_PACKAGE_NAME
GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64
GOOGLE_PLAY_PUBSUB_AUDIENCE
GOOGLE_PLAY_PUBSUB_SERVICE_ACCOUNT_EMAIL
GOOGLE_PLAY_PRODUCT_STANDARD_MONTHLY
GOOGLE_PLAY_PRODUCT_PREMIUM_MONTHLY
GOOGLE_PLAY_PRODUCT_CREDITS_200
GOOGLE_PLAY_PRODUCT_CREDITS_1000
GOOGLE_PLAY_PRODUCT_CREDITS_3000
```

## iOS 配布識別子

| 項目 | 値 |
| --- | --- |
| Apple Developer Team ID | `8DX32AC6XQ` |
| iOS bundle ID | `jp.lyra.mobile` |
| App Store Connect アプリ | `Lyra - AI漫画制作` を作成済み |

`com.lyra.mobile` は Apple の他チームで既に使用されており、この Team では
登録できなかった。iOS の bundle ID は Android package name と一致させる必要は
ないため、Apple Developer で登録済みの `jp.lyra.mobile` を iOS のみで使用する。
Android の `com.lyra.mobile`、API contract、DB schema は変更しない。

## iOS EAS build safeguard (2026-08-04)

### 設計メモ

- 目的: iOS production build の Sentry source-map upload が組織未設定で失敗する問題を止める。
- 範囲: `apps/mobile/eas.json` の production build 環境変数のみ。
- Spec 根拠: `docs/Lyra_Unified_Spec_v4.md` §8（外部プロバイダーの安全な失敗）および §10（リリース検証）。
- 影響: Mobile/EAS build config のみ。API、永続化、認証、課金、アプリ UI は変更しない。
- セキュリティ: Sentry の送信を有効化する設定を追加せず、ビルド時の source-map 自動送信だけを明示的に無効化する。秘密情報は追加しない。
- テスト例外: EAS の環境変数配線は単体テスト化しない。`expo config`、typecheck、lint、EAS iOS build 成否で検証する。
- Terra 委譲: なし。外部ビルド再実行の直前を塞ぐ単一設定変更であり、委譲による遅延が大きい。

### App Store Connect submission target

- `apps/mobile/eas.json` の iOS production submit profile には、App Store Connect の Lyra アプリID `6797564060` を `ascAppId` として固定する。
- これにより EAS Submit は、対話入力なしでも正しい TestFlight 提出先を選べる。秘密情報や課金設定は追加しない。

## 本番課金を有効化する前の必須事項

現在のサーバー実装は Apple と Google の両方が完全に設定済みの場合だけ
`MOBILE_STORE_BILLING_ENABLED=true` を許可する。Google だけを先に有効化しては
ならない。

1. App Store Connect で iOS アプリ、5 製品、App Store Server Notifications V2 を設定する。
2. Apple の bundle ID、numeric app Apple ID、Apple root certificates、5 製品 ID を
   production secret へ追加する。
3. `MOBILE_STORE_IDENTIFIER_HASH_SECRET` を secret manager で新規発行する。
4. production では App Review と TestFlight の正規 Apple Sandbox transaction を
   検証できるよう `APPLE_STORE_ALLOW_SANDBOX=true`、Google の license-tester
   transaction を受け入れないよう `GOOGLE_PLAY_ALLOW_TEST_PURCHASES=false` を確認する。
5. 上記全値を非表示のまま runtime config validation で検証する。
6. API task definition の `MOBILE_STORE_BILLING_ENABLED` を `true` に変更し、
   API を再デプロイする。
7. `/healthz`、API 起動ログ、Google Pub/Sub test delivery、Apple sandbox、
   Android license tester による各商品の購入・復元・取消しを確認する。

## 今回の検証記録

- AWS の API service を更新後、desired/running task が `1/1`、deployment が
  `COMPLETED` であることを確認した。
- `https://app.lyra-editor.com/healthz` は HTTP 200 を返した。
- Pub/Sub topic、push subscription、OIDC audience、Publisher 権限、push identity
  の設定を確認した。
- 課金フラグは明示的に無効のままにしている。Google Play のテスター参加と
  製品一覧は確認できるが、実購入の確認は上記の Apple 設定および最終有効化後に行う。

## 設計・検証メモ

- 目的: 次回担当者がサービスアカウント、topic、product ID、通知先、iOS bundle
  ID を取り違えずに Apple 設定と最終有効化を進められるようにする。
- 非対象: アプリコード、DB、既存 API 入出力、クレジット台帳の変更。
- セキュリティ: 識別子・公開 URL のみを記録し、シークレット実値は記録しない。
- テスト: iOS bundle ID の宣言設定変更は、Expo config の実効値を確認する。
- 委譲: 単一設定の変更であり、委譲コストが大きいため Sol 単独で確認する。
