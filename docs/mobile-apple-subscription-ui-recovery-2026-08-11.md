# Apple サブスクリプション反映 UI 修正設計（2026-08-11）

## 目的と範囲

- Apple の購入・サーバー検証・権利付与が成功した後、現在契約中のサブスクリプションを再び「購入する」と表示しない。
- 現在契約中のプランは「登録済み」と表示して再購入を無効化し、別のサブスクリプションだけをプラン変更候補として残す。
- 単発クレジット購入は従来どおり購入可能とし、サーバーの transaction/event idempotency を変更しない。
- 商品 ID、価格、Apple 検証、クレジット付与、DB schema は変更しない。

## Spec 根拠

`docs/Lyra_Unified_Spec_v4.md` の `7. Credits and billing` に従う。ストア取引をサーバーで検証した結果だけを権利とクレジットへ反映し、クライアント表示はその authoritative state に追従させる。

## 確認済みの本番事実

- 直近の Apple verify API は HTTP 200 で完了している。
- 個人を特定しない読み取り専用診断で、スタンダード契約は `active`、ユーザーの `plan_code` は `standard`、月次 50 クレジットは 1 回だけ付与済みだった。
- 直近の単発購入も各 transaction につき grant event は 1 件で、購入クレジットは 1 回だけ付与済みだった。
- 現行 `MobileStoreBillingPanel` は現在プランを受け取らず、全商品に一律で「購入する」を表示するため、成功後も登録前と同じ UI に戻る。

## 影響レイヤーとインターフェース

- Mobile domain/lib: ストアの商品定義にサブスクリプションの `planCode` を保持する。
- Mobile bridge: サーバーの商品 catalog に含まれる `plan_code` を型付きの商品定義へ渡す。
- Mobile UI: `AccountScreen` の authoritative な個人プランと、購入直後の `lastVerified.entitlement.plan` を使ってボタン状態を決める。
- Backend / Repository / DB / Apple API: 変更しない。

表示契約:

- 現在プランと同じサブスクリプション: 「登録済み」、disabled。
- 現在プランが有料で別のサブスクリプション: 「プランを変更」。
- 無料プランからのサブスクリプション: 「登録する」。
- 単発クレジット: 「購入する」。

購入直後は query の再取得を待たず `lastVerified` を優先し、古い `free` 表示へ戻る時間を作らない。画面を開き直した場合は balance API の `plan_code` を使用する。

## セキュリティ

- プラン判定は商品タイトルやローカルの製品 ID 推測ではなく、認証済み catalog の `plan_code` とサーバー確認済み entitlement だけを使う。
- クライアント表示は購入権利の authority にはしない。付与・復元・重複防止は既存サーバー処理を維持する。
- receipt、JWS、transaction ID、ユーザー ID、シークレットを UI・テスト・ログへ追加しない。

## テスト方針

先に `MobileStoreBillingPanel` の回帰テストを追加し、現行実装で次を失敗させる。

1. 現在契約中のサブスクリプションが「登録済み」で再購入不可になる。
2. 購入直後の server verified plan が画面再取得前でも優先される。
3. 別プランは「プランを変更」、単発購入は「購入する」のままになる。
4. catalog 変換で subscription の `planCode` を落とさない。

実装後に対象 Vitest、mobile typecheck、lint、mobile 全テストを実行する。

## Terra 委譲

Sol/Terra 手順に従い read-only コード監査を Terra へ 2 回依頼したが、モデル capacity により開始できなかった。そのため同じ task packet をローカルチェックリストとして扱い、Sol が本番ログ、匿名化 DB 状態、Mobile/Backend の状態遷移を照合して統合判断する。

## 既存変更の保護

作業開始時点の次の dirty path は本修正の対象外であり、変更・stage・revert しない。

- `docs/cloud-cost-cuts-2-3-7-2026-06-22.md`
- `docs/cloud-current-state-2026-06-21.md`
- `scripts/createDockerLearningDocx.py`
- `HANDOFF.md`
- `app.json`
- `store-assets/`
