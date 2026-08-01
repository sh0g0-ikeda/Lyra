# Lyra Mobile 初回リリース タスクリスト

最終更新: 2026-08-01

対象: Android / iPhone の初回ストア公開

進捗: 73件中28件完了 / 45件未完了

未完了の担当内訳: AI単独0件 / AI準備＋外部確認28件 / 人間・外部必須17件

## 0. このリストの範囲

初回リリースは、現在Mobileに表示されている4タブ（物語、キャラ、ページ、アカウント）と、追加が必要な次の2つのUIだけを対象とする。

- 個人ユーザー向けのApp Store / Google Play購入UI
- アカウント削除UI

それ以外の新規UI・Backend機能は初回リリースへ追加しない。既にmainに存在するBackend、migration、DB fieldは、Web・保存済みデータ・内部整合性が依存する可能性があるため削除しない。未使用機能は既定OFFまたはMobile未接続のまま維持する。

旧487件の詳細監査は[履歴文書](./mobile-release-task-list-full-audit-2026-08-01.md)へ移した。履歴文書のcheckboxは現在の残件数へ算入しない。

### 担当区分

- `[AI]`: リポジトリ内の実装・テスト・文書だけで完了できる。
- `[共同]`: AIが準備・検証できるが、外部Console、秘密情報、署名、実機などが必要。
- `[人間]`: 商品・法務・公開判断、本人確認、金融契約、実機操作が完了条件。

## 1. 範囲固定と不要機能の整理

- [x] `[AI]` 現行Mobileの可視UIと実際に呼ぶAPIを4タブ単位で棚卸しする。
- [x] `[AI]` 新規UIを個人向け購入とアカウント削除の2つだけに固定する。
- [x] `[AI]` Balloon編集UIとFrame編集UIが現行Mobileに存在しないことを確認する。
- [x] `[AI]` ページ設定から`balloon_only` / `mixed`の選択UIを除去する。
- [x] `[AI]` 保存済み`dialogue_mode`、API schema、DB fieldを維持し、別設定の保存時に未変更値を送らないことをテストする。
- [x] `[AI]` 旧タスクリストを履歴化し、active checklistから将来機能を外す。
- [ ] `[人間]` Standard / Premium subscriptionと10 / 50 / 150 credit商品の価格・付与量・販売国を承認する。
- [ ] `[人間]` iOS / Androidの公開順、公開日、段階公開率、初動監視責任者を決める。

### 初回リリースから外すもの

- Work削除・並べ替え、Scene削除、Character削除。
- Balloon / Frame編集、ページlayout template、scene単位autofill、Page confirm / reopen。
- entity referenceのpresigned direct-upload client、`costume_ref_id`選択、reference削除。
- PDF / ZIP export、外部dialogue handoff、composition gallery。
- job cancel / hide、Push通知、APNs / FCM、push outbox。
- organization作成・招待・権限管理・organization billing UI。既存workspace切替だけは維持する。
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
- [ ] `[共同]` Associated Domains、AASA、Cognito callback / logout URLを本番値で確認する。
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

## 9. 完了条件

初回リリース完了は、上記active checklistがすべて完了し、購入がserver verification前に付与されず、personal / organizationの境界が守られ、アカウント削除と現行4タブが両OSで動作し、署名済みartifactが両ストアから公開された状態とする。

将来機能はこの文書へ戻さない。実装を決めた時点で別Issue / 設計文書として起票する。
