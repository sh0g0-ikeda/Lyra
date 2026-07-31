# Mobile Account error-state設計

## 目的と範囲

現行`main`のMobile基盤へ、プロフィール、workspace切替、個人クレジット残高、
workspace単位のgeneration job履歴を表示するAccount sliceを追加する。
正常な空データをerrorへ変換せず、実際の取得失敗だけに再試行導線を出す。

今回含めるもの:

- personal / active organizationのworkspace切替
- `GET /api/me`のpersonal / organization残高snapshot表示
- `GET /api/jobs`の先頭25件と正常な0件表示
- balance / job履歴の実エラー、再試行成功、workspace切替後のstale error解消

今回含めないもの:

- organization管理、請求操作、StoreKit / Google Play adapter
- account deletion、job cancellation / hide / retry
- Backend、DB、migration、Worker、Webの変更
- PR #67の競合した`AccountScreen`の直接取込み

## Spec根拠

- `docs/Lyra_Unified_Spec_v4.md` §5 Persistence and tenancy
- 同 §6 Generation jobs
- 同 §7 Credits and billing
- 同 §8 Input and output safety
- 同 §10 Verification gate
- `docs/mobile-release-task-list-2026-07-30.md` PR-G内のfalse-positive 2件

## 影響レイヤー

- Mobile Screen: Account表示とworkspace selection
- Mobile query/cache: sessionとworkspaceを含むquery key
- Backend / DB / Worker / Web / shared API response contract: 変更しない

## インターフェースと状態規則

- Accountは認証済み`CurrentSession`を必須データとして受け取る。
- personal / organization balanceは`GET /api/me`に含まれる認証済みsession snapshotを表示する。
  Account初期表示のためだけに任意のbilling endpointを追加取得しない。
- job履歴は`GET /api/jobs?limit=25&organization_id?`を使用する。
- job listが`200 { jobs: [], next_cursor: null }`ならempty stateだけを表示する。
- initial job list errorではempty stateを表示せず、安定文言と再試行を表示する。
- 成功済みdataのrefetch失敗はdataを保持しつつwarningを表示できるが、
  404を「0件」へ読み替えない。emptyとnot-foundを混同しない。
- workspace切替ではquery keyをscope分離し、以前のscopeのerrorを表示しない。

## セキュリティと非破壊性

- organization IDは`CurrentSession.organizations`のactive membership候補からだけ選ぶ。
- API側のmembership認可を省略せず、既存の`organization_id` query contractを使う。
- balance / historyはいずれもread-onlyで、credit、job、queue、story dataを更新しない。
- provider errorやraw Backend messageを表示せず、既存の安定文言へ変換する。
- response schema、DB schema、job status、pagination wireは変更しない。

## TDDと検証

先に次のMobile UI/APIテストを失敗させる。

1. session正常・job 0件でdanger noticeを表示せずemptyだけを表示する。
2. job取得失敗ではemptyを表示せず再試行を表示する。
3. job再取得成功後に古いerrorを消してemptyへ遷移する。
4. personal error後のorganization切替で古いerrorを引き継がない。
5. session snapshotの残高表示が追加のbilling requestを発生させない。

focused test後、Mobile全test / typecheck / lint / Expo checks / Android・iOS export、
Backend Vitest / Bun / build、migration / invariant、Web lint / build / Playwright smokeを確認する。
最後に`git diff`でBackend / DB / Worker / Webが無変更であることを監査する。

## Sol / Terra

指定の`skills/lyra-sol-terra-orchestration`は現行`main`に存在しないため、Solが設計、
TDD、実装、統合を担当する。既存Terra agentには現行境界とtenancyをread-onlyで監査させ、
結果を採用前にSolがコードと照合する。
