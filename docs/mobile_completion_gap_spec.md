# Lyra Mobile 完成要件・差分解消仕様書

最終更新: 2026-07-24
対象: `apps/mobile`、Lyra backend API、Cognito、Stripe、EAS、App Store / Google Play 配布
状態: 実装着手前の監査済み要件
正本: `docs/Lyra_Unified_Spec_v4.md` と本書

> 本書は `docs/mobile_frontend_design.md` を置き換える現行仕様である。旧文書には現行 Web/API とのずれと文字化けがあるため、実装判断には使用しない。

## 1. この文書の目的

この文書の目的は、現在の Lyra Mobile を「起動できる試作」から、Lyra の個人・法人機能を安全に利用できる配布可能なアプリへ完成させることである。

実装者は本書だけで、次を判断できなければならない。

1. 現在何が実装済みで、何が壊れているか。
2. Backend のどの API を、どのテナント条件で呼ぶか。
3. 各画面に何を表示し、どの順序で操作させるか。
4. 長時間ジョブ、クレジット、認証、法人権限をどう扱うか。
5. iOS / Android のリリース前に何を検証するか。
6. どの条件を満たせば「Lyra Mobile 完成」と判定できるか。

## 2. 設計ブリーフ

### 2.1 目的と範囲

対象範囲:

- Cognito Hosted UI を使ったログイン、登録、ログアウト、トークン更新
- 個人ワークスペースと法人ワークスペースの切り替え
- 作品、章、話、シーン、キャラクター、ページ、コマの編集
- StoryAI、ページ骨格生成、話全体反映、キャラ参照画像生成、ページ生成
- ジョブ進捗、失敗、再試行、キャンセル可能な処理
- 個人・法人の残クレジット、プラン、追加購入、請求管理
- 画像表示、確定、再生成、エクスポート、共有
- 日本語・英語 UI と生成言語の一致
- EAS Build、実機テスト、CI、ストア申請、運用監視

対象外:

- Backend に存在しない機能を Mobile だけで擬似実装すること
- 過去の生成画像を暗黙に再生成参照へ使うこと
- WebView で Web 版全体を包むだけの実装
- 独自ログインフォーム
- 生成 AI のモデルや compiler prompt の変更
- 未採用のキャラクター派生機能。Backend 契約が追加されるまで将来機能とする

### 2.2 Spec 根拠

`docs/Lyra_Unified_Spec_v4.md` の以下を基準にする。

- Architecture: Route / Service / Repository / Domain / Infrastructure / Worker / Web / Mobile の境界
- Authentication and authorization: personal ownership または active organization membership
- Organization roles: owner / admin / billing / editor / viewer
- Billing: personal と organization の残高・台帳・権限を分離
- Generation jobs: queued / processing / completed / failed と冪等な返金
- Story workflow: work -> chapter -> episode -> scene -> page -> panel
- Character workflow: import / preview / confirm / delete reference
- Page workflow: skeleton -> story apply -> edit -> generate -> confirm / reopen -> export
- Validation: bounded schema、画像 MIME / size、LLM structured output validation
- Verification gate: test、build、migration/invariant、browser/mobile smoke

### 2.3 影響レイヤー

| Layer | 必要な作業 |
|---|---|
| Mobile | UI、状態管理、API client、i18n、画像、認証、課金導線、テスト |
| Route | Mobile に不足する job list/cancel、account deletion、push token が必要なら追加 |
| Service | job cancel の状態遷移、返金、push 通知、account deletion orchestration |
| Repository | 上記機能の永続化。既存 SQL とテナント境界は維持 |
| Infrastructure | Cognito deep link、Stripe browser handoff、push provider、crash reporting |
| Worker | cancel 要求の協調確認と completed/failed/refunded の競合防止 |
| Ops | EAS secrets、Cognito callback、universal/app links、store metadata、監視 |

### 2.4 セキュリティ原則

- `organization_id` は「選択中 UI」ではなく、認可された `/api/me` membership に含まれる値だけを送る。
- 作品・キャラ・ページ・画像は personal owner または active organization membership でスコープする。
- billing capability と content edit capability を混同しない。
- access token / ID token / refresh token をログ、analytics、crash report に含めない。
- `EXPO_PUBLIC_*` に秘密情報を置かない。公開可能な API URL、Cognito domain/client ID のみ許可する。
- Stripe return URL の表示だけで購入成功扱いにしない。Backend webhook 反映後の残高・プランを再取得する。
- 画像は authenticated endpoint または短命 URL だけで取得する。
- upload は JPEG / PNG / WebP、5 MB 以下を Mobile と Backend の両方で検証する。

### 2.5 テスト方針

ドキュメント作成は TDD 対象外である。実装時は、各 Gap ID に対応する失敗テストを先に追加する。

最低限必要な検証:

- TypeScript strict typecheck
- ESLint
- API contract tests
- React Native component tests
- auth/deep-link tests
- personal / organization tenancy tests
- iOS / Android の実機 E2E
- release build と store preflight

### 2.6 Sol / Terra 分担

- Sol: 全体契約、優先順位、セキュリティ、統合、完成判定
- Terra: Pages 領域の read-only 独立監査
- Terra の結果は本書へ統合後、Sol が Backend と Web の実装へ再照合する

## 3. 監査時点の結論

現在の `apps/mobile` はリリース不能である。主な理由は次のとおり。

1. `apps/mobile` 全体が Git 未追跡で、CI・PR・デプロイの対象になっていない。
2. `CharactersScreen.tsx` に TypeScript 構文エラーがあり、typecheck が失敗する。
3. 日本語文字列が複数ファイルで文字化けしている。
4. 法人ワークスペースを選べる一方、残高・請求・組織管理は個人契約のままで、誤請求を誘発する。
5. balloon API だけ `organization_id` が欠落しており、法人利用で認可エラーになる。
6. Backend の法人機能、招待、メンバー、監査、請求に Mobile UI/API が追従していない。
7. 長時間ジョブは端末内に最大 10 ID を保存するだけで、一覧、キャンセル、削除、background 完了通知がない。
8. CI に Mobile の install/typecheck/test/export がない。
9. Cognito callback は custom scheme だけで、universal/app links と招待 deep link が未完成。
10. ストア配布に必要な account deletion、privacy/data safety、support metadata が定義されていない。

## 4. 優先度と完成判定

| 優先度 | 意味 |
|---|---|
| P0 | build、データ安全性、認証、課金、テナンシーに関わる。解消しない限り配布禁止 |
| P1 | Lyra の主要ワークフローが成立しない、または重大な UX 問題 |
| P2 | 品質、速度、アクセシビリティ、運用性の改善 |
| P3 | 将来拡張。完成判定には必須でない |

「完成」は次をすべて満たす状態とする。

- P0 と P1 が 0 件
- P2 は本書で明示的に defer されたもの以外 0 件
- personal と organization の全 E2E が green
- iOS / Android production build が成功
- Git/CI に Mobile が含まれる
- 日本語・英語の文字化けと混在が 0 件
- 実機で主要フローを連続 3 回完走

## 5. 現行構成

### 5.1 Mobile

- Expo 57
- React Native 0.86
- React Navigation bottom tabs
- TanStack Query
- Cognito authorization code + PKCE
- SecureStore に token / language / selection / tracked job IDs
- expo-image-picker、file-system、print、sharing、web-browser

### 5.2 画面

現在の bottom tabs:

1. Story
2. Characters
3. Pages
4. Account
5. Guide

最終 IA もこの 5 タブを基本とする。ただし以下を守る。

- Story / Characters / Pages は制作の主タブ
- Account は workspace、credit、billing、language、logout、jobs
- Guide は常時参照できるチュートリアル
- 作品新規作成は Story のみに置く
- 1 画面を巨大な ScrollView にせず、編集単位ごとに sheet / modal / section を使う

## 6. Gap Register

### 6.1 Baseline / Git / Build

#### MOB-BASE-001 [P0] Mobile が Git 未追跡

現状:

- `git ls-files apps/mobile` は空。
- Mobile のコード、package lock、設定が PR と CI に存在しない。

要件:

- `.env`、`.expo`、`dist`、`node_modules`、log は除外する。
- `apps/mobile/src`、`assets`、`package.json`、`package-lock.json`、`app.json`、`eas.json`、設定、README を追跡する。
- Mobile を単独コミットし、レビュー可能にする。

受入条件:

- clean clone から `npm --prefix apps/mobile ci` が成功する。
- `git ls-files apps/mobile` に必要ファイルだけが出る。

#### MOB-BASE-002 [P0] TypeScript 構文エラー

現状:

- `apps/mobile/src/screens/CharactersScreen.tsx` の `age_range` 読み取り式が改行で分断されている。
- `npm --prefix apps/mobile run typecheck` が失敗する。

要件:

- 構文を修正する。
- 同種の改行破損を `tsc` と parser で全ファイル検査する。

受入条件:

- typecheck が 0 error。

#### MOB-BASE-003 [P0] 日本語文字化け

現状:

- `lib/i18n.ts`
- `lib/userMessages.ts`
- `App.tsx`
- `navigation/tabs.tsx`
- `components/JobStatusCard.tsx`
- 一部 screen と旧設計書

要件:

- source を UTF-8 without BOM に統一する。
- 壊れた文字を元の正しい日本語へ人手で置換する。文字コードの再変換を自動で繰り返さない。
- 日本語キーの値を snapshot test する。
- `\u65e5...` のような literal escape を select label に出さない。

受入条件:

- 主要全画面を日本語で実機撮影し、文字化け 0。
- 日本語選択時の英語固定ラベル 0。ただし固有名詞は除く。

#### MOB-BASE-004 [P0] CI に Mobile がない

要件:

- root CI に Mobile install cache、typecheck、lint、unit test、Expo export を追加する。
- Mobile failure で PR を block する。
- lockfile を cache dependency に含める。

推奨コマンド:

```bash
npm --prefix apps/mobile ci
npm --prefix apps/mobile run typecheck
npm --prefix apps/mobile run lint
npm --prefix apps/mobile run test
npx --prefix apps/mobile expo export --platform android
npx --prefix apps/mobile expo export --platform ios
```

#### MOB-BASE-005 [P0] Mobile test/lint の実体がない

現状:

- `lint` が typecheck の別名で、lint rule による品質検査になっていない。
- React Native component test runner と実機 E2E runner が構成されていない。

要件:

- ESLint を Expo / React Native / TypeScript 向けに設定し、`lint` と `typecheck` を分離する。
- Jest または Vitest と React Native Testing Library を導入し、component と hook を実行する。
- Maestro または Detox を 1 つ選び、iOS/Android の release-like build で E2E を実行する。
- network/provider は component test で mock し、E2E は staging Backend/Cognito/store sandbox を使う。
- CI の command が存在しない、または test 0 件でも成功する設定を禁止する。

### 6.2 API Contract / Data Safety

#### MOB-API-001 [P0] Mobile 型が Backend と重複

現状:

- `apps/mobile/src/domain/types.ts` と `payloads.ts` に API 型を手書きしている。
- Backend schema の変更が Mobile に自動伝播しない。

要件:

- 次のどちらかを採用する。
  - Backend Zod schema から共有 DTO package を生成
  - OpenAPI を生成し Mobile client/type を生成
- 移行までの間は API contract fixture test を置く。
- response を `as T` だけで信用せず、境界で schema parse する。

#### MOB-API-002 [P0] Balloon API の法人クエリ欠落

現状:

- get/create/update/delete/auto balloon が `organizationQuery()` を付けない。
- Backend は organization capability を確認する。

要件:

- 全 balloon method に `organizationId?: string | null` を追加する。
- query key に organization ID を含める。
- personal/org の route test を追加する。

#### MOB-API-003 [P1] Scene delete と entity state API が欠落

Backend:

- `DELETE /api/scenes/:id`
- `POST /api/entities/:id/states`
- `PUT /api/entities/:id/states/:state_id`

Mobile:

- scene create/update のみ。
- キャラ状態の作成・更新 UI なし。

要件:

- scene 削除は確認 dialog 付きで実装する。
- entity state は「継続する外見・負傷・服装状態」として scene/panel assignment から選択できるようにする。
- 状態上書き ID を自由入力させない。

#### MOB-API-004 [P1] Request timeout / retry 分類不足

現状:

- 多くの request は timeout 未指定で無期限待機し得る。
- React Query retry は一律 1 回で、4xx と 5xx の分類が弱い。
- SSE に abort/cancel と idle timeout がない。

要件:

- read 15 秒、通常 write 30 秒、job enqueue 30 秒、SSE idle 90 秒を初期値とする。
- 429/502/503/504/ネットワーク切断だけ指数 backoff で再試行する。
- 400/401/403/404/409/422 は自動 retry しない。
- generation の本処理は HTTP 接続内で待たず job enqueue で返す。

#### MOB-API-005 [P1] 一覧のページング・仮想化契約不足

対象:

- works
- entities
- pages
- organization members/invitations/audit/usage

要件:

- Backend に cursor/limit がある場合は利用する。
- ない一覧は、必要な Backend pagination を追加する。
- Mobile は FlatList/FlashList 相当で仮想化する。
- すべての項目を巨大 ScrollView に描画しない。

#### MOB-API-006 [P1] 画像 upload の base64 依存

現状:

- import image を JSON base64 にすると、元画像より payload が増え、端末 memory と API request body を同時に圧迫する。

Backend 追加:

1. `POST /api/uploads/entity-reference/presign`
2. Mobile が短命 URL へ JPEG / PNG / WebP を直接 upload
3. `POST /api/entities/import-image` へ発行済み upload token を渡して解析・候補化

要件:

- presign 発行時と finalize 時の双方で user/org scope、MIME、最大 5 MB、object ownership を検証する。
- S3 key は server が生成し、filename や user input を key に直接使わない。
- upload token は single-use、短命、user/org/entity purpose に束縛する。
- 未完了 upload は lifecycle で削除する。
- Mobile は progress、cancel、network retry を表示する。upload 完了前に import analysis を開始しない。
- 既存 base64 endpoint は Web 後方互換のため直ちに削除せず、Mobile は新契約へ移行する。

### 6.3 Authentication / Deep Link

#### MOB-AUTH-001 [P0] Production deep link 未完成

現状:

- custom scheme `lyra-mobile://` のみ。
- iOS associated domains、Android intent filters がない。

要件:

- `https://app.lyra-editor.com/auth/mobile/callback` を universal/app link にする。
- fallback と development 用に `lyra-mobile://auth/callback` を残す。
- Cognito app client に callback/logout URL を登録する。
- iOS `associatedDomains` と AASA を設定する。
- Android `intentFilters` と `assetlinks.json` を設定する。

#### MOB-AUTH-002 [P0] 招待 link の Mobile 導線がない

要件:

1. `https://app.lyra-editor.com/invitations/{token}` を app link として受ける。
2. 未ログインなら token を SecureStore に一時保存して Cognito へ進む。
3. ログイン後、招待メールと Cognito email が一致するか Backend で検証する。
4. accept API 成功後に organization selection へ切り替える。
5. expired/revoked/used/mismatch を個別に説明する。
6. Web fallback でも同じ link が動く。

#### MOB-AUTH-003 [P0] Session bootstrap の復旧導線不足

現状:

- `/api/me` 失敗時は generic notice と logout だけ。

要件:

- 401: refresh 1 回後、失敗なら再ログイン
- network/5xx: Retry と offline 表示。token を消さない
- 403: account/organization permission の説明
- Retry ボタンで `/api/me` と選択中 workspace を再取得
- loading/error/empty を区別する

#### MOB-AUTH-004 [P1] Concurrent refresh race

要件:

- timer、foreground、401 interceptor が同時に refresh しない single-flight mutex を使う。
- refresh 中の API は新 token を待って 1 回だけ再送する。
- logout 中の refresh 結果を保存しない。

#### MOB-AUTH-005 [P0] Account deletion

ストア要件:

- アプリ内でアカウント作成を提供する場合、アプリ内から削除開始できる必要がある。

要件:

- Account に「アカウントを削除」を置く。
- personal data、organization ownership、active subscription、confirmed assets の扱いを確認画面に明示する。
- Backend に account deletion orchestration がなければ追加する。
- owner が唯一の owner の法人がある場合は移譲または法人解約を先に求める。
- Stripe subscription cancel、Cognito disable/delete、DB anonymize/delete、S3 lifecycle を冪等に行う。

### 6.4 Workspace / Organization / Billing

#### MOB-ORG-001 [P0] Workspace 選択と請求表示が不一致

現状:

- organization を選択できる。
- Account の balance は常に `/api/billing/balance`。
- Web billing URL は固定。

要件:

- personal 選択時だけ personal balance/plan/checkout を表示する。
- organization 選択時は organization balance/plan/billing を表示する。
- organization で個人 credit purchase UI を出さない。
- viewer/editor/admin/billing/owner の capability に応じてボタンを非表示または説明付き disabled にする。
- admin に billing capability を与えない。

#### MOB-ORG-002 [P1] 法人管理 UI が未実装

Backend と同等に必要:

- organization list/create/detail/update
- member list
- invitation create/list/resend/revoke/accept
- role update/member remove
- credit balance
- plans
- subscription/credit checkout
- customer portal
- billing summary/invoices
- usage/CSV
- audit logs

UI 方針:

- 制作画面の右常駐 UI には置かない。
- Account > Workspace management の専用 stack に置く。
- organization feature flag が false のときは「法人機能は近日追加予定」を表示し、API を呼ばない。
- true に戻すだけで本 UI を有効化できる。

#### MOB-ORG-003 [P0] Role capability の表示・強制

| Role | Content | Members | Invitations | Billing | Audit |
|---|---:|---:|---:|---:|---:|
| owner | edit | manage | manage | manage | view |
| admin | edit | manage | manage | none | view |
| billing | view | none | none | manage | billing-related |
| editor | edit | none | none | none | none |
| viewer | view | none | none | none | none |

要件:

- Mobile の表示制御は補助であり、Backend 認可を正とする。
- 403 を role mismatch として説明する。
- owner 最後の 1 人を削除・降格できない。

#### MOB-BILL-001 [P0] Stripe return を成功扱いしない

要件:

- Web と organization の管理者向け請求では、checkout/portal URL を Backend から取得して system browser で開く。
- return 後は「決済情報を確認中」と表示する。
- balance/plan API を backoff 付きで再取得する。
- webhook 反映後だけ「購入完了」と表示する。
- cancel/戻る/timeout を成功と表示しない。

#### MOB-BILL-002 [P1] Plan/credit UI parity

表示:

- 現在プラン: free / standard / premium
- 月額 credit、追加 credit、合計
- 次回更新日
- cancel_at_period_end
- 「有料プランの変更・解約は『サブスク・請求を管理』で行ってください」
- personal と organization で商品を混ぜない

月額 credit は毎月規定値へ更新し、未使用月額分を累積しない。追加購入分は別残高として保持する。

#### MOB-BILL-003 [P0] App Store / Google Play のデジタル課金規約

問題:

- 個人ユーザーが Mobile 内で購入する subscription と生成 credit は、アプリ内で消費するデジタル商品である。
- iOS / Android の全地域で Stripe 外部 checkout を直接表示すると、store review で拒否される可能性がある。
- Web の Stripe 契約をそのまま Mobile の購入実装とみなしてはならない。

初回配布で採用する方式:

1. Web は現行どおり Stripe を使う。
2. iOS の個人 subscription / credit は StoreKit、Android は Google Play Billing を使う。
3. Mobile は store product を取得できないとき、購入ボタンを disabled にし、外部 Stripe URL へ自動迂回しない。
4. organization / enterprise の契約と請求管理は owner または billing role が Web で行う。Mobile は契約状況・共有残高・請求履歴を表示し、管理画面を開く導線だけを提供する。地域・store entitlement により外部導線が許可される場合も、release config で明示的に有効化する。
5. 購入復元を必須にする。端末側 receipt だけで credit を付与しない。

Backend 追加契約:

- `POST /api/mobile-purchases/apple/verify`
- `POST /api/mobile-purchases/google/verify`
- App Store Server Notifications V2 の署名検証 endpoint
- Google Play Real-time Developer Notifications の検証 consumer
- Mobile product ID と Lyra plan / credit grant の server-side mapping
- `store + original_transaction_id / purchase_token` を unique idempotency key とする purchase ledger
- refund、revocation、chargeback、subscription renewal/expiry を既存 credit/plan ledger に整合させる
- personal credit にだけ付与し、organization balance へ暗黙移送しない

Mobile UI:

- 選択中 workspace が personal の場合だけ、store product と個人残高を表示する。
- organization の場合は organization plan / shared credits を表示し、個人用 purchase CTA を同じ panel に表示しない。
- price はコードへ直書きせず、StoreKit / Play Billing が返す localized price を表示する。
- purchase pending、cancelled、verified、failed、revoked を区別する。
- 「購入完了」は Backend verification と balance refresh が完了した後だけ表示する。

受け入れ条件:

- Apple sandbox と Google Play license tester で purchase / cancel / pending / restore / refund を確認する。
- 同じ transaction notification を複数回受信しても credit は 1 回しか付与されない。
- Web Stripe と mobile store purchase が同じ account plan/ledger に二重付与を起こさない。
- store review 用 metadata の価格、商品名、利用規約、privacy policy と実装が一致する。

### 6.5 Story

#### MOB-STORY-001 [P1] 最新 IA と不一致

現状:

- works / chapters / episodes が別々の selector/section。

完成 UI:

- VS Code の directory tree に近い階層 selector を mobile sheet で表示する。
- work と chapter は折りたたみ可能。
- work の menu: rename / add chapter。
- chapter の menu: rename / move up/down / add episode / delete。
- episode の menu: rename / move up/down / delete。
- episode を章末から下へ移動すると次章先頭へ移る。
- delete は確認 dialog を必須にする。
- 現在編集中の episode を header に短く表示する。
- “Current episode selection” の説明カードは置かない。

#### MOB-STORY-002 [P1] 不要入力の露出

UI から隠す:

- work genre
- work theme / world / overall flow / start / end の旧作品概要一式
- chapter purpose
- episode purpose
- AI-only memo
- structured 4 分割 story input

データ構造は削除せず、既存値も破棄しない。

表示する主入力:

- work title
- chapter title
- episode title
- full story draft
- scenes（任意）

#### MOB-STORY-003 [P1] Scene が optional と伝わらない

要件:

- 「場所・時間帯・雰囲気をページ間で揃えたい場合に使います。未設定でも生成できます」と表示する。
- default expanded。
- create/update/delete を提供する。
- scene が 0 件でも skeleton/story apply を reject しない。

#### MOB-STORY-004 [P1] Skeleton 上書き再生成

現状:

- `overwrite_existing:false` 固定。

要件:

- 初回は「ページ骨格を生成」。
- 既存 pages がある場合は「ページ骨格を上書き再生成」。
- 上書きで失われる page/panel 編集を確認 dialog に列挙する。
- enqueue 直後は「開始しました」。completed 前に「完了」と表示しない。

#### MOB-STORY-005 [P1] StoryAI の適用単位

要件:

- instruction を送って current episode draft を改善する。
- output は生成 pipeline が扱いやすい full story 形式。
- 現在の出力を再入力して追加改善できる。
- work 内の他 chapter/episode を整合性 context として Backend が扱う。
- 「改善する」と「全体ストーリーへ反映」を明確に分ける。
- title/purpose 用の不要な apply UI は出さない。

#### MOB-STORY-006 [P1] 話全体反映の長時間 UX

要件:

- 押下時に「この処理は20分程度かかる場合があります」と表示する。
- job の実進捗がある場合は stage/percent を表示する。
- 実進捗がない場合も indeterminate animation と elapsed time を表示し、偽の percent は使わない。
- background/foreground 復帰後に job を再取得する。
- cancel API がある場合は「停止」を提供する。
- canceled/failed の charge/refund 状態を表示する。

### 6.6 Characters

#### MOB-ENTITY-001 [P0] 画面が compile できない

MOB-BASE-002 と同じ構文エラーを最優先で修正する。

#### MOB-ENTITY-002 [P1] 最新入力 UI と不一致

完成順序:

1. character list/new
2. name / type
3. GUI 選択項目
4. reference image import
5. free description
6. save
7. preview / confirmed references

UI から削除:

- prompt supplement
- reappearance anchor / visual anchor / silhouette / distinguishing-point 詳細
- AI-only IDs

保持:

- Backend field と既存値
- aliases（別名・通称）
- free description

文言:

- import: 「手元のキャラクター画像を取り込むと、その見た目を参考に漫画へ登場させられます」
- free description: 「選択肢にない特徴や、特別に守りたい条件を書いてください」
- 「すべての空欄を埋める必要はありません」

#### MOB-ENTITY-003 [P1] Clothing details

要件:

- clothing details は選択肢ではなく自然言語の自由入力だけにする。
- GUI 選択値と自由入力を保存 payload に重複して入れない。

#### MOB-ENTITY-004 [P0] Preview / confirm state

要件:

- preview は毎回「現在保存済み入力」から新規生成する。
- 過去 preview を暗黙の reference に使わない。
- 候補は 1 枚だけ。
- import analysis 結果と generated preview を同じ reference-set 契約で扱う。
- `primary_s3_key` は必ず `selected_s3_keys` に含める。
- candidate token と S3 key の状態を混同しない。
- preview と confirmed を横並び。狭い端末は同じ section 内で 2 列または横スクロールにし、縦長化を抑える。
- 画像 tap で modal 拡大。明示 X と backdrop tap で閉じる。
- 画像 tap では削除しない。削除は trash button のみ。
- confirm 後に query invalidation と cache busting を行い、古い画像を表示しない。

#### MOB-ENTITY-005 [P1] Generation prerequisite

生成前 blocker:

- entity 未保存
- name 空
- unsupported type
- import 中
- active preview job
- insufficient personal/org credits
- selected workspace permission 不足
- generation feature disabled

要件:

- button disabled だけでなく、足りない項目を個別に表示する。
- action 可能な blocker には該当 section への jump を付ける。

### 6.7 Pages / Panels

#### MOB-PAGE-001 [P1] 画像表示性能

現状:

- React Native `Image` で full-size 画像を直接取得し、一覧レスポンスにある署名済み画像 URL を活用していない。

要件:

- `expo-image` 等の disk/memory cache を使う。
- list では thumbnail、選択中だけ full image。
- aspect ratio を先に固定し skeleton placeholder を表示する。
- selection の前後 1 page を低優先で prefetch する。
- authenticated request の cache key に user/org/page/revision を含める。
- logout、workspace 切替、account deletion で認証付き画像 cache を消去し、別ユーザーへ表示しない。
- 一覧レスポンスの `generated_image.cdn_url` または同等の短命 URL を優先し、画像 export API を一覧表示のたびに呼ばない。

Backend に thumbnail がなければ、S3 event/worker で thumbnail を作るか、画像配信 endpoint に bounded resize を追加する。

#### MOB-PAGE-002 [P1] Style constraint の位置と意味

完成 UI:

- Pages 冒頭に default expanded で配置。
- 名称は「画風の参考」。
- title: 「参考にしたい作品・画風」
- notes: 「線、色、雰囲気など守りたいこと」
- dialogue settings とは独立。
- global dialogue settings UI は置かない。

#### MOB-PAGE-003 [P1] Layout template と panel count

要件:

- 1〜8 panels の日本漫画用 template を表示する。
- 読み順は右から左、上から下。
- standard 4 と horizontal-strip 4 を別 template とする。
- preview は実際の frame geometry を描画し、単純な均等分割で代用しない。
- modal は X / backdrop で閉じる。
- apply 後、template label と panel/frame count を同期する。
- custom/unsynced を明示する。

#### MOB-PAGE-004 [P0] Template 適用時の暗黙削除

現状:

- `allow_panel_truncation:true` を使う箇所がある。

要件:

- default は `false`。
- panel count を減らす場合、削除する panel を明示選択する。
- panel reorder 後に末尾削除する方法も提供する。
- 削除前に dialogue/entities/situation の要約を確認表示する。
- confirm なしの情報消失を禁止する。

#### MOB-PAGE-005 [P1] Panel reorder/delete

要件:

- compact row に order、role、situation の短い要約、ellipsis menu。
- ellipsis menu: move up / move down / rename role if supported / delete。
- title を action icons で隠さない。
- delete confirmation。
- reorder 後に order を 1..N に正規化。

#### MOB-PAGE-006 [P1] Panel editor の情報境界

section を明確に分ける:

1. Situation and background
2. Composition and camera
3. Characters in panel
4. Dialogue
5. Effects / notes

要件:

- character card は entity 名、role、position、facing、expression、pose/action、effect、state を同一枠内に置く。
- dialogue card は speaker、type、placement、text を同一枠内に置く。
- nested card in card を避け、section border / spacing で区別する。
- custom value は “Custom” 選択時だけ入力を表示する。
- 「すべての空欄を埋める必要はありません」を表示する。

#### MOB-PAGE-007 [P1] Dialogue add action

現状:

- 「行を追加」「セリフ行」が残る。

要件:

- label は「セリフを追加」。
- dialogue section header 直下または既存 lines の末尾に、目立つ secondary button として置く。
- narration は speaker null を許可する。
- speech/thought/shout/whisper は panel に登場する entity の speaker ID を必須にする。
- narration text に `キャラ名「...」` が混入した場合は quality warning を出す。

#### MOB-PAGE-008 [P0] Page generation blocker

生成できないケース:

- page/panel/frame 未取得
- panel count != frame count
- panel order 不整合
- speaker-required dialogue の speaker 未指定
- speaker が panel entities に存在しない
- assignment entity が work に属さない
- character reference が必要なのに confirmed ref がない
- confirmed page のまま再生成しようとした
- active page generation job がある
- credits 不足
- permission 不足
- generation feature disabled

要件:

- 「生成できません」だけでなく blocker をリスト表示する。
- 各 blocker に修正 action/jump を付ける。
- Backend validation error を stable code へマップする。

#### MOB-PAGE-009 [P0] Generation snapshot

要件:

- enqueue 時に実際に使う page/panel/entity/dialogue/reference IDs の snapshot を job metadata に保存する。
- UI 変更後も running job の入力を後から監査できる。
- reference は entity ID、canonical name、image key の対応を明示する。
- 画像モデルへ渡す reference 順序と subject label を固定する。
- regeneration は current saved input から新規生成し、直前の page image を使わない。

#### MOB-PAGE-010 [P1] Page provenance

表示・編集:

- source scenes は read-only label/chips
- page purpose rows 2
- continuity note rows 2

生成 brief:

- source scene ID 自体は画像モデルに送らない。
- resolved scene summary、page purpose、continuity note を送る。

#### MOB-PAGE-011 [P1] Export

要件:

- page selection GUI
- PDF または image
- select all
- single image/PDF は filename 指定
- multiple images は share sheet/zip の端末対応を明示
- authenticated endpoint を使う
- download 中断/容量不足/share unavailable を説明する
- 多ページ PDF / zip は端末内で全画像を保持して組み立てない。Backend の非同期 export job を使い、完了後に短命 download URL を受け取る。

#### MOB-PAGE-012 [P0] 保存と生成の原子性

現状:

- 「保存して生成」は page、panels、assignments、frames、generation enqueue を複数 request で直列実行する。
- 途中で失敗すると一部だけ保存され、画面で意図した内容とは異なる snapshot から画像生成が始まる。

Backend 追加:

`POST /api/pages/:pageId/save-and-generate?organization_id=...`

request:

```json
{
  "expected_updated_at": "ISO-8601",
  "page": {},
  "panels": [],
  "frames": [],
  "generation": {
    "language": "ja"
  }
}
```

契約:

- Route は bounded schema で全 payload を検証する。
- Service は work/page ownership または active organization membership、edit capability、credits、generation readiness を検証する。
- page/panel/assignment/frame の保存と durable outbox/job 作成を同一 DB transaction で行う。
- transaction commit 後だけ SQS へ送る。SQS 送信失敗は outbox recovery が再送する。
- `expected_updated_at` 不一致は `409 PAGE_STALE` とし、何も保存・課金・enqueue しない。
- job idempotency key に page ID、revision、request ID を使い、二重 tap で二重課金・二重生成しない。
- 既存の個別更新 API は通常編集用として残し、後方互換を壊さない。

Mobile:

- generation action は本 endpoint だけを呼ぶ。
- `PAGE_STALE` は再読み込みと差分確認へ誘導する。
- 成功時は job ID と保存済み revision を保持し、Pages と Account の双方で進捗を復元する。

#### MOB-PAGE-013 [P0] 画像外セリフの未完結導線

現状:

- Mobile で「画像外のセリフ」を選択できるが、吹き出し編集、自動配置、確定画像への合成まで完結していない。
- image prompt は画像外セリフを除外するため、ユーザー視点ではセリフが消える。

初回配布:

- Mobile では画像外セリフを選択肢から外し、既存データに画像外セリフがある場合は read-only warning と Web での編集導線を表示する。
- 既存データを画像内セリフへ暗黙変換しない。

将来有効化する条件:

- balloon API の organization scope と `speech/thought/narration/sfx/shout/whisper/caption` 型が Backend と一致する。
- create/edit/delete/auto layout、preview、finalize、reopen の一連操作が Mobile だけで完結する。
- finalize 前後の画像 asset と credit/refund 契約がテストされている。

#### MOB-PAGE-014 [P0] Generation readiness API

Backend 追加:

`GET /api/pages/:pageId/generation-readiness?organization_id=...`

response:

```json
{
  "ready": false,
  "blockers": [
    {
      "code": "CHARACTER_REFERENCE_REQUIRED",
      "entity_id": "uuid",
      "field": "entities",
      "message_key": "page.blocker.characterReference"
    }
  ],
  "warnings": [],
  "estimated_credit_cost": 3,
  "page_revision": "ISO-8601"
}
```

要件:

- 判定は生成 service と同じ domain helper を使い、UI と実処理で条件を二重実装しない。
- raw provider error、S3 key、ARN、prompt を返さない。
- blocker には stable code と修正対象 field/entity を返し、Mobile が該当 section へ移動できるようにする。
- generation action 直前にも server-side で同じ readiness を再検証する。

#### MOB-PAGE-015 [P1] Layout template の共有契約

現状:

- Mobile 側に template geometry をハードコードすると、Web / Backend の追加・修正後にコマ数、読順、preview がずれる。
- frame だけ変更する操作では panel count と frame count が不一致になり、生成時に拒否され得る。

Backend 追加:

`GET /api/page-layout-templates`

response の各要素:

- stable template ID
- locale label key
- panel count
- frame geometry
- 日本漫画の reading order（右から左、上から下）
- preview aspect ratio
- supported page size

要件:

- template の source of truth は Backend/domain の既存 template 定義とし、Web/Mobile が同じ値を読む。
- frame-only apply は現在の panel count と一致する template だけ許可する。
- count が違う template は page template change flow を開き、追加 panel の初期値または削除 panel の明示選択を要求する。
- template 適用後に panel/frame count、order、layout config を同一 transaction で整合させる。

### 6.8 Jobs

#### MOB-JOB-001 [P1] Backend job list がない

現状:

- `GET /api/jobs/:id` のみ。
- Mobile は端末内 ID 最大 10 件を保存し、直近 5 件を表示。

要件:

- Backend に `GET /api/jobs?limit=5&organization_id=` を追加する。
- user/org scope と capability を検証する。
- Mobile local list は補助 cache に格下げする。
- 別端末・再インストール後も recent jobs を取得する。

#### MOB-JOB-002 [P1] Cancel / delete

Backend 追加:

- `POST /api/jobs/:id/cancel`
- `DELETE /api/jobs/:id` は履歴非表示化。実体/ledger/audit を即時物理削除しない。

Worker:

- queued: SQS message を cancel 扱いにする。
- processing: stage 境界で cancel_requested を確認する。
- provider call 実行中は即時停止できない場合があることを説明する。
- completed と cancel/refund の競合を transaction で解決する。
- refund は 1 回だけ。

Mobile:

- cancellable status のみ「停止」。
- terminal status のみ「履歴から削除」。

#### MOB-JOB-003 [P1] 進捗表示

要件:

- fake 35% を廃止する。
- Backend stage/percent がある場合のみ determinate bar。
- ない場合は indeterminate bar。
- stage: queued / compiling / preparing references / generating / saving / completed
- elapsed time と「時間がかかる処理です」を表示する。
- job completed 後、関連 query を invalidate する。
- Pages、Story、Characters を開いたとき、対象 resource の active job を server から再取得する。画面内 state の `jobId` だけを正としない。

#### MOB-JOB-005 [P0] 安全なジョブエラー契約

現状:

- 英語 UI では Backend の `error_message` をそのまま表示する経路があり、provider message、内部実装名、識別子を露出し得る。

Backend response:

```json
{
  "status": "failed",
  "error_code": "GENERATION_TEMPORARILY_UNAVAILABLE",
  "message_key": "job.error.temporarilyUnavailable",
  "retryable": true,
  "support_id": "opaque-id"
}
```

要件:

- raw provider error と stack は server log にだけ保存し、API response へ含めない。
- `error_code` は stable domain code、`message_key` は日英 resource key とする。
- `support_id` は秘密情報を含まない opaque ID とする。
- retryable は Backend が provider status と job state から判定する。
- Mobile は locale に応じて `message_key` を表示し、retryable の場合だけ再試行 action を出す。
- 既存 job row の raw error は API serializer で除外し、DB migration を必須にしない。

#### MOB-JOB-004 [P2] Background completion

完成要件:

- app foreground 復帰時に active jobs を即時 refresh。
- push token 登録 API と APNs/FCM を追加し、長時間 job 完了/失敗を通知する。
- push 本文に sensitive story/entity name を既定で含めない。
- notification tap で該当 page/entity/job を開く。

push を初回リリースから defer する場合でも、foreground rehydration は P1 として必須。

### 6.9 State / Offline / Unsaved Changes

#### MOB-STATE-001 [P0] Workspace 切替時の selection 汚染

要件:

- selection key は `userId + organizationId` 単位。
- workspace 切替時に work/chapter/episode/page/entity selection を検証する。
- 別テナント ID を再利用しない。
- Query key へ organization ID を必ず含める。

#### MOB-STATE-002 [P1] Unsaved changes

要件:

- tab移動、entity/page切替、workspace切替、background、logout 前に dirty state を確認する。
- 選択肢: 保存 / 破棄 / キャンセル。
- draft autosave を実装する場合、server version/updated_at と競合検出する。

#### MOB-STATE-003 [P1] Offline / transient failure

要件:

- read cache を表示しながら offline banner。
- write/generation は offline queue に勝手に積まない。
- Retry は user action。
- network 復帰時に stale query を refresh。
- 失敗時に入力 draft を消さない。

#### MOB-STATE-004 [P1] Concurrent update

要件:

- update payload に version/updated_at 条件を導入できる場合は optimistic concurrency を使う。
- 409 で「別の画面で更新されました。再読み込みして確認してください」。
- blind overwrite を避ける。

### 6.10 Error Messages

原則:

- user が次に取れる action を書く。
- provider 名、stack、raw JSON、ARN、S3 key を出さない。
- error code は support 用に折りたたみ表示できるが本文にはしない。

| 状況 | 日本語表示 | Action |
|---|---|---|
| offline | インターネットに接続できません。接続を確認して再試行してください。 | 再試行 |
| 401 | ログインの有効期限が切れました。もう一度ログインしてください。 | ログイン |
| 403 role | この操作を行う権限がありません。ワークスペース管理者に確認してください。 | Workspace |
| insufficient credits | クレジットが不足しています。必要数と残高を確認してください。 | Credit |
| active job | 同じ生成処理が進行中です。完了を待つか、ジョブ画面で停止してください。 | Jobs |
| frame mismatch | コマ数とコマ枠数が一致していません。コマ割りを適用してください。 | Layout |
| missing ref | 登場キャラの確定画像がありません。キャラクター画面で確定してください。 | Character |
| timeout | 受付結果を確認できませんでした。ジョブ一覧を確認してください。 | Jobs |
| 5xx | 一時的に処理できません。入力は保持されています。少し待って再試行してください。 | 再試行 |

### 6.11 i18n

要件:

- UI language と content generation language を同じ選択値から渡す。
- Japanese 選択時: StoryAI、skeleton、story apply、page generation の language は `ja`。
- English 選択時は `en`。
- server content は翻訳しない。
- label/placeholder/error/tutorial/status/template names を辞書化する。
- user content を i18n key として扱わない。
- 日本語と英語で button が切れない。
- hard-coded bilingual label を禁止する。

### 6.12 Accessibility / Mobile UX

要件:

- touch target 44x44 pt 以上。
- icon button に accessibilityLabel。
- text scaling 200% で切れない。
- VoiceOver/TalkBack の focus order を画面順にする。
- color だけで status を伝えない。
- modal に focus trap と close action。
- keyboard 表示中も save/generate action に到達できる。
- safe area と bottom tab を考慮する。
- 390x844、360x800、tablet で screenshot review。
- 1 画面の長大スクロールを避け、summary + drill-down にする。

### 6.13 Performance

目標:

- cold start 3 秒以内で login/loading shell
- cached screen transition 300 ms 以内
- list scroll 55 fps 以上
- first page thumbnail 2 秒以内（通常 4G）
- memory warning で full image cache を解放

実装:

- `expo-image`
- list virtualization
- query pagination
- stable dimensions
- thumbnail/full image 分離
- only selected panel mounts full editor
- debounced text state。保存 API は明示 action
- entity reference upload は presigned upload を使い、画像本体を JSON base64 として API process に保持しない

### 6.14 Observability

要件:

- crash reporting を production のみ有効化。
- release/version/build number/user-safe correlation ID を付ける。
- token、story text、dialogue、image、email を既定で送信しない。
- API の `request_id` と job ID を support code として保持する。
- auth failure、job failure、checkout return failure を metric 化。
- PII を CloudWatch/Sentry breadcrumb に入れない。

### 6.15 Release / Store

#### MOB-REL-001 [P0] App metadata

必要:

- app icon
- adaptive icon foreground
- splash image
- screenshots
- description/keywords
- privacy policy URL
- terms URL
- support URL
- copyright
- age rating/content declaration

#### MOB-REL-002 [P0] EAS configuration

要件:

- preview/production environment を分離。
- EAS environment variables に API URL、Cognito public config。
- secret key は Mobile build に入れない。
- `runtimeVersion` と OTA update policy を設定する。
- production submit profile を設定する。
- build number/version code を CI で一意に上げる。

#### MOB-REL-003 [P0] Privacy

申告対象:

- account identifier/email
- user-created text
- user-selected images
- purchase/subscription status
- diagnostics

要件:

- iOS privacy manifest と App Privacy 回答。
- Android Data safety。
- photo library は selected image だけ。
- tracking SDK を入れる場合は同意と申告。
- data deletion 手順を privacy policy と一致させる。

#### MOB-REL-004 [P0] Production configuration fail-fast

要件:

- 起動時に API base URL、Cognito domain/client ID/redirect URI、build environment を schema validation する。
- production build で `localhost`、HTTP、test Cognito client、Stripe test identifier、store sandbox product を許可しない。
- config 不足時は API call を始めず、安全な設定エラー画面と support code を表示する。
- production API は HTTPS の固定 origin のみ許可し、任意 URL を deep link/query から採用しない。
- preview/production の bundle ID、application ID、callback URL、AASA/assetlinks、store product mapping を表形式で管理する。
- secret、Stripe secret、AWS credential、Cognito client secret を Mobile bundle に含めない。

## 7. API 対応表

凡例:

- I: Mobile 実装済み
- P: 一部実装
- M: Mobile 未実装
- B: Backend 追加が必要

| Domain | Endpoint | 状態 | Mobile 完成時の用途 |
|---|---|---:|---|
| Session | `GET /api/me` | I | user/org/role bootstrap |
| Works | `GET /api/works` | I | workspace scoped list |
| Works | `GET /api/works/:id` | M | deep link/selection recovery |
| Works | `POST /api/works` | I | personal/org create |
| Works | `PUT /api/works/:id` | I | rename/story metadata |
| Chapters | CRUD/move | I | tree edit |
| Episodes | CRUD/move | I | tree edit/cross-chapter movement |
| Skeleton | `POST /api/episodes/:id/generate-page-skeleton` | P | overwrite mode と job UX 修正 |
| StoryAI | improve/collaborate | I | timeout/cancel/i18n 修正 |
| Scenes | list/create/update | I | optional continuity |
| Scenes | delete | M | confirm delete |
| Entity states | create/update | M | persistent injury/clothing state |
| Entities | CRUD | I | character editor |
| Entity import | import image | I | current saved state と token 整合 |
| Entity upload | presign/direct upload/finalize | B | Mobile の大容量 base64 を廃止 |
| Entity refs | set/generate/confirm/delete/image | P | cache/confirm/prerequisite 修正 |
| Pages | list/update | I | page metadata |
| Story apply | episode autofill | I | long job UX |
| Page autofill | page from scenes | I | optional advanced action |
| Panels | CRUD/order/assignments | I | editor |
| Frames | list/apply/replace | I | layout editor |
| Balloons | CRUD/auto | P | org query 修正。UI は現行方針では非表示 |
| Compositions | list | I | GUI options |
| Page generation | generate/confirm/reopen | I | blockers/snapshot/cache |
| Export | page image/PDF/images | P | file/share UX |
| Export jobs | `POST /api/episodes/:id/exports`、status/download | B | 多ページ PDF/zip を server で作成 |
| Jobs | get by ID | I | detail polling |
| Jobs | list | B | account jobs |
| Jobs | cancel | B | long job stop |
| Jobs | hide/delete history | B | account jobs |
| Personal billing | balance | I | selected personal only |
| Personal billing | Web checkout/portal | M | Web 用。Mobile consumer purchase へ流用しない |
| Apple purchase | verify/server notification | B | StoreKit verification、renewal、refund |
| Google purchase | verify/RTDN | B | Play Billing verification、renewal、refund |
| Organizations | list/create/detail/update | M | workspace management |
| Members | list/update/delete | M | role management |
| Invitations | public detail/create/list/resend/revoke/accept | M | app link flow |
| Org credits/plans | get | M | org account |
| Org checkout/portal | create URL | M | billing role only |
| Org invoices/usage/audit | get | M | management |
| Account deletion | orchestration | B | store compliance |
| Push token | register/delete | B | job completion notification |
| Save and generate | `POST /api/pages/:id/save-and-generate` | B | page revision を原子的に保存して enqueue |
| Generation readiness | `GET /api/pages/:id/generation-readiness` | B | UI と生成 service で blocker 契約を共有 |

Mobile UI から直接呼ばない Backend route:

- `/healthz`、`/readyz`: ALB/ECS/運用監視専用。
- `/local-assets/*`: local development 専用。production Mobile から利用禁止。
- `/admin/organizations/*`: 運用管理者専用。一般 Mobile client に method を追加しない。
- `/webhooks/*`: Stripe/App Store/Google Play など provider-to-server 専用。Mobile から送信しない。

## 8. 画面別完成仕様

### 8.1 Login

表示:

- Lyra Japan
- Lyra AI漫画エディタ
- ログイン・アカウント登録はこちら
- Cognito を開く primary button
- privacy/terms links

状態:

- config missing
- browser cancelled
- OAuth state mismatch
- code exchange failure
- user unconfirmed
- network failure

### 8.2 Story

上から:

1. current work/chapter/episode compact header
2. hierarchy tree sheet
3. full story input
4. StoryAI
5. page planning actions
6. optional scenes
7. active job

default:

- chapter/episode selector は展開状態
- scenes 展開
- StoryAI は折りたたみ可

### 8.3 Characters

上から:

1. entity picker/new
2. basic fields
3. GUI characteristics
4. import image
5. free description
6. save
7. preview/confirmed

save と generate を分離し、generate 前に unsaved changes があれば「保存して生成」を一度だけ行う。

### 8.4 Pages

上から:

1. page selector/thumbnail
2. style reference
3. page source/purpose/continuity
4. layout
5. panel list
6. selected panel editor
7. generation blockers/action
8. export

confirmed page は read-only summary。Edit/regenerate 前に reopen。

### 8.5 Account

上から:

1. current workspace
2. current plan/credits
3. personal は StoreKit / Play Billing の purchase/restore、organization は Web 請求管理への role-aware handoff
4. recent jobs
5. organization management link
6. language
7. logout
8. account deletion

credit と jobs は default expanded。organization detail は別 screen。

### 8.6 Guide

折りたたみ不可の短い step tutorial:

1. Story で作品・章・話を作る
2. story を入力し保存
3. Characters を作り preview を確定
4. skeleton を生成
5. story を pages へ反映
6. Pages でコマ・キャラ・セリフを確認
7. page generate
8. confirm/export

各 step から対象 tab へ移動できる。

## 9. End-to-End 操作契約

### 9.1 Personal

1. Cognito で登録・確認・ログイン。
2. `/api/me` を取得。
3. personal workspace を選択。
4. work/chapter/episode を作成。
5. full story を保存。
6. 必要なら StoryAI。
7. entity を作成、保存、preview、confirm。
8. skeleton を enqueue。
9. completion 後 pages を refresh。
10. story apply を enqueue。
11. panel entities/dialogue/composition/background を確認。
12. blocker 0 を確認。
13. page generation を enqueue。
14. completed image を確認。
15. confirm または input 修正後に current input から regenerate。
16. export/share。

### 9.2 Organization

1. personal account で login。
2. workspace invitation accept または organization create。
3. organization workspace を選択。
4. `/api/me` membership と role を再取得。
5. organization query 付きで works を取得。
6. content capability がある role だけ編集。
7. organization credits を表示・消費。
8. billing capability のある owner/billing だけ Web の organization purchase/portal を開く。
9. job、asset、audit を organization scope で処理。
10. personal へ戻したら personal cache/selection に切り替える。

### 9.3 Long job recovery

1. enqueue response の job ID を Backend recent jobs と local cache に記録。
2. app background。
3. foreground で `/api/jobs/:id` または list を再取得。
4. completed なら関連 query invalidate。
5. failed/refunded/canceled を区別。
6. user input は保持。

## 10. 実装順序

### Phase 0: Repository recovery

1. Mobile を Git 追跡
2. syntax error 修正
3. mojibake 修正
4. CI 追加
5. typecheck/export green

### Phase 1: Security and tenancy

1. shared API contract
2. workspace-scoped query keys/selection
3. balloon org query
4. personal/org billing 分離
5. StoreKit / Play Billing server verification と idempotent ledger
6. role capability
7. auth refresh single-flight

### Phase 2: Core creator flow

1. Story IA
2. Character latest UI/state
3. generation readiness と atomic save-and-generate
4. Page blockers/layout/panel editor
5. image cache/thumbnail
6. server-side export

### Phase 3: Organization

1. invite deep link
2. members/roles/invites
3. org billing/usage/audit

### Phase 4: Jobs and resilience

1. job list/cancel/hide Backend
2. progress
3. foreground recovery
4. push

### Phase 5: Store release

1. account deletion
2. privacy/terms/support
3. icons/splash/screenshots
4. EAS production/submit
5. iOS/Android release E2E

## 11. Test Matrix

### 11.1 Unit

- i18n Japanese/English snapshot
- error mapping
- query key includes organization ID
- payload bounds/null normalization
- dialogue speaker validation
- template/panel deletion selection
- layout template/panel/frame consistency
- token refresh mutex
- selection isolation
- store transaction idempotency/renewal/refund
- safe job error serialization

### 11.2 Component

- login errors
- Story hierarchy create/rename/move/delete
- optional scene
- character import/generate/confirm/delete/modal
- page blocker list
- atomic save-and-generate failure/conflict
- panel reorder/delete
- dialogue add/speaker rules
- billing personal/org switch
- job progress/cancel

### 11.3 API contract

- Backend response fixtures parse with Mobile schemas
- all organization endpoints require valid membership
- viewer/editor/admin/billing/owner matrix
- personal data cannot be read with org ID and vice versa
- balloon organization query
- Web Stripe URL only from Backend and never used as an implicit Mobile consumer purchase fallback
- webhook reflected balance
- Apple/Google receipt validation, notification signature, duplicate delivery, refund
- save-and-generate transaction rollback/outbox recovery
- generation-readiness and generation service use the same blocker helper
- job API never returns raw provider error

### 11.4 E2E

| ID | Scenario | iOS | Android |
|---|---|---:|---:|
| E2E-01 | signup/confirm/login/logout | required | required |
| E2E-02 | token refresh/background | required | required |
| E2E-03 | personal full creation flow | required | required |
| E2E-04 | entity import/generate/confirm | required | required |
| E2E-05 | skeleton/story apply/recovery | required | required |
| E2E-06 | page edit/generate/confirm/export | required | required |
| E2E-07 | insufficient credit/action | required | required |
| E2E-08 | org invitation/new account | required | required |
| E2E-09 | org role permissions | required | required |
| E2E-10 | org credit/billing handoff | required | required |
| E2E-11 | offline/retry/no draft loss | required | required |
| E2E-12 | Japanese/English switch | required | required |
| E2E-13 | deep link cold/warm start | required | required |
| E2E-14 | account deletion | required | required |
| E2E-15 | personal purchase/pending/restore/refund | StoreKit sandbox | Play license test |
| E2E-16 | save-and-generate atomicity/409 conflict | required | required |
| E2E-17 | active job recovery after app restart | required | required |
| E2E-18 | external dialogue is unavailable until balloon flow is complete | required | required |

### 11.5 Visual / accessibility

- 360x800
- 390x844
- iPhone small/large
- Android small/large
- tablet portrait
- text scale 100/150/200%
- dark/light if automatic style is supported。未対応なら dark 固定を設定と申告で一致
- VoiceOver/TalkBack smoke

## 12. Release Gate

次がすべて green になるまで production submit しない。

```bash
bun run test
bun run build
bun run db:check-invariants
npm --prefix apps/web run lint
npm --prefix apps/web run build
npm --prefix apps/mobile ci
npm --prefix apps/mobile run typecheck
npm --prefix apps/mobile run lint
npm --prefix apps/mobile run test
npx --prefix apps/mobile expo export --platform ios
npx --prefix apps/mobile expo export --platform android
```

追加 gate:

- no untracked `apps/mobile`
- no `.env` in Git
- no mojibake scan findings
- no raw provider error in UI
- Cognito callback/logout URLs verified
- AASA/assetlinks verified
- Stripe test/live products separated
- App Store / Play product ID と Backend mapping verified
- store purchase server notification/RTDN signature and idempotency verified
- personal/org credit E2E
- crash reporting release tag
- App Store / Play privacy declarations complete

## 13. 実装者チェックリスト

### P0

- [ ] Mobile を Git/CI へ追加
- [ ] TypeScript syntax error 0
- [ ] 日本語文字化け 0
- [ ] API boundary schema validation
- [ ] organization-scoped query/selection
- [ ] balloon organization query
- [ ] personal/org credit and billing separation
- [ ] App Store / Play Billing と server-side purchase verification
- [ ] Cognito universal/app links
- [ ] invitation deep link
- [ ] account deletion
- [ ] page generation blockers
- [ ] generation input snapshot
- [ ] save-and-generate transaction/outbox/idempotency
- [ ] external dialogue を無効化、または balloon finalize 完結
- [ ] safe job error serializer
- [ ] implicit panel truncation 禁止
- [ ] EAS production/store metadata/privacy

### P1

- [ ] Story hierarchy/latest fields
- [ ] optional scenes + delete
- [ ] skeleton overwrite job UX
- [ ] StoryAI apply flow
- [ ] character latest UI
- [ ] preview/confirm/cache
- [ ] layout preview/reading order
- [ ] shared layout template API と panel/frame atomic apply
- [ ] panel/dialogue editor
- [ ] image thumbnail/cache
- [ ] export
- [ ] server-side async PDF/zip export
- [ ] organization management
- [ ] jobs list/cancel/hide
- [ ] unsaved changes
- [ ] offline recovery
- [ ] actionable errors
- [ ] i18n parity
- [ ] accessibility

### P2

- [ ] push notification
- [ ] performance budgets
- [ ] crash/metric dashboards
- [ ] tablet polish

## 14. 監査結果と残存差分の判定方法

実装完了後、次の 4 回の監査を順に行う。

### Audit A: Mobile -> API

Mobile API client の全 method を列挙し、Backend route、auth、organization scope、request/response schema と 1 対 1 で照合する。

### Audit B: API -> Mobile

Backend の user-facing route を列挙し、本書で対象外と明示したもの以外に Mobile の導線があることを確認する。

### Audit C: Web requirement -> Mobile

現在の Web で採用済みの以下を比較する。

- full story input
- optional scene
- story hierarchy
- character free description/import/preview/confirm
- page style reference
- page provenance
- layout reading order/preview
- panel reorder/delete
- generation blocker messages
- personal/org billing separation
- jobs/credits/tutorial

Mobile の画面幅に合わせて表現は変えてよいが、データ契約と安全性を弱めない。

### Audit D: Real-device flow

9.1、9.2、9.3 を iOS/Android で操作し、Network、Backend log、job metadata、credit ledger、S3 asset、UI state を追跡する。

Gap 0 の定義:

- 未分類 route 0
- missing organization scope 0
- raw unvalidated response 0
- untranslated/mojibake text 0
- dead button 0
- disabled reason 不明 0
- destructive action without confirmation 0
- personal/org billing ambiguity 0
- active job lost after restart 0
- P0/P1 open item 0

## 15. 検証証跡

### 15.1 初回監査時点

この仕様を作成した初回監査では、次の事実を確認した。

- `apps/mobile` は Git 未追跡。
- `.env`、`node_modules`、`dist`、`.expo` は `.gitignore` 対象。
- `npm --prefix apps/mobile run typecheck` は `CharactersScreen.tsx` の構文エラーで失敗。
- Mobile CI step は `.github/workflows/ci.yml` に存在しない。
- `userMessages.ts` と複数 UI source に日本語文字化けが存在。
- Mobile balloon methods に organization query がない。
- Backend organization routes は Mobile client/UI にほぼ未実装。
- Backend jobs route は ID 単体取得のみ。
- Account の billing balance は organization selection に追従しない。
- production app links、account deletion、store submit/privacy 設定が未完成。

この証跡から、初回監査時点の Mobile は「試作」であり、production release 判定は不可だった。

### 15.2 2026-07-25 再監査

- `apps/mobile` は lockfile、設定、source、assets、tests を含めて Git 追跡されている。
- clean checkout の `mobile-verify` は install、Expo doctor、contract、typecheck、lint、395 tests、文字化け検査、Android/iOS export を完走した。
- Mobile API 112 methods、Backend 124 routes、Web parity 11 requirements は Audit A/B/C で未分類 0。
- EAS Android preview build 19 は署名済み APK を生成し、build `0b8fa5eb-2dd6-4b9a-9e54-1ab99a72b662` が完了した。
- コードとリポジトリ内設定で解消できる未分類差分は 0。
- production Sentry、Apple Team ID/iOS署名、AASA/assetlinks/legal route の本番配信、store console/sandbox、APNs/FCM、本番AWS、実機 E2E の外部証跡は未完了。

このため、実装監査は完了したが、production release 判定は外部受入証跡が揃うまで不可である。
