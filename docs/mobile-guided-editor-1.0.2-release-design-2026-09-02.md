# Mobile 制作導線 1.0.2 リリース統合設計（2026-09-02）

## 目的と範囲

承認済みの制作導線 UI 改善を、公開中の Lyra Mobile 1.0.1 と同じモバイル実装系統へ統合し、iOS / Android の更新版 1.0.2 を作成して各ストアへ提出する。

- 公開中の iOS 1.0.1 (build 33) と Android 1.0.1 (versionCode 90) を更新対象とする。
- `fix/mobile-guided-editor-ui` の UI・案内・Guide・日英翻訳・テストだけを、`fix/mobile-page-editor-ux` の最新統合点へ移植する。
- marketing version、runtime version、Apple metadata version を 1.0.2 に揃える。
- iOS build number は既存 build 33 より大きい番号、Android versionCode は既存 90 および preview 91 より大きい番号を使用する。
- production 用 IPA / AAB を同一 Git commit から作成し、iOS は App Store Connect、Android は既存運用と同じ Google Play alpha track へアップロードする。
- Apple の審査提出・手動公開と、Google Play の alpha から production への昇格・公開は、ストア管理画面での最終確認を要するため利用者の操作として残す。

Backend API、DB、migration、認証・認可、organization scope、クレジット、画像生成 payload、Worker、Web UI、ストア課金商品は変更しない。Google Play の production track へ自動で即時公開する設定変更も行わない。

## ベースラインと統合判断

- 公開ストアおよび EAS の最新 store build は 1.0.1 である。
- Android の最新 store build `d378a88c-0129-4839-b6c0-9f0de4eef775` は `9e9b0d4`、iOS の最新 store build `8e6c2419-e3c8-40cb-93fc-882a426768f4` は `4df016d` を使用している。
- `origin/fix/mobile-page-editor-ux` の `9489c9f` は上記両コミットを統合済みで、`9e9b0d4` から `apps/mobile` の内容差がないため、今回の安全なリリースベースとする。
- `origin/main` と承認 APK の `e5b18d4` は公開版系統から大きく分岐し、version 0.1.18 と誤った iOS bundle ID を含む。そのまま build / submit しない。

## Spec 根拠

- `docs/Lyra_Unified_Spec_v4.md` 2章: Story、確定済み character preview、page planning の制作順を画面内で明確にする。
- 同3章: 変更を Mobile presentation / domain helper / release metadata に限定し、Route / Service / Repository / Infrastructure の境界を変えない。
- 同6章: 既存ジョブ状態、再試行、保存契約を変更しない。
- 同8章: raw provider error や秘密情報を表示・記録しない。
- 同10章: Mobile tests、typecheck、lint、contract、mojibake、Expo dependency check / doctor、両 platform export、production build 成果物を検証する。

## 影響レイヤーとインターフェース

- Mobile UI / Domain / i18n / tests: 承認済み UI 変更を現行 1.0.1 系へ移植する。
- Mobile release metadata: `app.json`、`package.json`、lockfile、`store.config.json` を 1.0.2 に同期し、日英 release notes を今回の内容へ更新する。
- EAS remote version: iOS build number を 33 へ同期して auto increment 後を 34 とし、Android は remote 91 から auto increment 後を 92 とする。
- 外部 API / 永続化 / job: 変更なし。
- 出力: 同一 commit に対応する signed IPA / AAB と、各 EAS submission ID。

## セキュリティとリリース安全性

- Apple / Google / EAS の credential、service account、証明書、secret の値をログ・commit・PRへ出さない。
- iOS bundle ID `jp.lyra.mobile`、Android package `com.lyra.mobile`、EAS project ID、ASC app IDを公開済みアプリと一致させる。
- production API / Cognito 設定は既存 1.0.1 系を維持し、preview branch の古い設定で上書きしない。
- Android は alpha track に提出し、実機確認前の production 即時公開を避ける。
- build / submit 後は build ID、commit hash、app identifier、version、build number / versionCode、statusを read-back する。

## TDD と検証方針

1. UI変更は、元ブランチで先に追加して RED を確認した domain / UI contract tests と実装をセットで移植する。現行系との競合は既存 1.0.1 の挙動を優先して手動解消する。
2. 先に metadata test を 1.0.2 と新 release notes の期待へ変更し、設定変更前の RED を確認する。
3. 最小の metadata 更新後、対象 tests、Mobile 全 tests、typecheck、lint、contracts、mojibakeを実行する。
4. `expo install --check`、`expo-doctor`、Android / iOS export を実行し、production config の identifier と endpoint を確認する。
5. branchをpushし、現行モバイル統合branch向けPRを作る。CI成功と差分をSolがレビューする。
6. EAS production buildを両platformで作成し、完了成果物を照合してからEAS Submitを実行する。

## Terra 委譲

- iOS Terra: EAS / App Store の現行 build、identifier、version、提出後の人手操作を read-only 監査する。
- Android Terra: EAS / Google Play の現行 build、track、versionCode、提出後の人手操作を read-only 監査する。
- Git / CI Terra: PR #196、必須 check、リリース系統の分岐、version整合性を read-only 監査する。
- Sol: リリースベース決定、移植・競合解消、TDD、全検証、version同期、build、submit、最終 read-back を担当する。
