# iOS 実機購入の検証復旧（2026-08-11）

## 目的と範囲

- TestFlight で完了した Apple の購入をサーバーで検証し、既存の冪等な取引・クレジット付与処理へ到達させる。
- 一時的に追加した「課金診断」の画面表示を削除する。
- 商品カタログ、価格、クレジット量、購入アカウント紐付け、DB schema は変更しない。

## 根拠となる仕様

- `docs/Lyra_Unified_Spec_v4.md` の Credits and billing: provider が検証した取引だけを正とし、クレジット付与を transaction 内かつ冪等に行う。
- Apple の TestFlight ビルド内課金は Sandbox で実行される。

## 観測した事実と原因

- 本番 API の `/api/mobile-purchases/apple/verify` は、実機購入時に 5 回連続で HTTP 422 `Store purchase could not be verified` を返している。
- モバイルの `environmentIOS` 正規化は小文字の `sandbox` だけを Sandbox と判定し、StoreKit/OpenIAP が返し得る `Sandbox` を `production` に誤変換する。
- サーバーはクライアントが指定した environment の Apple 署名検証器だけを使うため、Sandbox JWS を Production 検証器へ渡して失敗し、クレジット付与前に終了する。

## 設計

- Mobile: Apple environment を空白除去・小文字化して正規化する。
- Backend: クライアントの environment は検証順のヒントとしてのみ扱い、有効化された Apple environment の検証器を順に試す。署名検証に成功した実 environment を後続処理へ渡す。
- Service: Apple の署名、bundle ID、Apple ID、商品 ID、account binding の検証を引き続き必須にする。Sandbox はサーバー設定で許可されている場合だけ受理する。
- UI: 診断データの内部保持は商品取得のため残し、ユーザー向け「課金診断」カードだけを削除する。
- 失敗した購入は検証成功前に `finishTransaction` しない。修正後は「購入を復元」で同じ取引を再検証し、既存の transaction/event 冪等性により一度だけ付与する。

## セキュリティ

- クライアント申告だけではクレジットを付与しない。
- Apple の `SignedDataVerifier` による署名・bundle ID・Apple ID 検証を全環境で維持する。
- Sandbox 検証は production 設定で明示的に許可されている場合に限定する。
- signed transaction、credential、provider の raw error はログや UI に出さない。

## テスト方針

1. `Sandbox` を受信した Mobile が `sandbox` を backend へ送る失敗テストを先に追加する。
2. 指定 environment が誤っていても、有効な別 environment の署名検証に成功する backend の失敗テストを先に追加する。
3. Sandbox 無効時は Sandbox 検証を試さないことを確認する。
4. 診断 UI が表示されず、購入・復元 UI は残ることを確認する。
5. Mobile 対象テスト、Apple infrastructure/service 対象テスト、型検査・build を実行する。

## 委譲と作業ベースライン

- Terra には read-only の購入経路監査と診断 UI の影響範囲確認を委譲し、Sol が本設計と統合判断を行った。
- 既存ブランチ `fix/android-purchase-readiness` と Draft PR #183 を継続する。ユーザーの未コミットファイルは変更・stage しない。
