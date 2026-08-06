# Apple Sandbox 審査購入の有効化設計

日付: 2026-08-06

## 目的と範囲

App Store Connect に登録した Lyra の5商品を、TestFlight と App Review の
Apple Sandbox 購入で実際に検証可能にする。production API が Apple の署名済み
Sandbox transaction と Server Notifications V2 を検証できるようにする一方、
Google Play のテスト購入は production で引き続き拒否する。

対象は mobile store billing の runtime configuration、対応テスト、運用手順である。
Mobile UI、Stripe の Web 課金、DB schema、クレジット計算、商品ID、認可契約は
変更しない。

## Spec 根拠

- `docs/Lyra_Unified_Spec_v4.md` §3: Infrastructure に外部ストア検証を閉じ込める。
- `docs/Lyra_Unified_Spec_v4.md` §4: 購入照合は認証済み個人アカウントに限定する。
- `docs/Lyra_Unified_Spec_v4.md` §7: クレジット付与はサーバー権威、transaction と
  ledger による idempotency を維持する。
- `docs/Lyra_Unified_Spec_v4.md` §8: 署名・入力検証失敗を安全なエラーにする。
- `docs/Lyra_Unified_Spec_v4.md` §10: 実ストア購入・復元・通知をリリースゲートにする。

## 影響レイヤーとインターフェース

- Infrastructure: `MobileStoreBillingConfig` が production で
  `APPLE_STORE_ALLOW_SANDBOX=true` を受け入れる。
- Service: 既存の `MobileStorePurchaseService` は Apple の署名検証済み transaction、
  configured product allowlist、`appAccountToken` と認証済みユーザーの一致を引き続き
  必須にする。変更しない。
- Ops: production secret に Apple の値を安全に設定し、Apple Sandbox を明示的に有効化する。

`MOBILE_STORE_BILLING_ENABLED=true` のときだけ変更後の設定が有効になる。Google の
`GOOGLE_PLAY_ALLOW_TEST_PURCHASES=true` は production で引き続き設定エラーとする。

## セキュリティ判断

Apple Sandbox を許可しても、クライアントの product ID、価格、クレジット量、購入状態を
信用しない。Apple JWS の証明書・bundle ID・sandbox environment の検証、サーバー商品
allowlist、個人アカウント binding、purchase/event/ledger の一意制約が付与の前提である。

Sandbox transaction は TestFlight と App Review で必要な正規の Apple 環境である。
Google の license-tester purchase は別の provider policy として production で拒否を
維持する。設定値・証明書・サービスアカウント・JWS・購入トークンをコード、文書、ログに
記録しない。

## TDD と検証

最初に production で Apple Sandbox のみが有効な設定を受け入れ、Google tester purchase
を拒否し続けるテストへ変更する。そのテストが既存実装で失敗することを確認してから、
runtime guard を最小修正する。

実装後は対象 Vitest、`npm test`、`npm run build`、mobile contract/inventory/parity check、
`npm run db:check-invariants`、Web lint/build を実行する。production では secret 値を
表示せずに設定キーの存在、API readiness、Apple Sandbox の購入・復元・通知を確認する。

## Git baseline

作業開始時点の branch は `fix/mobile-export-reliability` で、ユーザー起因の
`docs/cloud-cost-cuts-2-3-7-2026-06-22.md`、
`docs/cloud-current-state-2026-06-21.md`、
`scripts/createDockerLearningDocx.py`、root `app.json`、`store-assets/` がすでに
dirty だった。安全のため branch の切替・pull・reset は行わず、この設計と
mobile-store billing 関連の差分だけを個別に commit する。

## Terra 委譲

なし。production 課金設定の受入条件は、設計・セキュリティ判断・実装が同一の小さな
変更範囲で密結合しているため、Sol が単独で変更と最終レビューを行う。
