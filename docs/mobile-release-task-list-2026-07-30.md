# Lyra Mobile 初回リリース タスクリスト

最終更新: 2026-08-02

対象: Android / iPhone の初回ストア公開

進捗: 105件中48件完了 / 57件未完了

未完了の担当内訳: AI単独0件 / AI準備＋外部確認34件 / 人間・外部必須23件

## 0. このリストの範囲

初回リリースは、現在Mobileに表示されている制作・アカウント・ガイドUIを対象とする。審査対応以外の新規機能は追加しない。

- 個人ユーザー向けのApp Store / Google Play購入UI
- アカウント削除UI
- AI送信前同意とAI生成物のアプリ内通報（ストア審査で必要な最小UI）

それ以外の新規UI・Backend機能は初回リリースへ追加しない。既にmainに存在するBackend、migration、DB fieldは、Web・保存済みデータ・内部整合性が依存する可能性があるため削除しない。未使用機能は既定OFFまたはMobile未接続のまま維持する。

旧487件の詳細監査は[履歴文書](./mobile-release-task-list-full-audit-2026-08-01.md)へ移した。履歴文書のcheckboxは現在の残件数へ算入しない。

### 担当区分

- `[AI]`: リポジトリ内の実装・テスト・文書だけで完了できる。
- `[共同]`: AIが準備・検証できるが、外部Console、秘密情報、署名、実機などが必要。
- `[人間]`: 商品・法務・公開判断、本人確認、金融契約、実機操作が完了条件。

## 1. 範囲固定と不要機能の整理

- [x] `[AI]` 現行Mobileの可視UIと実際に呼ぶAPIを4タブ単位で棚卸しする。
- [x] `[AI]` 新規UIを個人向け購入とアカウント削除の2つだけに固定する。
- [x] `[AI]` 現行mainに表示されるPanel / Frame / Balloon / 画像・PDF・ZIP出力を審査対象に含め、審査対応で配置や色を変更しない。
- [x] `[AI]` ページ設定から`balloon_only` / `mixed`の選択UIを除去する。
- [x] `[AI]` 保存済み`dialogue_mode`、API schema、DB fieldを維持し、別設定の保存時に未変更値を送らないことをテストする。
- [x] `[AI]` 旧タスクリストを履歴化し、active checklistから将来機能を外す。
- [ ] `[人間]` Standard / Premium subscriptionと10 / 50 / 150 credit商品の価格・付与量・販売国を承認する。
- [ ] `[人間]` iOS / Androidの公開順、公開日、段階公開率、初動監視責任者を決める。

### 初回リリースから外すもの

- Work削除・並べ替え、Scene削除、Character削除。
- entity referenceのpresigned direct-upload client、`costume_ref_id`選択、reference削除。
- 外部dialogue handoff、composition galleryなど現行UIにない新規導線。
- job cancel / hide、Push通知、APNs / FCM、push outbox。
- organization向けStripe checkout / plan変更 / billing portalのMobile導線。既存workspace・メンバー・請求状態・invoice表示は維持する。
- dormant機能専用の本番設定、実機E2E、監視、新規Backend開発。

## 2. Mobile UI実装

- [x] `[AI]` 個人workspaceのアカウント画面へ購入セクションを追加する失敗テストを書く。
- [x] `[AI]` store catalog取得中・取得失敗・商品なしを安全に表示する。
- [x] `[AI]` store提供のdisplay priceだけを表示し、価格をコードへ固定しない。
- [x] `[AI]` store未反映商品をdisabled表示し、購入開始を拒否する。
- [x] `[AI]` organization workspaceでは個人購入UIを表示しない。
- [x] `[AI]` iOS native purchase adapterを追加し、購入proofを画面やログへ出さない。
- [x] `[AI]` Android native purchase adapterを追加し、purchase tokenを画面やログへ出さない。
- [x] `[AI]` server verification成功後だけ完了表示と残高更新を行う。
- [x] `[AI]` cancel、pending、通信失敗、検証失敗、再試行を区別して表示する。
- [x] `[AI]` 購入復元を冪等に実行し、二重付与しないUIフローを作る。
- [x] `[AI]` アカウント画面へアカウント削除入口と失敗テストを追加する。
- [x] `[AI]` 削除preview、blocker、影響範囲を表示する。
- [x] `[AI]` 明示acknowledgement後だけ削除を開始できるようにする。
- [x] `[AI]` 削除処理中・失敗・再試行・完了を表示し、完了後にsessionとlocal cacheを消す。
- [x] `[AI]` 購入・復元・削除のcomponent / domain / API contract testを通す。
- [x] `[AI]` Mobile Vitest、typecheck、lint、contract drift checkを通す。
- [x] `[AI]` Android / iOSのExpo exportを両方通す。

## 3. 既存Backendの出荷安全確認（新規機能開発なし）

- [x] `[AI]` 今回のUI整理差分にRoute / Service / Repository / Domain / migration変更がないことを確認する。
- [x] `[AI]` 既存のmobile purchase APIがflag OFF時にmountされず、ON時も設定不足でfail closedになるテストを通す。
- [x] `[AI]` 既存のaccount deletion APIがflag OFF時に無効で、ownership・blocker・acknowledgementを検証するテストを通す。
- [ ] `[共同]` stagingで連番migrationとDB invariantを実行し、既存Web・Worker・Mobile用データを壊さないことを確認する。
- [ ] `[共同]` Apple / Googleの実product ID allowlistとverifier credentialをsecret storeへ設定し、値を出さずにreadbackする。
- [ ] `[共同]` account deletion workerのIAM、queue、secret、recoveryをstagingで確認する。
- [ ] `[共同]` provider event、verification、ledger、refund / reversalを相関でき、raw proofやsecretがログへ残らないことを確認する。

## 4. Apple外部設定

- [ ] `[人間]` Apple Developer / Paid Applications契約と税務・銀行情報を完了する。
- [ ] `[人間]` production Bundle IDとApp Store Connect app recordを確定する。
- [ ] `[人間]` Standard / Premium subscriptionを同一subscription groupへ登録する。
- [ ] `[人間]` 10 / 50 / 150 credit商品をConsumableとして登録する。
- [ ] `[共同]` App Store Server Notificationsとserver verifier credentialを設定する。
- [ ] `[共同]` Cognito callback / logout URLに`lyra-mobile://auth/mobile/*`が登録済みで、実機のlogin / logoutが完了することを確認する。iOS Associated Domainsは初回buildから除外済みで、AASA公開までは再追加しない。
- [ ] `[共同]` distribution certificate、provisioning profile、EAS production credentialを設定する。

## 5. Google Play外部設定

- [ ] `[人間]` Play Console developer / merchant設定とapp recordを完了する。
- [ ] `[人間]` production package名、Play App Signing、公開国を確定する。
- [ ] `[人間]` Standard / Premium subscriptionを登録する。
- [ ] `[人間]` 10 / 50 / 150 credit商品を再購入可能なone-time productとして登録する。
- [ ] `[共同]` Google Play Developer API service accountとRTDNを設定する。
- [ ] `[共同]` App Links、assetlinks、production signing fingerprint、Cognito URLを確認する。
- [ ] `[共同]` Android signing keyとEAS production credentialを設定する。

## 6. 購入・削除の実機受入

- [ ] `[共同]` iPhone Sandboxで商品名・store価格・購入可否を確認する。
- [ ] `[共同]` Android license testで商品名・store価格・購入可否を確認する。
- [ ] `[共同]` 両OSでsubscriptionとconsumable購入がserver verification後だけ反映されることを確認する。
- [ ] `[共同]` 両OSでcancel、pending、通信断、再試行、復元を確認する。
- [ ] `[共同]` 同じtransaction / purchase tokenの再送で二重付与されないことを確認する。
- [ ] `[共同]` notification再送、取消、refund / reversalがledgerと残高へ一度だけ反映されることを確認する。
- [ ] `[共同]` organization workspaceへ個人購入が付与されないことを確認する。
- [ ] `[共同]` 両OSでアカウント削除のblocker、acknowledgement、処理中、完了後sign-outを確認する。

## 7. 現在表示されているUIの最小実機スモーク

- [ ] `[共同]` sign-up、login、token refresh、logout、cold / warm callbackを両OSで確認する。
- [ ] `[共同]` 物語でWork選択、Chapter / Episode作成・改名・移動・削除、Episode本文保存を確認する。
- [ ] `[共同]` キャラで作成・編集、state編集、端末画像import、reference生成・確認を確認する。
- [ ] `[共同]` ページでScene / Page設定、story自動入力、Panel追加・削除・並べ替え・編集を確認する。
- [ ] `[共同]` ページ画像の生成・再生成・表示、dirty保存、失敗retry、background復帰を確認する。
- [ ] `[共同]` アカウントでprofile、残高、job履歴、既存workspace切替、logoutを確認する。
- [ ] `[人間]` 日本語 / 英語、safe area、文字拡大、VoiceOver / TalkBackの最終表示を確認する。

## 8. 署名build・ストア提出・公開

- [x] `[AI]` release候補commitでBackend、DB、Web、Playwright、Mobileのrequired CIを通す。
- [x] `[共同]` 本番migration / invariant、API / Worker readiness、billing / deletion flagの初期OFFを確認する。
- [ ] `[共同]` release候補commitから署名済みAndroid AABをbuildし、package / signing / App Linksを検査する。
- [ ] `[共同]` release候補commitから署名済みiOS IPAをbuildし、Bundle ID / entitlement / Associated Domainsを検査する。
- [ ] `[人間]` Play internal trackとTestFlightでinstall / updateを確認する。
- [ ] `[人間]` privacy policy、terms、support、account deletion説明の公開URLと法務内容を承認する。
- [ ] `[人間]` App Store privacy、削除、年齢、輸出、IAP review情報を申告する。
- [ ] `[人間]` Play Data Safety、削除、content rating、listingを申告する。
- [ ] `[共同]` screenshots、review account、review notes、再現手順をsecretなしで準備する。
- [ ] `[人間]` App StoreとGoogle Playへ提出し、審査結果へ対応する。
- [ ] `[人間]` 段階公開を開始し、停止・rollback判断を行う。
- [ ] `[共同]` 公開後に認証、購入検証、ledger、account deletion、生成job、crashを初動監視する。

### 2026-08-01 本番反映記録

- release merge commit: `16586686340cd4c1401c510e5302d10d8843b458`
- ECR image: linux/arm64、`sha256:42fe1259b8933eec1ec06770dfa883d31edee7d8e0efb1dd9fd6386c0093a03a`
- rollback task definition: API `103`、generation worker `63`
- active task definition: API `104`、generation worker `64`
- manual snapshot: `lyra-prod-pre-027-039-20260801-1522` (`available`、encrypted)
- migration: 027-039を順番どおり適用、移行前46項目・移行後65項目・稼働再開後65項目はいずれも違反0
- readiness: API / Workerとも1/1、ALB healthy、generation queue / DLQとも0
- flags: `AUTO_RUN_MIGRATIONS=false`、`MOBILE_STORE_BILLING_ENABLED=false`、`ACCOUNT_DELETION_ENABLED=false`、`EPISODE_EXPORT_ENABLED=false`

## 9. Apple / Google リジェクト要因監査と是正

根拠: Apple App Review Guidelines 1.2 / 3.1.1 / 3.1.3 / 5.1.1 / 5.1.2、Google Play AI-Generated Content / Payments / User Data / Account Deletion policy。

- [x] `[AI]` Apple / Googleの現行審査要件、公開法務URL、Mobile metadata、build設定、可視UIを監査する。
- [x] `[AI]` 監査設計を`docs/mobile-store-review-rejection-remediation-design-2026-08-02.md`へ記録し、Backend変更なし・UI位置/色維持を境界にする。
- [x] `[AI]` StoryAI、ページ生成、参照生成、画像importの直前にOpenAIへの送信対象と同意を表示する。
- [x] `[AI]` StoryAI提案と生成画像previewへ、アプリを離れないAI生成物通報を追加する。
- [x] `[AI]` 通報payloadを固定カテゴリ・理由・不透明な作品記録IDだけにし、本文、prompt、画像、token、emailをclientから送らないテストを追加する。APIは認証済みの不透明なuser IDだけを運用ログへ付与する。
- [x] `[AI]` AI生成物通報をSentry依存の見せかけ処理から、認証・rate limit・202 receiptを備えたLyra APIと日次確認runbookへ置き換える。
- [x] `[AI]` private organizationの全active memberへ、ワークスペース内容とメンバーの2種類を通報できる実API/UIを追加し、通報者への安全なfollow-up手順を定める。
- [x] `[AI]` 認証済みMobile UIの前に、user ID・規約版ごとの明示同意gateと「同意せずログアウト」を追加する。
- [x] `[AI]` 唯一のorganization ownerによる削除blockerからWeb rootを開かず、アプリ内organization管理へ移動する。
- [x] `[AI]` Sentry DSN未設定でも本番アプリを設定エラー画面にせず、任意のcrash診断だけを無効化する。
- [x] `[AI]` 未完成のPDF / ZIP出力を初回buildでは既定OFFにし、既存の単一ページ画像保存だけを維持する。
- [x] `[AI]` iOSの未検証Associated Domains entitlementを初回buildから除外し、Android App LinksとCognito custom schemeを分離する。
- [x] `[AI]` Android / iOS共通のAI安全性・通報・safe-failure実機release checklistをversion管理する。
- [x] `[AI]` Mobileのorganization管理からStripe checkout、plan変更、credit購入、billing portalを非表示にし、状態・invoice閲覧は維持する。
- [x] `[AI]` 個人store購入UIへ自動更新・解約方法・日英の利用規約/プライバシー導線を追加する。
- [x] `[AI]` production client profileで既存アカウント削除UIを有効化する。
- [x] `[AI]` 日英のprivacy、terms、support、専用account-deletionページをversion管理し、OpenAI / AWS / Apple / Google / Stripe / Sentryと国際処理を開示する。
- [x] `[AI]` App Store / Playの言語別metadata、Data Safety draft、review notesを法務URL・削除URL・AI通報・外部決済非表示と一致させる。
- [x] `[共同]` 日英法務ページを`app.lyra-editor.com`へ公開し、全URLがHTTPS 200かつHTMLとして表示できることを確認する。
- [x] `[AI]` EAS production / previewのAPI URL・Google Services fileを維持し、Cognito callback / logout環境変数をcustom schemeへ統一してreadbackする。
- [ ] `[共同]` 任意でSentry crash診断を有効にする場合だけ有効なDSNをsecret設定し、privacy-limited crash eventを実機確認する。AI通報はSentryを使用しない。
- [ ] `[共同]` production Backendの`ACCOUNT_DELETION_ENABLED`、IAM、recovery runnerを有効化し、previewから完了まで実機確認する。
- [ ] `[共同]` 将来iOS Universal Linksを有効にする場合に限り、Apple Team ID確定後に正しいAASAを公開してからAssociated Domainsを再追加する（初回提出の必須条件ではない）。
- [ ] `[共同]` release AABのtargetSdk、権限、署名、assetlinksと、IPAのentitlement、privacy manifest、未検証Associated Domainsがないことを最終artifactから検査する。
- [ ] `[共同]` 両OS release候補でAI生成物2種とorganization通報2種を実送し、202表示とprivacy-minimized production log receiptを確認する。
- [ ] `[共同]` `docs/mobile-ai-safety-release-checklist.md`を両OSの同一release候補で実行し、全AI経路の拒否またはsafe failureを記録する。
- [ ] `[人間]` 「Lyra Japan / Edge of Vision」の正式な販売者・個人情報取扱事業者表記、準拠法、住所等を確定し、日英法務文面を専門家と承認する。
- [ ] `[人間]` 審査用アカウント、十分なcredit、再現手順をApp Store Connect / Play Consoleの保護欄へ登録する。
- [ ] `[人間]` App Privacy、Data Safety、content rating、輸出コンプライアンス、広告ID、暗号利用の回答を最終artifactと一致させて申告する。
- [ ] `[人間]` App Store / Playの商品、価格、販売国、subscription group / base planと契約・税務・銀行設定を承認する。
- [ ] `[人間]` 日本語・英語screenshotsと審査説明を実機の最終buildから承認する。
- [ ] `[人間]` Lyra APIログのAI生成物・organization安全通報を担当者が営業日ごとに確認し、必要なコンテンツ対応・利用者対応・記録を行う運用を開始する。

### 2026-08-02 審査是正の本番反映記録

- release merge commit: `3023850c3836f314890d44a0c798ad74f5283939` ([PR #171](https://github.com/sh0g0-ikeda/Lyra/pull/171))
- active API task definition: `lyra-prod-api:108`、rollback: `lyra-prod-api:107`
- ECR image: linux/arm64、`sha256:3917ec8b9beb5becbccea49c9a05aa72b5ad8274568b845cd3a37a130f8fb055`、basic scan findings 0
- readiness: API 1/1、ALB healthy、`/healthz` / `/readyz` 200、更新後20分のerror-like log 0
- public pages: privacy / terms / supportの日英6 URLがHTTPS 200、更新済み通報説明の配信を確認
- moderation API: AI生成物通報とorganization安全通報が本番mount済みで、未認証requestを401で拒否
- Cognito: 既存URLを維持したまま`lyra-mobile://auth/mobile/callback` / `logout`を追加。実機login / logoutは未確認
- account deletion: API flag有効、未認証requestは401、専用recovery service 1/1、現行streamのrecovery error 0
- EAS: Android実機確認用APK build 42完了・署名検証済み。Google Play提出用AAB build 43とiOS署名buildの結果はartifact確認後に追記する

## 10. 完了条件

初回リリース完了は、上記active checklistがすべて完了し、購入がserver verification前に付与されず、personal / organizationの境界が守られ、アカウント削除と現行4タブが両OSで動作し、署名済みartifactが両ストアから公開された状態とする。

将来機能はこの文書へ戻さない。実装を決めた時点で別Issue / 設計文書として起票する。
