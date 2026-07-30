# Android / iPhone リリース残タスクリストと PR #67 監査

最終更新: 2026-07-30

対象リポジトリ: `sh0g0-ikeda/Lyra`

対象PR: [#67 feat(mobile): production-ready Lyra mobile workflow](https://github.com/sh0g0-ikeda/Lyra/pull/67)

進捗: 27件完了 / 409件未完了

実装監査基準: `2412cc3`（PR #104統合後、全CI成功）

## 1. 設計ブリーフ

### 1.1 目的と範囲

この文書は、Lyra MobileをAndroidおよびiPhoneで公開するために残っている作業を、実行可能な単位まで分解したチェックリストである。個人向けのApp Store / Google Play課金、BackendとDBの先行反映、実機E2E、ストア申請、公開後監視を含む。

併せて、PR #67の説明欄だけでは分からない実際の変更範囲、統合リスク、推奨分割単位を記録する。

この文書の作成では、コード、DB、本番AWS、App Store Connect、Google Play Consoleを変更しない。

### 1.2 Spec根拠

- `docs/Lyra_Unified_Spec_v4.md` sections 3–10
- PR #67上の `docs/mobile_completion_gap_spec.md`
- PR #67上の `docs/mobile-completion-requirement-ledger.md`
- PR #67上の `docs/mobile-environment-matrix.md`
- PR #67上の `docs/mobile-store-billing-server-design.md`
- PR #67上の `docs/mobile-native-store-billing-design.md`
- PR #67上の `docs/mobile-production-migration-rollout-design.md`
- PR #67上の `docs/mobile-maestro-e2e-operations.md`

### 1.3 影響レイヤー

- Route / Service / Repository / Domain / Infrastructure
- Worker / Migration / Mobile / Web / Ops
- Cognito / S3 / EAS / App Store Connect / Google Play Console
- App Store Server Notifications / Google Play RTDN

### 1.4 セキュリティ上の前提

- 購入完了は端末の表示ではなく、AppleまたはGoogleによるサーバー検証後だけ確定する。
- クレジット付与、取消、返金はDB transactionと冪等なledgerで処理する。
- Appleのsigned transaction、Googleのpurchase token、サービスアカウント、APNs鍵をログ、証跡、PR本文へ出さない。
- `EXPO_PUBLIC_*` には公開可能なURLとCognito識別子だけを置く。
- Sandbox購入とPlayテスト購入を本番ユーザーの残高へ混入させない。
- personalとorganizationの残高、課金権限、購入導線を混同しない。

### 1.5 テスト方針

この変更自体はドキュメントのみのためTDD対象外とする。実装時は各タスクの「完了条件」に対応する失敗テストを先に追加し、対象テスト、全CI、実機証跡の順で検証する。

### 1.6 委譲方針

このセッションではサブエージェント委譲が禁止されているため、Sol単独でPR差分、仕様、運用状態を照合した。

## 2. 2026-07-30時点の結論

課金コードとMobile UIの骨格は存在するが、Android・iPhoneとも本番ストアへ提出できる状態ではない。

クリティカルパスは次の順序とする。

```text
PR #67の分割とmain同期
  → 独立したステージング環境
  → Backend / migrationを課金OFFで先行反映
  → Apple / Googleの商品と通知設定
  → Sandbox / license-test購入E2E
  → 全Mobile実機E2E
  → production build
  → TestFlight / Play internal
  → ストア審査
  → 段階公開と監視
```

### 2.1 現在のリリース阻害要因

| ID | 状態 | 内容 |
|---|---|---|
| BLOCK-01 | Blocked | PR #67はDraftかつmainと競合している |
| BLOCK-02 | Blocked | PR #67は644ファイル、43コミット、99,879 additions / 2,864 deletionsを含む |
| BLOCK-03 | Blocked | PR #67のheadはmainより43コミット先行する一方、19コミット遅延している |
| BLOCK-04 | Blocked | 現在のmainにはMobile課金Route、Apple/Google検証、購入台帳migrationがない |
| BLOCK-05 | Blocked | 本番DBはmainのmigration 026までで、Mobile用027〜036は未適用 |
| BLOCK-06 | Blocked | 本番SecretにMobile store billingの必須設定がなく、課金は無効 |
| BLOCK-07 | Blocked | EAS production buildはAndroid、iOSとも0件 |
| BLOCK-08 | Blocked | 最新Androidはinternal development APKで、production AABではない |
| BLOCK-09 | Blocked | 最新iOSはSimulator buildで、署名済み実機buildではない |
| BLOCK-10 | Blocked | EAS previewが本番API/Cognitoを参照し、独立したstagingになっていない |
| BLOCK-11 | Blocked | Apple AASA URLはHTTP 200だがJSONではなくWeb SPA HTMLを返している |
| BLOCK-12 | Blocked | StoreKit Sandbox / Play license testerの購入ライフサイクル証跡がない |
| BLOCK-13 | Blocked | Maestro E2E-01〜18を両方の実機で完走した証跡がない |
| BLOCK-14 | Blocked | App Store / Google Play用スクリーンショットとconsole申告証跡がない |
| BLOCK-15 | Partial | Android FCMは準備済みだが、APNs未設定のためPush全体は無効 |
| BLOCK-16 | Partial | Sentryコードはあるが、本番DSN、source map、alert証跡がない |
| BLOCK-17 | Resolved | mainへ`verify`のstrict required checkを管理者にも適用し、CI pending中のPR #91が`BLOCKED`になることを確認 |
| BLOCK-18 | Resolved | PR #87で階層メニュートリガーに残ったフォーカスからのEscape閉鎖を決定化し、反復テストと全CIが成功 |
| BLOCK-19 | Partial | Mobileのアカウント画面で、正常状態やジョブ0件をエラーとして表示するfalse positiveがある |

### 2.2 残タスクの実行区分と優先順

| 優先 | 区分 | 次に進める内容 | 実行条件 |
|---|---|---|---|
| P0 | GitHub安全ゲート | mainのbranch protectionでCI `verify`をrequired checkにする | Repository設定変更の承認 |
| P0 | CI安定化 | 階層メニューE2EのEscape後閉鎖を決定的にし、GitHub ActionsのNode.js 20非推奨警告を解消する | Codexで実行可能 |
| P1 | Mobile表示 | アカウント画面の正常状態・ジョブ0件で表示される2種類のfalse-positive errorを解消する | Codexで実行可能。実エラー表示は維持する |
| P1 | PR-A継続 | `/api/billing/balance`のsubscription summaryをServiceまで監査し、残るRouteを1つずつ契約接続する | Codexで実行可能。各Routeを別PRで扱う |
| P1 | 契約生成 | shared API contractの生成元・生成物・drift check・pagination・API inventoryを監査する | Codexで実行可能 |
| P1 | 差分監査 | PR #67に未取込のmain側19コミットについて影響箇所を列挙する | Codexで実行可能 |
| P2 | Backend分割 | account deletion / upload / export、store billing、job / pushをmigration単位で設計・TDDする | Codexで実行可能。課金は既定OFFを維持 |
| P2 | Mobile分割 | Mobile基盤、Story / Characters / Pages、organization / billing UIを依存順に分割する | Codexで実行可能。Backend契約確定後 |
| P3 | 商品判断 | 対象国、価格、同日公開、Push、offer、upgrade方針を確定する | プロダクトオーナー判断が必要 |
| P3 | 外部設定 | staging、Apple / Google商品、署名、通知、AASA / App Linksを設定する | AWS / Apple / Google / EASへの権限と値が必要 |
| P4 | 実機・審査 | Sandbox / license-test、両OS実機E2E、スクリーンショット、ストア提出を行う | 実機、ストアアカウント、審査対応が必要 |

Codex単独で進める次の順序は、`CI安定化 → PR-A継続 → 契約生成 → main差分監査 → Backend分割 → Mobileアプリ基盤 → アカウント画面のfalse-positive error解消 → Mobile機能分割`とする。アカウント画面の実装はPR #67にだけ存在し、mainへ安全に単独適用できないため、Mobileアプリ基盤の統合後に修正する。外部設定や本番変更は、必要な権限と明示的な実行承認を得てから行う。

## 3. リリース全体タスクリスト

チェックを付ける際は、コードが存在するだけで完了としない。テスト結果、外部consoleのreadback、実機証跡のいずれかを必ず残す。

### Phase 0: リリース方針と商品仕様の確定

#### REL-000 リリース対象

- [ ] 初回リリース対象国・地域を決める
  - 完了条件: App Store / Play Consoleの販売地域と文書上の対象地域が一致する
- [ ] iPhoneとAndroidを同日公開するか、片方を先行するか決める
  - 完了条件: リリース順とロールバック判断者が記録されている
- [ ] 初回リリースでPush通知を提供するか決める
  - 完了条件: 提供しない場合は機能をOFFにし、ストア説明で通知を約束しない
- [ ] organization課金はWeb管理だけとする方針を再確認する
  - 完了条件: Mobile内のorganization画面に個人向けIAPが表示されない
- [ ] personal向けデジタル購入は各プラットフォームのstore billingだけを使う方針を確定する
  - 完了条件: Mobile内にStripe checkoutへの個人向け購入リンクがない

#### REL-010 商品と価格

- [ ] Standardの月額価格、月間クレジット、更新条件を承認する
  - 現行コード: 1,000円 / 月50クレジット
- [ ] Premiumの月額価格、月間クレジット、更新条件を承認する
  - 現行コード: 3,500円 / 月175クレジット
- [ ] 追加10クレジット商品の価格を承認する
  - 現行コード: 220円
- [ ] 追加50クレジット商品の価格を承認する
  - 現行コード: 1,100円
- [ ] 追加150クレジット商品の価格を承認する
  - 現行コード: 3,300円
- [ ] `credits_200` / `credits_1000` / `credits_3000`という内部名と実価格の不一致を許容するか決める
  - 完了条件: App Store / Play Console登録前に恒久的なproduct IDが確定している
- [ ] 日本円以外の価格設定方針を決める
  - 完了条件: 自動換算または地域別価格表のどちらを使うか記録されている
- [ ] 無料トライアル、introductory offer、Play offerの有無を決める
  - 完了条件: Backend付与ルールとconsoleのoffer条件が一致する
- [ ] サブスクのアップグレード・ダウングレード・重複契約方針を決める
  - 完了条件: StandardとPremiumを同時に有効化しないルールがテストされている

### Phase 1: PR #67の分割とmain同期

#### GIT-100 安全なベースライン

- [x] `origin/main`から新しい統合作業ブランチを作る
  - 証跡: PR #76、PR #77、PR #79をそれぞれ最新`origin/main`から作成
- [x] PR #67の変更を機能群ごとに分類する
  - 証跡: この文書の「5.2 実差分の規模」と「5.3〜5.10」
- [ ] main側の未取込19コミットの影響箇所を列挙する
  - 現状: `git rev-list --left-right --count origin/main...origin/feature/mobile-completion`は`19 43`
- [x] 既存のユーザー未コミット変更を別worktreeから隔離する
  - 証跡: `Lyra-mobile-response-contract` worktreeで分割統合を実施
- [x] migration番号027〜036が現在のmainと衝突しないことを確認する
  - 証跡: 2026-07-30時点のmainはmigration 026まで
- [ ] 共有API契約の生成元と生成物を確認する
- [x] PR #67説明欄と実差分の不一致を修正する
  - 証跡: [PR #67](https://github.com/sh0g0-ikeda/Lyra/pull/67)へ監査警告、実差分、分割状況を追記

#### GIT-110 推奨分割PR

- [ ] PR-A: Mobile API contract / response validation / pagination
  - 主な所有: `packages/api-contract`, Mobile schema生成、inventory scripts
  - 完了条件: API inventoryとcontract drift checkが単独でgreen
  - 進捗: 19個目の分割単位をPR #105で検証中。残Route、Mobile生成物、pagination / inventoryが残る
  - [x] response contract guardを本番挙動へ未接続の状態で分離統合
    - 証跡: [PR #76](https://github.com/sh0g0-ikeda/Lyra/pull/76)
  - [x] `/api/me`の現行wire互換性と不正payload拒否を検証して分離統合
    - 証跡: [PR #77](https://github.com/sh0g0-ikeda/Lyra/pull/77)
  - [x] `/api/compositions`の現行wire互換性、S3 key非開示、不正item拒否を検証して分離統合
    - 証跡: [PR #79](https://github.com/sh0g0-ikeda/Lyra/pull/79)
  - [x] `/api/billing/balance`のsubscription summaryと追加wire fieldを先に監査する
    - 証跡: [PR #88](https://github.com/sh0g0-ikeda/Lyra/pull/88)。既存Stripe購読から更新日と解約予定だけを安全に追加し、共通response contractへ接続
    - 境界: Apple / Google Store購読を含む統合summaryはmigration 029適用後のPR-Cで扱い、未導入テーブルへの依存をPR-Aへ持ち込まない
  - [ ] `/api/me`と`/api/compositions`以外のRouteを1つずつ監査して接続
    - [x] Balloon作成・一覧・自動生成・更新のresponse contractを現行7 typeと照合して接続
      - 証跡: [PR #89](https://github.com/sh0g0-ikeda/Lyra/pull/89)。PR #67案に欠けていた`sfx` / `caption`を補正し、既存wireを維持
    - [x] Panel entity assignments保存のresponse contractを現行Domain・入力validator・Web型と照合して接続
      - 証跡: [PR #92](https://github.com/sh0g0-ikeda/Lyra/pull/92)。既存wire、認可、Service、DBを変えず契約外の成功payloadだけをfail closed
    - [x] Panel frame一覧・保存・テンプレート適用のresponse contractを既存DB互換境界で接続
      - 証跡: [PR #93](https://github.com/sh0g0-ikeda/Lyra/pull/93)。request限定の4頂点・座標範囲をresponseへ遡及せず、3 endpointを同一item schemaで保護
    - [x] Panel作成・一覧・並べ替え・更新のresponse contractを入れ子構造まで接続
      - 証跡: [PR #94](https://github.com/sh0g0-ikeda/Lyra/pull/94)。assignment schemaを再利用し、Web wire互換と4 endpointの同一item契約を維持
    - [x] 現行Scene・Entity state作成更新のresponse contractをempty state互換で接続
      - 証跡: [PR #95](https://github.com/sh0g0-ikeda/Lyra/pull/95)。空の任意配列とscene未選択を正常値として維持し、既存5 endpointを保護
    - [x] Entity state一覧GETをService / Repository / SQL / 認可まで独立監査して追加
      - 証跡: [PR #96](https://github.com/sh0g0-ikeda/Lyra/pull/96)。personal/org tenancyを三層で確認し、0件を正常なempty stateとして維持
    - [x] Work・Chapter・Episodeの既存12成功応答を共有contractへ接続
      - 証跡: [PR #97](https://github.com/sh0g0-ikeda/Lyra/pull/97)。既存wireと認証・組織認可を変えず、全12 endpointの契約外Service値をfail closed
    - [x] Story AI改善・page skeleton・collaboration SSE応答を共有contractへ接続
      - 証跡: [PR #98](https://github.com/sh0g0-ikeda/Lyra/pull/98)。prompt・保存・queue・wireを変えず、契約外AI/Service値をencode前に遮断
    - [x] Entity作成・一覧・単体取得・更新の既存4成功応答を共有contractへ接続
      - 証跡: [PR #99](https://github.com/sh0g0-ikeda/Lyra/pull/99)。3 entity typeと任意object fieldを維持し、内部user IDを公開せず全4 endpointを保護
    - [x] Entity参照セット・画像import・生成受付の既存5成功応答を共有contractへ接続
      - 証跡: [PR #100](https://github.com/sh0g0-ikeda/Lyra/pull/100)。署名URL省略と空参照セットを維持し、S3 keyをstrict contractで非公開
    - [x] Page一覧・設定更新の既存2成功応答を共有contractへ接続
      - 証跡: [PR #101](https://github.com/sh0g0-ikeda/Lyra/pull/101)。空scene・null画像・署名URL省略を維持し、生成画像S3 keyをstrict contractで非公開
    - [x] Page job受付・layout同期・Story autofillの既存4成功応答を共有contractへ接続
      - 証跡: [PR #102](https://github.com/sh0g0-ikeda/Lyra/pull/102)。queue・課金・永続化を変えず、全layout template IDとの同期と契約外Service値拒否を検証
    - [x] Generation job取得・停止の4 job type応答を共有contractへ接続
      - 証跡: [PR #103](https://github.com/sh0g0-ikeda/Lyra/pull/103)。部分resultを維持し、root・params・result・候補・story plan resultをstrict検証
    - [x] Organization workspace・member・invitationの既存13成功応答を共有contractへ接続
      - 証跡: [PR #104](https://github.com/sh0g0-ikeda/Lyra/pull/104)。公開previewを最小情報に限定し、Stripe内部ID・生招待tokenをstrict contractで拒否
    - [x] Organization credit balance・billing・invoiceの既存10成功応答を共有contractへ接続
      - 証跡: [PR #105](https://github.com/sh0g0-ikeda/Lyra/pull/105)。0件・null・既存aliasを維持し、Stripe内部field・未知enum・負数をstrict contractで拒否
  - [ ] Mobile側生成物とcontract drift checkを統合
  - [ ] paginationとAPI inventoryを独立監査
- [ ] PR-B: account deletion / upload token / export基盤
  - 主な所有: migrations 027, 031, 032と対応Route/Service/Repository
  - 完了条件: personal/org tenancy、S3 ownership、削除冪等性がgreen
- [ ] PR-C: Mobile store billing Backend
  - 主な所有: migration 029、Apple/Google verifier、purchase service、webhook、ledger
  - 完了条件: 課金OFFで既存Webの挙動を変えず、focused testsがgreen
  - `/api/billing/balance`の購読summaryをApple / Googleの検証済み購入まで拡張し、StripeとStoreで同じwire fieldを返す
- [ ] PR-D: generation job management / cancellation / push outbox
  - 主な所有: migrations 030, 033〜036、Worker、job services
  - 完了条件: cancel/refund/outbox競合テストがgreen
- [ ] PR-E: Mobileアプリ基盤
  - 主な所有: Expo設定、認証、navigation、API client、i18n、error policy
  - 完了条件: clean install、typecheck、lint、test、両OS exportがgreen
- [ ] PR-F: Story / Characters / PagesのMobile UI
  - 主な所有: 各screen、component、dirty state、生成ジョブUI
  - 完了条件: user flow component testsとAPI契約がgreen
- [ ] PR-G: organization / billing UI / store adapter
  - 主な所有: Account、organization管理、`expo-iap` adapter
  - 完了条件: personal/org分離とstore unavailable状態がgreen
  - [ ] 正常状態で「一時的に処理できません。入力は保持されています。少し待って再試行してください。」を表示しない
    - 再現条件: プロフィールと個人ワークスペースが正常に表示され、ユーザー操作上の問題がない状態でも赤い再試行bannerが表示される
    - 完了条件: 正常応答、空データ、未選択の任意データを失敗として集約せず、必須データの取得失敗など実際に再試行が必要な場合だけbannerを表示する
    - 回帰条件: 成功した再取得またはworkspace切替後に古いerror stateを残さず、実際の通信・認証・server errorでは適切な再試行導線を維持する
  - [ ] ジョブ0件で「対象データが見つかりませんでした。画面を更新して選び直してください。」を表示しない
    - 再現条件: 「表示できるジョブはありません。」という正常なempty stateと同時にnot-found errorが表示される
    - 完了条件: ジョブ0件ではempty stateだけを表示し、選択済みジョブが実際に削除された場合など対象消失時だけnot-found errorを表示する
    - テスト条件: ジョブ0件、対象消失、通信失敗、再取得成功の各状態をMobile UI testで区別する
- [ ] PR-H: release / EAS / store metadata / ops docs
  - 主な所有: `eas.json`, `app.json`, store metadata, runbook
  - 完了条件: secretsを含まず、production config guardがgreen

#### GIT-120 統合検証

現在の証跡として、PR #76、#77、#79とmain `d152183`では、Vitest、Bun、PostgreSQL migration / invariant、Backend build、Web lint / build、Playwrightが成功している。ただし最終リリース対象commitは今後変わるため、リリースゲート自体は未完了のままとし、exact commitで再実行する。

- [ ] 残る各分割PRを最新mainから作り直す
  - 完了済み証跡: PR #76、PR #77、PR #79
- [ ] PR間の依存関係をPR本文へ記載する
- [ ] 1PRへ無関係なWeb変更を混ぜない
- [ ] 既存migrationを編集せず、必要な修正は新migrationで行う
- [ ] Backend全Vitestを通す
- [ ] Bun test entrypointを通す
- [ ] migration/invariantをPostgreSQLで通す
- [ ] Backend buildを通す
- [ ] Web lint/buildを通す
- [ ] Playwright smokeを通す
  - [x] Mobile viewportの階層メニューでEscape後の閉鎖待ちを安定化する
    - 現状: PR #82の初回CIで13件中1件が失敗し、再実行と統合後mainでは13件すべて成功
    - 完了条件: 同テストの反復実行でflaky failureが再発しない
    - 証跡: [PR #87](https://github.com/sh0g0-ikeda/Lyra/pull/87)で修正前の決定的失敗、修正後1/1、反復5/5、全Playwright 13/13、CI run `30526596364`の全gate成功を確認
- [ ] Mobile `npm ci`を通す
- [ ] Mobile Expo dependency check / doctorを通す
- [ ] Mobile typecheck / lint / Vitestを通す
- [ ] Mobile Android/iOS exportを通す
- [x] mainのbranch protectionでCI `verify`をrequired status checkにする
  - 完了条件: `verify`がpendingまたはfailedのPRをUI/CLIからmainへmergeできない
  - 証跡: [PR #91](https://github.com/sh0g0-ikeda/Lyra/pull/91)のCI pending中に`mergeStateStatus=BLOCKED`を確認。API readbackは`verify`、`strict=true`、`enforce_admins=true`
- [x] GitHub ActionsのNode.js 20非推奨警告を解消する
  - 完了条件: CIでNode.js 24対応済みActionを使用し、非推奨annotationが0件
  - 証跡: [PR #86](https://github.com/sh0g0-ikeda/Lyra/pull/86)で`actions/checkout@v5`と`actions/setup-node@v5`へ更新し、CI run `30525389957`の全gate成功とannotation 0件を確認
- [ ] 分割PR統合後にPR #67を置換済みとして閉じる

### Phase 2: 独立したstaging環境

#### STG-200 Backendとデータ

- [ ] staging用API環境を用意する
- [ ] staging用PostgreSQLを本番から分離する
- [ ] staging用S3 prefixまたはbucketを本番から分離する
- [ ] staging用SQS queueとDLQを本番から分離する
- [ ] staging用CloudWatch log groupを本番から分離する
- [ ] staging用Secrets Manager secretを用意する
- [ ] stagingで本番ユーザーのID/tokenを受け付けないことを確認する
- [ ] stagingデータの定期削除方針を設定する
- [ ] E2E seed/reset処理を実装する
- [ ] E2E用のpersonalユーザーを作る
- [ ] E2E用のowner/admin/billing/editor/viewerを作る
- [ ] E2E用のorganizationと招待fixtureを作る
- [ ] E2E用の作品、キャラ、ページ、ジョブfixtureを作る
- [ ] E2E用クレジット付与を監査可能な管理処理に限定する

#### STG-210 CognitoとEAS

- [ ] staging専用Cognito app clientを作る
- [ ] staging callback/logout URLを登録する
- [ ] staging招待リンクをproductionと識別できるようにする
- [ ] EAS `preview`のAPI URLをproductionからstagingへ変更する
- [ ] EAS `preview`のCognito clientをstagingへ変更する
- [ ] EAS `preview`にApple Sandbox用の公開設定を入れる
- [ ] EAS `preview`にGoogle license-test用の公開設定を入れる
- [ ] preview buildがproduction originへ接続しないことを通信ログで確認する

#### STG-220 証跡収集

- [ ] request correlation IDをstagingログで検索できるようにする
- [ ] purchase transactionをdigest化して相関できるようにする
- [ ] webhook eventをdigest化して相関できるようにする
- [ ] credit ledgerのbefore/afterを秘密情報なしで証跡化する
- [ ] E2E証跡用HMAC secretをsecret storeへ登録する
- [ ] 証跡にraw transaction、purchase token、認証tokenを含めないテストを追加する

### Phase 3: Backendとmigrationの先行反映

#### DB-300 migration単位の受入確認

- [ ] 027 account deletion requests
  - 完了条件: 冪等な削除状態と唯一ownerの保護を確認
- [ ] 028 page story metadata columns
  - 完了条件: 既存pageの読み書きと生成promptが後方互換
- [ ] 029 mobile store purchase ledger
  - 完了条件: store/external keyとledger eventのunique制約が有効
- [ ] 030 generation job management
  - 完了条件: job一覧、hide、cancel状態が既存jobと互換
- [ ] 031 entity reference upload tokens
  - 完了条件: single-use、期限、MIME/size、user/org bindingが有効
- [ ] 032 episode export jobs
  - 完了条件: export artifactのownershipと期限が有効
- [ ] 033 mobile push token registry
  - 完了条件: token暗号化、hash lookup、logout unregisterが有効
- [ ] 034 mobile push notification outbox
  - 完了条件: terminal jobだけが正しくoutboxへ入る
- [ ] 035 processing generation job cancellation
  - 完了条件: Worker checkpointと返金競合がロックで保護される
- [ ] 036 push notification cancelled guard
  - 完了条件: `cancelled -> failed`が通知を生成しない

#### DB-310 本番migration計画

- [ ] 現在の本番migration履歴が001〜026であることをreadbackする
- [ ] invalid indexがないことを確認する
- [ ] legacy credit linkageをpreflightする
- [ ] cancellation metadataの不整合をpreflightする
- [ ] migration 029制約へ抵触する既存行がないことを確認する
- [ ] RDS backup retentionを確認する
- [ ] PITR可能時刻を記録する
- [ ] API/Workerのロールバックtask definitionを記録する
- [ ] メンテナンス開始・終了の判断者を決める
- [ ] API書き込み停止手順を確認する
- [ ] Workerを0へscaleする手順を確認する
- [ ] inflight generationとDB transactionが0であることを確認する
- [ ] schema-026 preflightをone-off taskで実行する
- [ ] migration 027〜036をone-off taskで実行する
- [ ] deployment invariantsをone-off taskで実行する
- [ ] APIを新task definitionへ更新する
- [ ] Workerを新task definitionへ更新する
- [ ] readiness、queue、DLQ、alarm、ログを確認する
- [ ] ingressとWorkerを再開する
- [ ] migration後のrollback制約を運用記録へ残す

#### API-320 課金OFFでの先行配備

- [ ] `MOBILE_STORE_BILLING_ENABLED=false`でAPIが起動する
- [ ] Mobile purchase routeがdisabled状態を安全に返す
- [ ] 既存WebのStripe課金に変更がない
- [ ] personal/org credit balanceに変更がない
- [ ] Webhook URLへ未検証payloadを送ってもledgerが変化しない
- [ ] 課金無効時に秘密設定の欠落でAPI全体が停止しない
- [ ] 課金有効時は必須設定欠落でfail closedする

### Phase 4: App Store Connect

#### IOS-400 Developer accountとApp record

- [ ] Apple Developer Programの契約状態を確認する
- [ ] Paid Applications Agreementを有効化する
- [ ] 税務情報を完了する
- [ ] 入金口座を完了する
- [ ] Bundle ID `com.lyra.mobile`を登録する
- [ ] In-App Purchase capabilityを有効化する
- [ ] Associated Domains capabilityを有効化する
- [ ] Push Notifications capabilityを有効化するか、初回releaseでは明示的に除外する
- [ ] App Store Connectでアプリrecordを作る
- [ ] numeric Apple App IDを記録する

#### IOS-410 Subscription

- [ ] StandardとPremiumを同じsubscription groupへ作る
- [ ] Standard product IDを確定する
- [ ] Premium product IDを確定する
- [ ] 各商品の日本語表示名を登録する
- [ ] 各商品の英語表示名を登録する
- [ ] 月額期間を設定する
- [ ] 日本円価格を設定する
- [ ] 販売地域を設定する
- [ ] group内のlevel/orderを設定する
- [ ] upgrade/downgrade時の挙動を確認する
- [ ] review screenshotと説明を登録する

#### IOS-420 Consumable credit packs

- [ ] 10クレジットの商品をConsumableとして作る
- [ ] 50クレジットの商品をConsumableとして作る
- [ ] 150クレジットの商品をConsumableとして作る
- [ ] 各product IDを確定する
- [ ] 各商品の日本語・英語名を登録する
- [ ] 各商品の価格と販売地域を設定する
- [ ] 付与クレジット数とBackend catalogの一致を確認する

#### IOS-430 Server Notificationsと検証

- [ ] Sandbox Server Notifications V2 URLを登録する
  - `POST https://app.lyra-editor.com/api/webhooks/mobile-purchases/apple`を本番へ使う場合は、本番でSandboxを許可しない設計との整合を確認する
- [ ] Production Server Notifications V2 URLを登録する
- [ ] Apple test notificationを送信する
- [ ] Backendがtest notificationへ成功応答することを確認する
- [ ] Apple root certificatesを公式配布元から取得する
- [ ] root certificatesを要求形式へ変換する
- [ ] `APPLE_STORE_ROOT_CERTIFICATES_BASE64_JSON`をsecretへ登録する
- [ ] `APPLE_STORE_APP_APPLE_ID`をsecretへ登録する
- [ ] `APPLE_STORE_BUNDLE_ID=com.lyra.mobile`をsecretへ登録する
- [ ] Sandbox用とproduction用の受理ポリシーを分離する

#### IOS-440 Universal Links / AASA

- [ ] Apple Team IDを確定する
- [ ] `APPLE_DEVELOPER_TEAM_ID`をWeb build環境へ設定する
- [ ] AASAをTeam ID + `com.lyra.mobile`で生成する
- [ ] AASAがJSONとして配信される
- [ ] AASAのContent-TypeがJSON互換である
- [ ] AASAがredirectせずHTTP 200を返す
- [ ] callback/logout/invitation以外のpathを許可しない
- [ ] iPhone実機でcold start linkを確認する
- [ ] iPhone実機でwarm start linkを確認する
- [ ] Cognito callback/logoutを実機確認する

#### IOS-450 Signing / APNs

- [ ] iOS distribution certificateを用意する
- [ ] App Store provisioning profileを用意する
- [ ] EASへiOS credentialsを登録する
- [ ] signed device buildを成功させる
- [ ] Pushを提供する場合はAPNs Auth Keyを作る
- [ ] APNs Team ID / Key ID / `.p8`をserver secretへ登録する
- [ ] production push entitlementをbinaryから確認する
- [ ] APNs実配送とtap routingを実機確認する

### Phase 5: Google Play Console

#### AND-500 Developer / app / merchant

- [ ] Play Console developer accountの本人確認を完了する
- [ ] `com.lyra.mobile`でアプリを作る
- [ ] Google payments profileを確認する
- [ ] monetization用merchant設定を完了する
- [ ] app signing keyとupload keyを確認する
- [ ] EASの署名鍵とPlay Consoleのupload keyが一致することを確認する
- [ ] internal testing trackを作る
- [ ] tester listを作る
- [ ] license testerを登録する

#### AND-510 Subscription

- [ ] Standard subscriptionを作る
- [ ] Premium subscriptionを作る
- [ ] 各product IDを確定する
- [ ] 月額auto-renewing base planを作る
- [ ] 日本円価格を設定する
- [ ] 販売地域を設定する
- [ ] grace periodを決める
- [ ] account holdを決める
- [ ] pause / resubscribeの有無を決める
- [ ] Standard/Premium変更時のreplacement modeを確認する
- [ ] 日本語・英語の商品説明を登録する

#### AND-520 One-time consumable products

- [ ] 10クレジット商品を作る
- [ ] 50クレジット商品を作る
- [ ] 150クレジット商品を作る
- [ ] 各product IDを確定する
- [ ] consumableとして再購入できることを確認する
- [ ] 各商品の価格と地域を設定する
- [ ] 付与クレジット数とBackend catalogの一致を確認する

#### AND-530 Play Developer API / RTDN

- [ ] Google Play Developer APIを有効化する
- [ ] 専用service accountを作る
- [ ] service accountへ必要最小限のPlay Console権限を付ける
- [ ] service account JSONをbase64化してsecretへ登録する
- [ ] RTDN用Pub/Sub topicを作る
- [ ] Google Playへtopicを設定する
- [ ] push subscriptionを作る
- [ ] push endpointを設定する
  - `POST https://app.lyra-editor.com/api/webhooks/mobile-purchases/google`
- [ ] Pub/Sub push用OIDC service accountを作る
- [ ] OIDC audienceをendpoint URLと完全一致させる
- [ ] Backendでaudience、email、issuer、署名を検証する
- [ ] Play test notificationを送る
- [ ] RTDN受信後にDeveloper APIで最新状態を取得できることを確認する
- [ ] raw RTDN dataとpurchase tokenをログへ出さないことを確認する

#### AND-540 Android App Links / Firebase

- [ ] production AABの署名fingerprintをreadbackする
- [ ] assetlinks.jsonのpackage/fingerprintと照合する
- [ ] Google Digital Asset Links APIで関連を確認する
- [ ] callback/logout/invitationを実機確認する
- [ ] Firebase client fileがproduction EAS file secretから入ることを確認する
- [ ] 不要なCAMERA / RECORD_AUDIO / SYSTEM_ALERT_WINDOW権限がないことをbinaryで確認する

### Phase 6: Store billingのserver設定

#### BILL-600 Product mapping

- [ ] Appleの2 subscription product IDをserver catalogへ設定する
- [ ] Appleの3 consumable product IDをserver catalogへ設定する
- [ ] Googleの2 subscription product IDをserver catalogへ設定する
- [ ] Googleの3 one-time product IDをserver catalogへ設定する
- [ ] 同一store内にproduct IDの重複がない
- [ ] Mobile bundleへ価格をhard-codeしない
- [ ] Mobileはstoreから取得したdisplay priceだけを表示する
- [ ] 未知product IDをBackendが拒否する
- [ ] Mobile account bindingとstore account bindingを照合する

#### BILL-610 staging設定

- [ ] stagingだけでApple Sandboxを許可する
- [ ] stagingだけでGoogle test purchaseを許可する
- [ ] staging identifier hash secretを32文字以上で生成する
- [ ] Apple/Google検証credentialをstaging secretへ登録する
- [ ] staging APIの起動時config validationを通す
- [ ] staging catalog endpointが10商品の正しいIDを返す
- [ ] store未反映商品をMobileでdisabled表示する

#### BILL-620 production設定

- [ ] production identifier hash secretをstagingと分離する
- [ ] Apple production product IDを本番secretへ登録する
- [ ] Google production product IDを本番secretへ登録する
- [ ] Apple Sandbox許可をfalseにする
- [ ] Google test purchase許可をfalseにする
- [ ] Google service accountを本番secretへ登録する
- [ ] Google Pub/Sub audienceとservice account emailを本番secretへ登録する
- [ ] Apple App ID、bundle ID、root certificatesを本番secretへ登録する
- [ ] secretの値を出さず、必須keyの存在だけをreadbackする
- [ ] 課金有効化前にAPI taskをdry-runする
- [ ] 最終承認までは`MOBILE_STORE_BILLING_ENABLED=false`を維持する

#### BILL-630 ledger / entitlement

- [ ] active subscriptionでmonthly creditsを一度だけ付与する
- [ ] renewalで次期間分を一度だけ付与する
- [ ] duplicate client verifyで二重付与しない
- [ ] duplicate Apple notificationで二重付与しない
- [ ] duplicate Google RTDNで二重付与しない
- [ ] pendingではクレジットを付与しない
- [ ] cancelledで新規付与しない
- [ ] expiredでentitlementを失効する
- [ ] refunded credit packを一度だけ取り消す
- [ ] 残高不足時のreversal方針を確認する
- [ ] transaction ID、purchase tokenをDBへ平文保存しない
- [ ] store purchaseとcredit ledgerを同一transactionで更新する
- [ ] Stripe consumer subscriptionとstore subscriptionの重複契約を防ぐ
- [ ] organization残高へpersonal store purchaseを付与しない

### Phase 7: 課金実機E2E

#### BILL-E2E-700 共通準備

- [ ] 端末へrelease-like standalone buildを入れる
- [ ] iOS Sandbox testerを秘密管理する
- [ ] Android license testerを秘密管理する
- [ ] tester accountをshell history、YAML、証跡へ書かない
- [ ] E2E run IDを発行する
- [ ] provider、webhook、ledgerの相関証跡を収集する
- [ ] 証跡JSONへHMAC署名する
- [ ] purchase proofをSHA-256 digestだけで記録する

#### BILL-E2E-710 iPhone / StoreKit Sandbox

- [ ] Standard新規購入
- [ ] Premium新規購入
- [ ] StandardからPremiumへの変更
- [ ] ユーザーキャンセル
- [ ] pending / interrupted purchase
- [ ] 購入復元
- [ ] subscription renewal
- [ ] subscription cancellation
- [ ] subscription expiration
- [ ] credit pack購入
- [ ] 同じcredit packの再購入
- [ ] refund
- [ ] client verifyとnotificationの順序反転
- [ ] app強制終了後の購入復旧
- [ ] 別Lyraアカウントへのpurchase横取り拒否
- [ ] finish失敗後の安全な再試行

#### BILL-E2E-720 Android / Play license test

- [ ] Standard新規購入
- [ ] Premium新規購入
- [ ] StandardからPremiumへの変更
- [ ] ユーザーキャンセル
- [ ] pending purchase
- [ ] decline / grace period
- [ ] account hold
- [ ] 購入復元
- [ ] subscription renewal
- [ ] subscription cancellation
- [ ] subscription expiration
- [ ] credit pack購入
- [ ] 同じcredit packの再購入
- [ ] refund / revoke
- [ ] client verifyとRTDNの順序反転
- [ ] app強制終了後の購入復旧
- [ ] 別Lyraアカウントへのpurchase横取り拒否
- [ ] acknowledge/consume失敗後の安全な再試行

### Phase 8: Mobile全体の実機受入

各行についてAndroidとiPhoneの両方を完了する。

| E2E | シナリオ | Android | iPhone |
|---|---|---|---|
| E2E-01 | signup / confirm / login / logout | [ ] | [ ] |
| E2E-02 | token refresh / background | [ ] | [ ] |
| E2E-03 | personal full creation flow | [ ] | [ ] |
| E2E-04 | entity import / generate / confirm | [ ] | [ ] |
| E2E-05 | skeleton / story apply / recovery | [ ] | [ ] |
| E2E-06 | page edit / generate / confirm / export | [ ] | [ ] |
| E2E-07 | insufficient credit / action | [ ] | [ ] |
| E2E-08 | organization invitation / new account | [ ] | [ ] |
| E2E-09 | organization role permissions | [ ] | [ ] |
| E2E-10 | organization credit / billing handoff | [ ] | [ ] |
| E2E-11 | offline / retry / no draft loss | [ ] | [ ] |
| E2E-12 | Japanese / English switch | [ ] | [ ] |
| E2E-13 | deep link cold / warm start | [ ] | [ ] |
| E2E-14 | account deletion | [ ] | [ ] |
| E2E-15 | purchase / pending / restore / refund | [ ] | [ ] |
| E2E-16 | save-and-generate atomicity / 409 | [ ] | [ ] |
| E2E-17 | active job recovery after restart | [ ] | [ ] |
| E2E-18 | external dialogue Web handoff | [ ] | [ ] |

#### QA-800 連続実行

- [ ] Androidで主要フローを連続3回完走する
- [ ] iPhoneで主要フローを連続3回完走する
- [ ] 日本語で全画面の文字化けがない
- [ ] 英語で未翻訳キーが表示されない
- [ ] 200% text sizeで操作不能にならない
- [ ] VoiceOverで主要操作を完走できる
- [ ] TalkBackで主要操作を完走できる
- [ ] safe areaに操作ボタンが隠れない
- [ ] 4G相当でthumbnail、full image、uploadを計測する
- [ ] 長時間利用時のmemory pressureを計測する
- [ ] app background/foregroundでdraftとjob追跡を失わない
- [ ] account/workspace切替で画像cacheとquery cacheが混ざらない

### Phase 9: ストア提出資料

#### STORE-900 共通

- [ ] アプリアイコンを最終承認する
- [ ] splashを最終承認する
- [ ] 日本語アプリ名・説明を最終承認する
- [ ] 英語アプリ名・説明を最終承認する
- [ ] support URLがHTTP 200を返す
- [ ] privacy URLがHTTP 200を返す
- [ ] terms URLがHTTP 200を返す
- [ ] account deletion URLが削除方法を説明する
- [ ] AI生成物の確認責任を説明する
- [ ] personal IAPとorganization Web billingの違いをreview notesへ書く
- [ ] review用アカウントをstoreの保護フィールドだけへ登録する
- [ ] review用fixtureを削除されないように管理する
- [ ] スクリーンショットに個人情報、token、support IDを含めない

#### STORE-910 App Store

- [ ] 必要なiPhoneサイズのスクリーンショットを作る
- [ ] iPad対応を維持するならiPadスクリーンショットを作る
- [ ] App Privacy questionnaireを回答する
- [ ] age ratingを回答する
- [ ] export complianceを回答する
- [ ] account deletionの場所をreview notesへ書く
- [ ] subscriptionとcredit packの確認手順を書く
- [ ] IAP商品をアプリversionと一緒に審査へ出す
- [ ] reviewerが生成機能を確認できるクレジットを用意する

#### STORE-920 Google Play

- [ ] phone screenshotsを作る
- [ ] feature graphicを作る
- [ ] short / full descriptionを登録する
- [ ] Data safety formを回答する
- [ ] account deletion URLを登録する
- [ ] content rating questionnaireを回答する
- [ ] ads declarationを回答する
- [ ] target audienceを回答する
- [ ] financial features declarationの対象外を確認する
- [ ] app accessへreview accountを登録する
- [ ] Play billingを使うことをlistingとアプリ内表示で一致させる

### Phase 10: production buildと段階公開

#### BUILD-1000 共通

- [ ] 全分割PRをmainへ統合する
- [ ] exact release commitを記録する
- [ ] app versionを確定する
- [ ] Android versionCodeを確定する
- [ ] iOS buildNumberを確定する
- [ ] production EAS環境変数をreadbackする
- [ ] production buildへlocalhost / HTTP / test identifierがない
- [ ] Sentry DSNをproduction EASへ設定する
- [ ] Sentry auth token / org / projectをsensitive secretへ設定する
- [ ] source map uploadを確認する
- [ ] sanitized test eventを確認する

#### BUILD-1010 Android

- [ ] `eas build --platform android --profile production`を実行する
- [ ] AABのpackage nameを確認する
- [ ] AABの署名を確認する
- [ ] merged manifestを確認する
- [ ] App Linksを確認する
- [ ] Google Play Billing permission/libraryを確認する
- [ ] internal trackへsubmitする
- [ ] internal testerでinstall/updateを確認する
- [ ] Play pre-launch reportを確認する
- [ ] crash / ANR / permission warningを解消する

#### BUILD-1020 iPhone

- [ ] `eas build --platform ios --profile production`を実行する
- [ ] IPAのbundle IDを確認する
- [ ] signing identityとprovisioningを確認する
- [ ] Associated Domains entitlementを確認する
- [ ] IAP capabilityを確認する
- [ ] Pushを提供する場合はAPNs entitlementを確認する
- [ ] TestFlightへsubmitする
- [ ] internal testerでinstall/updateを確認する
- [ ] TestFlight buildでlogin、IAP、restore、deep linkを確認する

#### RELEASE-1030 課金有効化

- [ ] production product catalogをreadbackする
- [ ] Apple production notificationの到達確認をする
- [ ] Google production RTDNの到達確認をする
- [ ] production verifier credentialの疎通を確認する
- [ ] `MOBILE_STORE_BILLING_ENABLED=true`を設定する
- [ ] API taskを新revisionへ更新する
- [ ] catalog endpointが各storeの5商品を返す
- [ ] 既存Web Stripe課金が正常である
- [ ] organization billingがWebへ限定されている
- [ ] 課金有効化時刻とrollback task definitionを記録する

#### RELEASE-1040 段階公開

- [ ] App Storeをmanual releaseにする
- [ ] Google Playをinternalからclosed testingへ進める
- [ ] closed testingでproduction billing smokeを行う
- [ ] 審査提出直前に全URLとreview accountを再確認する
- [ ] App Storeへ審査提出する
- [ ] Google Playへ審査提出する
- [ ] rejection質問への回答担当者を決める
- [ ] 承認後の公開日時を決める
- [ ] 段階公開率を決める
- [ ] incident時の公開停止手順を確認する

### Phase 11: 公開後監視

#### OPS-1100 課金監視

- [ ] Apple notificationの成功率を監視する
- [ ] Google RTDNの成功率を監視する
- [ ] provider verification失敗率を監視する
- [ ] duplicate purchase event件数を監視する
- [ ] pending滞留件数を監視する
- [ ] purchase reversal失敗件数を監視する
- [ ] store purchaseとcredit ledgerの不整合を日次確認する
- [ ] refund/revoke時の残高不足を監視する
- [ ] support用の購入調査手順を用意する
- [ ] raw proofを要求せずstore order情報で調査する手順を用意する

#### OPS-1110 Mobile品質

- [ ] crash-free usersを監視する
- [ ] ANRを監視する
- [ ] auth callback失敗率を監視する
- [ ] upload/export失敗率を監視する
- [ ] generation job失敗率とrefundを監視する
- [ ] push token登録失敗率を監視する
- [ ] store reviewとsupport問い合わせを日次確認する
- [ ] 緊急OTAで変更できる範囲とnative rebuild必須範囲を明確にする

## 4. リリース完了条件

以下をすべて満たすまで、Mobileを「本番公開完了」としない。

- [ ] PR #67の内容がレビュー可能な単位でmainへ統合済み
- [ ] 本番migration 027〜036とinvariantが成功
- [ ] API / Worker rolloutがhealthy
- [ ] Apple/Google product mappingが一致
- [ ] StoreKit SandboxとPlay license testの課金ライフサイクルがgreen
- [ ] E2E-01〜18がAndroid/iPhoneの両実機でgreen
- [ ] signed production AAB/IPAがexact main commitから作成済み
- [ ] App Store / Play Consoleのprivacy、deletion、rating、billing申告が完了
- [ ] TestFlight / Play internalでrelease buildを確認済み
- [ ] 課金、auth、queue、ledger、crashの監視とrollback手順が準備済み
- [ ] ストア審査承認後、段階公開と初動監視を完了

## 5. PR #67の内容

### 5.1 PR概要

| 項目 | 値 |
|---|---|
| タイトル | `feat(mobile): production-ready Lyra mobile workflow` |
| 状態 | Open / Draft / Conflicting |
| Base | `main` |
| Head | `feature/mobile-completion` |
| Head commit | `4ca174fcef20ef9a7bc638a5d4b444214c1bf06c` |
| コミット数 | 43 |
| 変更ファイル | 644 |
| 追加 | 99,879行 |
| 削除 | 2,864行 |
| mainとの差 | 43 ahead / 19 behind |

PR説明欄には当初「既存Web版とバックエンドには変更を加えていません」と記載されていた。しかし実差分にはBackend、Web、Worker、migration、CI、Dockerfileが含まれるため、2026-07-30に監査警告、実差分、分割統合状況を追記して訂正した。

### 5.2 実差分の規模

| 領域 | ファイル数 | 追加 | 削除 | 主な内容 |
|---|---:|---:|---:|---|
| `apps/mobile` | 304 | 58,873 | 0 | Expoアプリ、UI、API client、IAP、E2E、store metadata |
| `tests` | 123 | 11,877 | 344 | Backend、migration、Mobile関連テスト |
| `docs` | 42 | 9,128 | 46 | Mobile仕様、監査台帳、runbook |
| `src/services` | 34 | 3,180 | 138 | 課金、削除、upload、export、job、push、page |
| `src/routes` | 21 | 1,602 | 181 | Mobile purchase、webhook、account、upload、export、push |
| `src/repositories` | 19 | 4,006 | 152 | purchase ledger、削除、job、upload、export、push |
| `src/infrastructure` | 17 | 2,623 | 0 | Apple、Google、APNs、FCM、S3、暗号 |
| `src/domain` | 17 | 759 | 4 | store purchase、pagination、push、export型 |
| `migrations` | 10 | 531 | 0 | migration 027〜036 |
| `apps/web` | 10 | 368 | 16 | Mobile association、legal/static対応など |
| `packages/api-contract` | 3 | 1,952 | 0 | Mobile API schema/type/payload |
| `worker` | 2 | 62 | 3 | cancellation、export、push連携 |
| `.github` | 1 | 75 | 3 | Mobile CI gate |

### 5.3 Mobileアプリ本体

PR #67はExpo 57 / React Native 0.86ベースの新しいMobileアプリを追加する。

主な画面:

- Story
- Characters
- Pages
- Account
- Guide
- Invitation
- organization management modal

主な共通機能:

- Cognito authorization code + PKCE
- SecureStoreによるtokenと選択状態の保存
- personal / organization workspace切替
- 日本語 / 英語
- offline表示とretry
- dirty stateの保存 / 破棄 / cancel
- background / foreground復旧
- error boundaryとuser-facing error mapping
- deep link / universal link / app link
- Sentry連携

### 5.4 Story / Characters / Pages

Story:

- 作品、章、話、シーンの選択・作成・更新・削除
- 階層sheetとコンテキストメニュー
- Story AI
- ページ骨格生成とストーリー自動入力
- sceneはoptionalとして扱う
- 長時間job、cancel、retry、foreground復旧

Characters:

- キャラ作成・更新・削除
- 参照画像のimport、preview、confirm
- direct upload token方式
- 生成blockerと解決action
- active candidate管理
- 服装と状態管理

Pages:

- ページ、コマ、frame、セリフ編集
- layout templateとframe preview
- page generation readiness
- transactional save-and-generate
- page image confirm / reopen / regenerate
- thumbnail/full image分離
- PDF/ZIP export job
- external dialogueのWeb handoff
- ページ設計UIのPages上部への移動

### 5.5 Account / organization

- personal balanceとplan表示
- organization balanceとbillingの分離
- owner/admin/billing/editor/viewer capability
- organization作成・編集
- member、invitation、role、remove
- usage、audit、invoice、CSV
- billing checkout / portalのWeb handoff
- webhook反映後だけ成功とする確認polling
- account deletion preview / execute
- active store subscriptionの外部解約案内

### 5.6 Mobile store billing

Mobile:

- `expo-iap`
- store product取得
- Apple `appAccountToken`
- Google `obfuscatedAccountId`
- purchase listener / error listener
- server verify後の`finishTransaction`
- consumable / subscriptionの区別
- purchase restore
- pending / cancelled / retryable error表示

Backend:

- Apple signed transaction検証
- App Store Server Notifications V2検証
- Google Play Developer API検証
- Google Pub/Sub OIDC検証
- Google RTDN処理
- server-owned product allowlist
- store purchase repository
- credit ledgerとのtransaction
- duplicate eventの冪等化
- pending / active / cancelled / expired / refunded / revoked
- Stripe subscriptionとの重複防止

### 5.7 Backend追加機能

- account deletion orchestration
- entity reference direct upload
- cursor pagination
- page thumbnail
- async episode export
- generation job list / hide / cancellation
- processing中jobの協調cancel
- mobile push token registration
- APNs / FCM delivery
- push outbox
- shared Mobile API response contract
- page save-and-generate atomicity
- page generation readiness

### 5.8 migration 027〜036

| Migration | 内容 |
|---|---|
| 027 | account deletion requests |
| 028 | page story metadata |
| 029 | mobile store purchase ledger |
| 030 | generation job management |
| 031 | entity reference upload tokens |
| 032 | episode export jobs |
| 033 | mobile push token registry |
| 034 | mobile push notification outbox |
| 035 | processing job cancellation |
| 036 | cancelled job push guard |

### 5.9 CI / release / ops

- Mobile `npm ci`
- Expo dependency check / doctor
- Mobile typecheck / lint / Vitest
- mojibake guard
- Android/iOS Expo export
- Mobile API inventory
- Backend route inventory
- Web/Mobile parity inventory
- EAS development / preview / production profiles
- Android Firebase file secret
- App Store metadata
- Google Play listing / Data Safety
- Maestro E2E-01〜18
- production migration imageとrunbook

### 5.10 PR #67の主なリスク

1. 1つのPRへMobile、Backend、DB、Web、Worker、CI、Opsが同居している。
2. mainと競合し、19コミット分の本番変更を取り込めていない。
3. ~~PR説明欄が実差分と一致しない。~~ 2026-07-30に監査警告と実差分を追記済み。
4. migration 10本を一度に導入するため、レビューとrollback判断が難しい。
5. 既存Web/API互換fallbackが多く、Backend更新後も不要な分岐が残り得る。
6. 最新headそのものにはPR check rollupがない。
7. production AAB/IPAとストア課金実機証跡がない。
8. previewがproductionを参照しているため、Sandbox E2Eの安全な実行先がない。
9. Apple Team ID、AASA、iOS署名、APNsが未完了。
10. 課金Backendをmainへ出す前にstore商品を公開すると、購入後の検証不能が起こり得る。

## 6. 公式リファレンス

- [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [Apple: Overview of testing in sandbox](https://developer.apple.com/help/app-store-connect/test-in-app-purchases/overview-of-testing-in-sandbox)
- [Apple: Enabling App Store Server Notifications](https://developer.apple.com/documentation/appstoreservernotifications/enabling-app-store-server-notifications)
- [Apple: Offering account deletion in your app](https://developer.apple.com/support/offering-account-deletion-in-your-app/)
- [Google Play Payments policy](https://support.google.com/googleplay/android-developer/answer/9858738)
- [Google Play Billing testing](https://developer.android.com/google/play/billing/test)
- [Google Play RTDN reference](https://developer.android.com/google/play/billing/rtdn-reference)
- [Google Play account deletion requirements](https://support.google.com/googleplay/android-developer/answer/13327111)
