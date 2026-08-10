# Mobile認証画面の端末言語追従設計（2026-08-10）

## 目的と範囲

- ログイン前のネイティブ画面とCognito Managed Loginのログイン・登録画面を、端末の優先言語に合わせる。
- 対応言語は既存契約どおり日本語と英語に限定する。日本語端末は日本語、それ以外は英語へフォールバックする。
- ユーザーがアプリ内で明示的に保存した言語は端末言語より優先し、ログアウト後も維持する。
- バックエンド認証、トークン交換、ユーザー登録契約、認可、既存翻訳本文は変更しない。

## Spec根拠

- `docs/Lyra_Unified_Spec_v4.md` の Authentication 契約に対するMobileクライアント実装。
- 同Verification契約に基づき、端末言語の正規化、保存済み選択の優先、Cognito認可リクエストをテストする。

## 影響レイヤーとインターフェース

- Mobileのみ。
- `expo-localization` の端末ロケールを `UiLanguage` (`ja` / `en`) へ正規化する。
- SecureStoreに言語が存在しない場合だけ端末言語を採用する。保存済み値があればそれを優先する。
- `signInWithCognito(language)` がCognitoの認可リクエストへ許可済み値だけを `lang` として渡す。
- Androidで端末言語を変更してアプリへ戻った場合、明示的な言語選択がない間だけ再評価する。

## セキュリティ

- `lang` は型で `ja` / `en` に制限し、任意のクエリ値を受け取らない。
- PKCE、redirect URI、token exchange、SecureStoreの認証情報は変更しない。
- ロケール情報をバックエンド送信・ログ出力・永続化しない。

## テスト方針

1. `ja-*` は日本語、それ以外・不明値は英語へ正規化される。
2. 保存済み言語が端末言語より優先され、未保存時だけ端末言語が使われる。
3. Cognito認可リクエストに現在の言語が `lang` として入る。
4. 対象テスト、Mobile全テスト、typecheck、lint、contracts、文字化け検査、Android/iOS exportを通す。

## Terra委譲

- Terraには既存の認証・言語決定経路のread-only監査を委譲した。
- 設計、TDD、実装、統合判断、最終検証はSolが担当する。

## Gitベースライン

- `fix/android-purchase-readiness` (`36536c6`) から継続する。Android閉鎖テストのフィードバック対応を同じDraft PRへ追加するためである。
- 既存のCloud文書、DOCXスクリプト、ルート`HANDOFF.md`、ルート`app.json`、`store-assets/`は対象外とし、stageしない。
