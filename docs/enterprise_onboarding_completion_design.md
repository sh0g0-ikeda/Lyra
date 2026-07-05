# Lyra 法人機能 要件定義・安全実装設計

最終更新: 2026-07-03

## 0. 前提

`docs/Lyra_Unified_Spec_v4.md` は現リポジトリ内に存在しない。そのため、本書では以下を正本として扱う。

- 現在のコード実装
- `enterprise.md` で検討されていた法人機能方針
- `src/domain/types/organization.ts`
- `src/domain/constants/billing.ts`
- `src/services/organization/*`
- `src/routes/organizations.ts`
- `src/services/billing/StripeWebhookService.ts`
- 関連 migration と unit test

本書の目的は、「法人料金プランがあるだけ」の状態で止めず、企業が実際に Lyra を使える状態にするための要件と設計を明確化することである。

## 1. 完成状態の定義

法人機能の完成状態は、次を満たすこととする。

- 法人 workspace を作成できる
- owner が法人プラン A/B/C を契約できる
- owner/admin がメンバーをメール招待できる
- 招待されたユーザーが Cognito で登録またはログインし、招待を受諾できる
- 法人 workspace 内の作品は `organization_id` で管理される
- 法人 workspace の生成処理は法人共有クレジットを消費する
- 個人 workspace の作品、課金、生成処理には影響しない
- ロールごとに作品操作、生成、請求、メンバー管理、監査ログ閲覧の権限が分かれる
- 請求、クレジット、使用履歴、監査ログを問い合わせ対応に使える
- 招待 token、S3 key、Stripe secret、メール本文などの機密情報を UI/API に出さない

未完成とみなす状態:

- 法人プランは買えるが、メンバー招待が届かない
- 招待を受けても workspace に参加できない
- 法人 workspace なのに個人クレジットを消費する
- 法人 workspace 内の作品を権限のないユーザーが閲覧または編集できる
- billing ロールが作品本文や生成画像を見られる
- raw invitation token や S3 key がフロントに露出する

## 2. 企業ユーザーの操作順

### 2.1 初回導入

1. 代表者または管理者が Lyra に Cognito でログインする。
2. 「法人 workspace を作成」から法人名、正式名称、請求メールアドレスを登録する。
3. 作成者は自動的に `owner` になる。
4. 法人 workspace は初期状態で `enterprise_a`、ステータス `active`、クレジット残高 0 で作られる。
5. owner は法人プラン A/B/C のいずれかを選び、Stripe Checkout に遷移する。
6. Stripe 決済完了後、Webhook により `organizations.stripe_customer_id`、`stripe_subscription_id`、`plan_key`、法人クレジットが更新される。
7. owner はメンバーをメール招待する。
8. 招待されたユーザーはメール内リンクから `/invite/:token` にアクセスする。
9. 未ログインの場合は Cognito Hosted UI で登録またはログインする。
10. ログイン後、招待メールアドレスと Cognito のメールアドレスが一致すれば参加できる。
11. メンバーは割り当てられたロールに応じて作品作成、編集、生成、請求確認を行う。

### 2.2 日常利用

1. ユーザーは個人 workspace または法人 workspace を選ぶ。
2. 法人 workspace 選択中に作品を作ると、作品には `organization_id` が付く。
3. ストーリー、キャラ、ページの編集 API には `organization_id` を付ける。
4. API は membership と capability を確認してから処理する。
5. 生成ジョブは `generation_jobs.organization_id` を保持する。
6. 生成開始時に法人共有クレジットをトランザクション内で消費する。
7. 失敗または stale recovery 時は同じ `organization_id` に返却する。
8. 完了、失敗、返却、エクスポートは usage/audit に記録する。

### 2.3 契約変更

1. owner または billing は「法人請求」からプラン変更または請求管理を開く。
2. 上位プランへの変更は Lyra 側のプラン変更導線から Stripe Portal session を作る。
3. 下位プランへの変更、解約、支払方法変更は Stripe Customer Portal で行う。
4. Webhook が `invoice.paid`、`customer.subscription.updated`、`customer.subscription.deleted` を処理する。
5. 毎月の法人プラン分クレジットは蓄積ではなく、規定値へ更新する。
6. 追加購入クレジットは purchased bucket に加算し、次月に消えない。

## 3. プラン仕様

法人プランは ToC の 1 クレジット 20 円より月額単価を下げ、利用量の大きい企業が黒字で継続できる設計にする。

| plan_code | 表示名 | 月額 | 月次クレジット | 実質単価 | 最低契約期間 | トライアル |
|---|---:|---:|---:|---:|---:|---:|
| `enterprise_a` | エンタープライズプラン A | 10,000円 | 600 | 約16.7円 | 1か月 | なし |
| `enterprise_b` | エンタープライズプラン B | 30,000円 | 2,000 | 15円 | 3か月 | なし |
| `enterprise_c` | エンタープライズプラン C | 100,000円 | 7,000 | 約14.3円 | 6か月 | なし |

追加クレジットは ToC の単発購入と同じ単価で扱う。

- `ENTERPRISE_ADDITIONAL_CREDIT_JPY_PER_CREDIT = ONE_TIME_CREDIT_PACKAGE_JPY_PER_CREDIT`
- 現行コードでは 1 クレジット 22 円
- 追加クレジットは purchased bucket に加算

重要な課金ルール:

- 月次クレジットは毎月リセット方式
- 月次クレジットは蓄積しない
- 追加購入クレジットは蓄積する
- Stripe 金額、plan_code、organization_id はサーバー側設定と Webhook metadata で検証する
- クライアントから送られた金額やクレジット量は信用しない

## 4. 権限設計

現行のロールと capability は `src/domain/types/organization.ts` を正本とする。

| ロール | 用途 | 権限 |
|---|---|---|
| owner | 契約責任者 | 組織設定、メンバー管理、請求、利用履歴、監査ログ、作品作成、編集、生成、エクスポート、閲覧 |
| admin | 運用管理者 | メンバー管理、利用履歴、監査ログ、作品作成、編集、生成、エクスポート、閲覧 |
| billing | 経理担当 | 請求管理、請求閲覧のみ |
| editor | 編集者 | 作品作成、編集、生成、エクスポート、閲覧 |
| viewer | 閲覧者 | 作品閲覧のみ |

必須ルール:

- `billing` は作品本文、画像、プロンプト、生成結果を閲覧できない
- `viewer` は生成、編集、エクスポートできない
- `admin` は請求操作をできない
- 最後の active owner は削除または降格できない
- `suspended` と `removed` の member は JWT が有効でもアクセスできない
- `past_due` または `suspended` の organization は、閲覧以外の操作を制限する

## 5. データモデル方針

### 5.1 既存個人機能を壊さない原則

法人機能は既存の個人機能を置き換えない。個人データは従来どおり `user_id` と `organization_id = null` で扱う。

非破壊方針:

- `organization_id` は追加スコープとして扱う
- 個人 API は `organization_id` なしで従来どおり動く
- 法人 API は `organization_id` ありのときだけ membership を要求する
- 既存作品を強制的に法人 workspace に移行しない
- 旧 API response の必須フィールドを削らない

### 5.2 organization 系テーブル

必要な中核テーブル:

- `organizations`
- `organization_members`
- `organization_invitations`
- `organization_credit_balances`
- `organization_usage_events`
- `organization_audit_logs`
- `email_delivery_logs`

`migrations/022_add_organization_invitation_delivery.sql` は、招待メール送信状態と配送ログを追加する。

追加済みまたは必須の invitation fields:

- `send_status`
- `send_error_code`
- `send_error_message`
- `sent_at`
- `last_sent_at`
- `resend_count`
- `revoked_at`
- `revoked_by_user_id`

### 5.3 token と key の扱い

保存・露出ルール:

- 招待 token は raw 値を DB に保存しない
- DB には `token_hash` のみ保存する
- API は `invitation_token` を返さない
- 管理者 UI に返すのは `invitation_url` まで
- S3 key はフロントに返さない
- 参照候補画像は `candidate_token` で扱う
- `candidate_token` は HMAC 署名付きで、backend が S3 key に復元する

## 6. API 契約

### 6.1 `/api/me`

返すべき情報:

- ログインユーザー
- 個人プラン
- 個人クレジット
- 所属 organization 一覧
- 各 organization の membership、plan、balance

注意:

- billing ロールだけの workspace も一覧には出してよい
- ただし作品一覧 API では `view_work` capability がない限り作品を返さない

### 6.2 `/api/organizations`

用途:

- organization 作成
- organization 更新
- workspace 詳細取得
- メンバー一覧
- 招待一覧
- 使用履歴
- 監査ログ
- 請求 summary
- Stripe Checkout / Portal 作成

必須:

- 全 route で `authMiddleware`
- `organization_id` の UUID validation
- `requireMembership(organizationId, userId, capability)`
- zod validation

### 6.3 `/api/organization-invitations/:token`

用途:

- 招待リンクの事前表示

公開 route として許可する理由:

- 未ログインユーザーが「どの組織から何の招待が来たか」を確認するため

制限:

- public read rate limit を必ず通す
- 返す情報は organization 名、招待メール、ロール、状態、有効期限まで
- メンバー一覧、請求情報、作品情報は返さない
- raw token は返さない

### 6.4 `/api/organization-invitations/accept`

用途:

- ログイン後に招待受諾する

必須:

- auth required
- token hash で invitation を検索
- pending 以外は拒否
- 有効期限切れなら expired に更新して拒否
- invitation.email と Cognito email が一致しなければ拒否
- transaction 内で member upsert と invitation accepted 更新を行う
- audit log に `invitation.accepted` を残す

### 6.5 作品・キャラ・ページ・生成 API

法人 workspace 選択中は `organization_id` を付ける。

必須 capability:

- 作品作成: `create_work`
- 作品閲覧: `view_work`
- 作品編集: `edit_work`
- キャラ生成、ページ生成: `generate`
- エクスポート: `export`

生成時の必須:

- job に `organization_id` を保存
- 法人 job は organization credit を消費
- 個人 job は personal credit を消費
- 失敗時の refund も同じスコープに戻す

## 7. 招待メール設計

### 7.1 送信フロー

1. owner/admin が email と role を入力する。
2. `OrganizationService.inviteMember` が membership と role を検査する。
3. server が secure random token を生成する。
4. token hash を `organization_invitations` に保存する。
5. `InvitationUrlBuilder` が `/invite/:token` URL を作る。
6. `OrganizationInvitationEmailService` がメールを送る。
7. 送信結果を invitation と `email_delivery_logs` に保存する。

### 7.2 送信状態

| send_status | 意味 | UI 表示 |
|---|---|---|
| `not_sent` | 未送信 | 招待リンクをコピーして共有できる |
| `sending` | 送信中 | 少し待って再読み込み |
| `sent` | 送信済み | メール送信済み |
| `failed` | 送信失敗 | リンク共有または再送 |

### 7.3 SES

本番で必要:

- SES 送信元ドメインまたはメールアドレスを verify
- DKIM/SPF/DMARC を設定
- SES sandbox 解除
- `EMAIL_DELIVERY_PROVIDER=ses`
- `SES_FROM_EMAIL`
- `AWS_REGION`

SES が未設定の場合:

- 招待 URL は作成する
- メール送信は disabled として記録する
- UI は「メールは未送信。招待リンクをコピーして共有してください」と表示する
- 法人招待機能自体は止めない

### 7.4 エラー表示

メール送信エラーはユーザー向けに丸める。

返してよい例:

- メール送信に失敗しました。招待リンクをコピーして共有するか、再送してください。
- 送信元メール設定が未完了です。管理者に確認してください。

返してはいけない例:

- AWS access key
- SES raw provider error
- SMTP response detail
- invitation token
- email body

## 8. Stripe 設計

### 8.1 個人課金との分離

個人課金:

- `BillingService`
- consumer plan: `standard`, `premium`
- personal user scope

法人課金:

- `OrganizationBillingService`
- enterprise plan: `enterprise_a`, `enterprise_b`, `enterprise_c`
- organization scope

禁止:

- 個人 checkout endpoint で enterprise plan を購入させる
- 法人 checkout endpoint で personal plan を購入させる

### 8.2 Stripe metadata

必須 metadata:

- `lyra_organization_id`
- `plan_code`
- `user_id`

追加購入の場合:

- `package_code`

Webhook では metadata を検証し、DB の organization と plan 定義に照合する。

### 8.3 Webhook

必須:

- Stripe signature verification
- idempotency
- processed event table で二重処理防止
- `checkout.session.completed`
- `invoice.paid`
- `customer.subscription.updated`
- `customer.subscription.deleted`

クレジット付与:

- 初回 checkout 完了時に plan 分を月次 bucket に付与
- 更新 invoice paid 時に月次 bucket を plan 規定値へ更新
- plan 変更時は新 plan 分へ更新
- 追加購入は purchased bucket に加算

## 9. UI 要件

### 9.1 workspace 切り替え

UI は現在のスコープを明確に表示する。

- 個人 workspace
- 法人 workspace 名
- 現在のロール
- 法人プラン
- 法人クレジット残高

ユーザーが迷わないための表示:

- 「この作品は法人 workspace に保存されます」
- 「この生成は法人クレジットを使用します」
- billing ロールには作品タブを出さない

### 9.2 招待 UI

必要:

- メールアドレス入力
- ロール選択
- 招待送信
- 招待リンクコピー
- 再送
- 取り消し
- 送信状態
- 有効期限

注意:

- 「送信済み」だけでなく、メールが届かない場合のリンク共有導線を必ず残す
- raw token は表示しない
- URL は full URL のみ表示する

### 9.3 請求 UI

必要:

- 現在の法人プラン
- 月次クレジット
- 追加クレジット
- プラン A/B/C の表示
- Checkout 導線
- Customer Portal 導線
- 請求履歴
- 使用履歴

文言:

- 有料プランの変更・解約は「サブスク・請求を管理」で行ってください
- 毎月のプラン分クレジットは規定値に更新されます。未使用分は翌月に繰り越されません
- 追加購入クレジットは繰り越されます

## 10. セキュリティ要件

### 10.1 認証・認可

- 公開 route は invite preview のみ
- それ以外は auth required
- organization route は membership required
- 操作ごとに capability required
- DB query は `organization_id` または `user_id` で必ず絞る

### 10.2 データ分離

個人:

- `organization_id IS NULL`
- `owner_user_id = user.id`

法人:

- `organization_id = selectedOrganizationId`
- user は active member
- capability がある

### 10.3 機密情報

絶対に UI/API に出さない:

- Stripe secret key
- Stripe webhook secret
- AWS secret
- raw invitation token
- S3 key
- signed S3 internal URL
- provider raw error
- email body
- prompt全文の不用意な露出

### 10.4 rate limit

必要:

- invite preview
- invite accept
- invite resend
- checkout session creation
- customer portal session creation
- generation enqueue

### 10.5 audit log

記録する:

- organization 作成、更新
- メンバー招待、再送、取り消し、受諾
- メンバー role/status 変更
- 請求 portal open
- checkout 作成
- subscription 更新
- credit grant/consume/refund
- generation completed/failed
- export

記録しない:

- raw token
- メール本文
- S3 key
- API key

## 11. 生成パイプラインへの影響

法人機能は生成品質ロジックを変えない。変えるのは scope、credit、audit である。

ページ生成:

- prompt builder は既存どおり
- character reference lock は既存どおり
- job に `organization_id` を持たせる
- entity/page/work repository は organization scope を受け取る

キャラ生成:

- candidate image は `candidate_token` で扱う
- confirm 時に backend が token を検証し S3 key を復元する
- 法人 workspace では法人クレジットを使う

StoryAI / page skeleton:

- LLM 出力 shape は変えない
- 法人 workspace なら organization scope で work/episode/page を更新する
- scene なしでも生成できる既存方針を維持する

## 12. 実装済み項目

現時点で入っている実装:

- organization 型と role/capability
- organization repository/service
- organization routes
- organization billing service
- enterprise plan constants
- `/api/me` の法人 workspace summary
- organization invite preview
- invite accept
- invitation email service
- email delivery logs
- Stripe enterprise metadata handling
- organization credit consume/refund/grant
- generation job の organization scope
- story/page/entity/panel/frame/balloon route の organization scope
- invitation/billing/generation/storyAI の専用 rate limit bucket
- reference candidate token
- web UI の法人 workspace、請求、招待、使用履歴、監査ログ導線
- 法人請求 UI のプラン分クレジットリセット説明
- 招待・監査・請求まわりの日本語表示

## 13. 残る実装・設定タスク

### 13.1 人間が必ず行う設定

Stripe:

- Enterprise A/B/C の Product と Price を作る
- 追加クレジット package の Price を確認する
- `STRIPE_ENTERPRISE_A_PRICE_ID`
- `STRIPE_ENTERPRISE_B_PRICE_ID`
- `STRIPE_ENTERPRISE_C_PRICE_ID`
- Stripe Customer Portal で plan 変更と解約を許可する
- Webhook endpoint を本番 API に向ける
- Webhook signing secret を Secrets Manager に入れる

SES:

- 送信元 domain/email verify
- DKIM/SPF/DMARC 設定
- sandbox 解除
- `SES_FROM_EMAIL` 設定

Cognito:

- Hosted UI domain
- callback URL
- logout URL
- sign-up 有効化
- email verification 文言
- production app client ID

AWS/ECS:

- Secrets Manager の本番値
- ECS task restart
- SQS worker desired/min scaling
- CloudWatch alarm
- DB migration 適用

### 13.2 実装側で継続確認する項目

- `OrganizationService.requireMembership` を通らない org route がないこと
- `organization_id` 付き job の refund が法人残高に戻ること
- billing ロールが作品 API を読めないこと
- invitation response に `invitation_token` が出ないこと
- reference candidate response に `s3_key` が出ないこと
- Stripe webhook が二重処理されないこと
- monthly credits が蓄積せず規定値に更新されること
- 法人スコープの作品/章/話/ページ/コマ/シーン/キャラ編集が audit log に残ること
- メンバー停止/復帰/削除が audit log に残り、最後の owner を停止・削除できないこと
- usage CSV を UI からダウンロードできること

## 14. テスト計画

Unit:

- organization 作成で owner と balance が作られる
- owner/admin だけが invite できる
- billing は作品 API にアクセスできない
- invitation preview は public で最小情報のみ返す
- invitation accept はメール不一致を拒否する
- invitation token は API response に出ない
- invite resend/revoke が audit log を残す
- enterprise checkout は organization scope で作られる
- personal checkout は enterprise plan を拒否する
- monthly credit grant は残高を規定値に更新する
- purchased credit grant は加算する
- organization job failure refund は organization balance に戻る
- candidate token なしで S3 key を露出しない

Integration:

- `/api/me` が personal と organization summary を返す
- organization work 作成から page generation enqueue まで organization scope が維持される
- Stripe webhook の checkout/invoice/subscription event が idempotent に処理される
- migration 022 適用後も既存 invitation が読める

Frontend:

- 法人 workspace 切替で API に `organization_id` が付く
- billing ロールで作品タブが表示されない
- invite link landing から login/accept ができる
- メール送信 failed/disabled 時にリンクコピー導線が出る
- 決済遷移前に「決済完了」と表示しない
- plan/credit が reload 後も `/api/me` から復元される
- メンバー管理 UI で role と active/suspended を別々に変更できる
- 利用状況 UI から usage CSV を保存できる
- 監査ログ UI に編集・生成・請求・招待イベントが人間向けラベルで表示される

Smoke:

- 新規 Cognito user 登録
- 個人作品作成
- 法人 workspace 作成
- Stripe test checkout
- 招待送信またはリンク共有
- 招待受諾
- 法人作品作成
- 法人クレジット消費
- 失敗 job refund

## 15. デプロイ手順

1. main 最新を確認する。
2. migration を本番 DB に適用する。
3. Secrets Manager に必要 env を入れる。
4. ECS API task を更新または再起動する。
5. ECS worker task を更新または再起動する。
6. `/api/health` を確認する。
7. Cognito login から `/api/me` を確認する。
8. 個人 workspace の作品一覧が読めることを確認する。
9. 法人 workspace 作成を確認する。
10. 法人請求 UI が Stripe に遷移することを確認する。
11. Stripe webhook test event を送る。
12. invite preview と accept を確認する。
13. 生成 job が organization_id を持つことを確認する。
14. CloudWatch logs に secret/token/S3 key が出ていないことを確認する。

## 16. ロールアウト方針

Phase 1:

- owner/admin/billing/editor/viewer を実装済み能力で公開
- Stripe カード決済を主導線にする
- 請求書払いは C または個別対応に限定
- SES 未設定時もリンク共有で招待できる

Phase 2:

- 管理者向け credit grant/refund UI
- 企業別利用上限
- 通知メールの日本語文面改善

Phase 3:

- SAML SSO
- SCIM
- IP 制限
- 作品単位 role
- 部署/チーム階層
- SLA 契約書連携

## 17. 採用しない項目

初期リリースでは採用しない:

- organization 専用 DB tenant
- Cognito Group を法人 role の正本にする方式
- 無制限生成プラン
- 法人無料トライアル
- 請求担当が作品本文や生成画像を閲覧できる仕様
- raw token を管理画面に表示する仕様
- S3 key をフロントに返す仕様

理由:

- コストと運用負荷が大きい
- 既存個人機能を壊すリスクが高い
- 情報漏えい時の影響が大きい
- 現時点の売上規模に対して過剰

## 18. 受け入れ基準

法人機能は以下を満たしたら本番利用可能と判断する。

- owner が法人 workspace を作成できる
- Stripe で Enterprise A/B/C を契約できる
- Webhook 後に法人 plan と monthly credits が反映される
- owner/admin が招待を作成できる
- 招待メールまたは招待 URL で参加できる
- 招待先メールとログインメールが違う場合は参加できない
- 法人 workspace で作った作品は法人 member 以外に見えない
- billing ロールは作品本文を見られない
- 法人生成 job は法人クレジットを消費する
- 失敗時 refund が法人残高へ戻る
- invitation token と S3 key が API response に出ない
- reload 後も workspace、plan、credit が正しく表示される
- メンバー停止/復帰を UI から実行できる
- 法人 usage CSV を UI から保存できる
- 法人 audit log に主要な編集、招待、請求、生成、エクスポートイベントが残る
- 個人 workspace の既存機能が従来どおり動く

## 19. 運用上の注意

問い合わせ対応で見る順番:

1. user email
2. organization id/name
3. membership role/status
4. subscription status
5. organization credit balance
6. usage events
7. audit logs
8. generation job status
9. email delivery logs
10. Stripe event id

ユーザーに返す説明は操作可能な内容にする。

例:

- 「この招待は期限切れです。管理者に再送を依頼してください」
- 「このアカウントのメールアドレスは招待先と異なります。招待されたメールアドレスでログインしてください」
- 「法人クレジットが不足しています。請求管理者に追加購入を依頼してください」

避ける説明:

- DB constraint 名
- AWS provider raw error
- Stripe raw exception
- internal token hash
- stack trace
