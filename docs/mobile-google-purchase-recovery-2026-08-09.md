# Android Google Play 購入検証・復旧設計（2026-08-09）

## 目的と範囲

Google Play の決済完了後に Lyra が購入を検証できず、消費型クレジットが反映されない不具合を修正する。
対象は Google Play Developer API の単品購入判定、Google Pub/Sub push wrapper の受理、期限付きテスト購入許可リスト、および既購入の復元経路である。

Stripe、Apple 課金、商品価格、クレジット原価、DB schema、Web の課金導線は変更しない。購入トークンをログへ出力したり、端末の申告だけでクレジットを付与したりしない。

## Spec 根拠

- `docs/Lyra_Unified_Spec_v4.md` 4: 保護 API の認証とリソース認可
- 同 5: personal ownership と transaction 境界
- 同 7: 課金結果を権威ある provider 検証後に反映し、ledger とともに transaction 更新する
- 同 8: bounded Zod schema と安全なエラー出力

## 確認済みの原因

1. 実機の Google 購入検証は 2026-08-09 13:32:57 JST に 422 で失敗した。
2. 購入時の Lyra ユーザーは、本番の期限付き Google License Tester 許可リストと一致していなかった。
3. `purchases.productsv2` の現行状態値は `PURCHASED` / `PENDING` / `CANCELLED` だが、実装は別名だけを判定していた。
4. 単品購入トークンを subscriptions API で照会した際、404以外の「この種類ではない」応答では products API に進めない。
5. Pub/Sub は camelCase と snake_case の message ID / publish time を併記するが、webhook の strict schema が正式な wrapper を拒否していた。

## 影響レイヤーとインターフェース

- Infrastructure: `GooglePlayDeveloperClient` が subscription と one-time product を区別し、現行 Google API 状態を正規化する。
- Route: Google RTDN webhook が認証済み Pub/Sub wrapper の既知フィールドと alias を bounded schema で受ける。
- Service / Repository: 既存の account binding、product catalog、row lock、idempotent event、credit ledger 契約をそのまま使用する。
- Mobile: 変更しない。未消費の消費型購入を `getAvailablePurchases()` から取得し、既存の「購入を復元」で同じ token を再検証する。
- Ops: 実際に購入した Lyra ユーザーを既存の期限付き allowlist に追加し、API task を再起動して反映する。

## セキュリティ

- Google API の 401 / 403 / 429 / 5xx は別商品種別への fallback 対象にせず、権限・障害を隠さない。
- fallback は Google が購入種別不一致として返し得る 400 / 404 に限定する。
- Pub/Sub OIDC 検証を body parse より先に維持する。
- alias が両方ある場合は値の一致を要求し、request body の既存 size limit を維持する。
- 購入 token、service account credential、JWT、ユーザー UUID をログ・テスト・PRへ記録しない。
- クレジット付与は既存 transaction / ledger / event idempotency を通し、復元の再試行で二重付与しない。

## テスト方針

実装前に次の失敗テストを追加して赤を確認する。

1. subscription 照会が 400 の単品 token は one-time API へ進む。
2. subscription 照会の 403 は one-time API へ進まず拒否する。
3. `PURCHASED` / `PENDING` / `CANCELLED` を正しい内部状態へ変換する。
4. Pub/Sub の camelCase / snake_case 併記 wrapper と `deliveryAttempt` を受理する。
5. alias が不一致の wrapper は拒否する。

対象テスト後、backend 全テスト、build、mobile 課金テスト、契約監査、production invariant と本番 readiness を確認する。

## Terra 委譲

Terra には Mobile → Route → Service → Infrastructure → Repository の read-only 経路監査だけを委譲した。実装、秘密情報、本番操作、統合判断は Sol が担当する。

## 復旧条件

本番反映後、端末の「購入を復元」が未消費購入を返せば、同じ token をサーバー検証し、クレジットを一度だけ付与してから Google Play 側で消費完了する。RTDN の再送も同じ idempotency 契約を通す。
