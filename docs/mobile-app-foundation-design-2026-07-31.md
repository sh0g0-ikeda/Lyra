# Mobile app foundation design

## 目的と範囲

最新`origin/main`から、Backend / Webの実行経路を変更せずに`apps/mobile`の最小基盤を追加する。
初回範囲はExpo package、設定検証、Cognito Hosted UI PKCE、SecureStore session、refresh single-flight、
`GET /api/me`だけを持つschema検証付きAPI client、認証状態を表示する最小navigation、共通i18n / error policy、
生成API schemaと独立したMobile CIである。

Story / Characters / Pages、organization管理、課金、upload / export、Push、Sentry、Maestro、EAS、
Store metadata、production bundle / project identifierは後続PRへ分離する。旧PR #67や
`feature/mobile-completion`をmerge / cherry-pickせず、現行mainの契約から再構成する。

## Spec根拠

- `docs/Lyra_Unified_Spec_v4.md` Architecture
- `docs/Lyra_Unified_Spec_v4.md` Authentication / API response contract
- `docs/Lyra_Unified_Spec_v4.md` Availability and Verification
- `docs/mobile-release-task-list-2026-07-30.md` PR-E Mobileアプリ基盤

## 影響レイヤー

- Mobile: 新規`apps/mobile` package、認証、API transport、navigation、i18n、error policy
- Shared contract: 現行`packages/api-contract/src/mobileApiSchemas.ts`からMobile生成物を作る
- CI: 既存`verify` jobを変更せず、Mobile専用jobを追加する
- Backend / Worker / Web / DB: runtime動作、dependency、migrationを変更しない

## インターフェース

- 公開設定: `EXPO_PUBLIC_API_BASE_URL`、Cognito domain / client / redirect / logout / scopes、
  build environment。値はtrim、URL scheme、長さ、production originをbounded validationする。
- 認証: Authorization Code + PKCE、ID tokenをAPI bearerに使用、refreshはsingle-flight、
  logout成功・失敗のどちらでも端末tokenを削除する。
- API: 初回は`GET /api/me`だけ。2xx JSONを`currentSessionSchema`で検証し、
  不正payloadは安定した`INVALID_API_RESPONSE`へ変換する。raw response / tokenは表示しない。
- 永続化: SecureStoreにはboundedなtoken sessionだけを保存し、秘密値をログへ出さない。
- Navigation: 未認証はAuth、認証済みはFoundation Home、設定不備はサポートコード付き安全画面。

## セキュリティ

- rootの未追跡`app.json`、`.env`、credentialを読み込み・移動・コミットしない。
- Store / Push / Sentry / production EAS設定を初回packageへ含めない。
- APIはHTTPSを既定とし、localhost HTTPはdevelopmentだけ許可する。
- Cognito callback state / PKCE verifierを検証し、token responseをbounded schemaで検証する。
- API errorはstatus / stable codeだけを保持し、provider messageやbodyをUIへ返さない。
- Mobile schema生成元はmainのcanonical schema 1ファイルだけとし、未接続API宣言を生成しない。

## TDDと検証

1. schema generator、config、API、auth、storage、navigationのテストを先に追加し、
   生成物 / 実装欠損によるredを確認する。
2. 最小実装後にMobile focused tests、typecheck、lint、全Mobile testを実行する。
3. `npm ci`、`expo install --check`、`expo-doctor`、Android / iOS exportを確認する。
4. 共有contractとCIに触れるため、Backend Vitest / Bun、fresh PostgreSQL migration / invariant、
   Backend build、Web lint / build、Playwright smokeも実行する。

Expo SDK 57のcompatibility checkで要求されたpatch
（Expo 57.0.9、React Native 0.86.2等）へ最初から合わせ、旧Mobile枝の既知doctor failureを持ち込まない。

## Sol / Terra

Solが設計、生成契約、認証/API境界、統合判断、全ゲートを担当する。
TerraにはMobile package/config/deep-linkの限定ファイルだけを所有させ、Store / Push / EAS /
production識別子、root lockfile、Backendを触らせない。Terra結果はSolがdiffとテストで再確認する。
