# ローカル候補の受け取りと確認

この手順はローカルレビュー用。merge、production migration、AWS task 更新、store 提出、
署名 build、OTA を実行する手順ではない。最終配布 manifest の SHA-256 と commit を照合する。

## Git bundle

最終 bundle は受け取り済みのローカルファイルとして扱う。新しい review clone または安全な別 worktree
へ読み込む。ユーザーの既存未保存変更を reset/checkout で上書きしない。

```sh
git bundle verify /path/to/lyra-release-candidate.bundle
git fetch /path/to/lyra-release-candidate.bundle \
  chore/release-readiness-2026-10-01:review/lyra-release-candidate
git worktree add ../lyra-release-review review/lyra-release-candidate
git -C ../lyra-release-review rev-parse HEAD
```

bundle の prerequisites が表示される場合、その commit を持つ承認された既存 clone で取り込む。
権限エラーを迂回して GitHub へ push しない。最終 PR はまだ公開されていない。

## 検証

依存は repo の lockfile で管理。検証環境に既存の approved dependency installation を用意し、
本番 credentials を与えない。PostgreSQL 16／18.3 の integration は必ず使い捨て DB を使う。

```sh
bun run build
bun run test
bun test tests
bun run mobile:contracts:check
bun run api:inventory:check
npm --prefix apps/mobile run typecheck
npm --prefix apps/mobile run lint
npm --prefix apps/mobile run test
npm --prefix apps/mobile run check:mojibake
npm --prefix apps/web run lint
npm --prefix apps/web run build
```

DB integration は `APP_ENV=test` と disposable `DATABASE_URL` がないと skip される。
skip を pass と数えない。全 integration が実行されたログを別途確認する。
テスト用 schema を作成・破棄するので、production/staging の実ユーザー DB を絶対に指定しない。

## Expo の offline bundle 検証

以下は JavaScript と assets のローカル bundle 検査であり、署名 IPA／AAB、EAS build、
ストア提出、実機受入ではない。ネットワークの診断／telemetry を無効にして実行する。

```sh
cd apps/mobile
EXPO_OFFLINE=1 EXPO_NO_TELEMETRY=1 SENTRY_DISABLE_AUTO_UPLOAD=true \
  node node_modules/expo/bin/cli export --platform android --output-dir dist/android --max-workers 2
EXPO_OFFLINE=1 EXPO_NO_TELEMETRY=1 SENTRY_DISABLE_AUTO_UPLOAD=true \
  node node_modules/expo/bin/cli export --platform ios --output-dir dist/ios --max-workers 2
```

## 画面 preview

portable preview が添付される場合、その README と manifest に記載された commit だけを表す。
fixture adapter を使った画面検査用であり、Cognito、AWS、課金、OpenAI への実接続はしない。
旧 f89ac1d preview は現在の候補全体の preview ではない。

実画面確認は使用する PC／browser の承認後に行い、small mobile／desktop で layout、scroll、
focus、safe-area、modal、back、dirty を確認する。mock render の試験数を visual QA と呼ばない。

## 判断文書

- release-readiness-2026-10-01.md: 残ゲート、段階反映、rollback、実機 checklist
- release-feature-traceability-2026-10-01.md / release-ui-traceability-2026-10-01.md: 要件対応
- production-lineage-bridge-design-2026-10-01.md: exact production schema bridge と停止条件
- release-final-review-2026-10-01.md: 独立した最終コード確認
- release-validation-2026-10-01.md と配布 manifest: 対象 commit と実行／未実行結果
