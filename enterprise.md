# Lyra 法人契約機能 要件定義書

最終更新: 2026-06-28

## 0. この文書の目的

この文書は、Lyra に法人向け契約機能を取り入れるための実装要件である。

元提案の内容を、現行 Lyra の実装方針に照らして以下の3種類に仕分けした。

- 採用: 法人契約に必要で、既存パイプラインへの影響を管理できるもの
- 条件付き採用: 必要性はあるが、初期実装で入れると破綻しやすいため段階導入するもの
- 却下: コスト、セキュリティ、実装リスク、運用負荷に対して効果が薄いもの

実装では、既存の個人向け課金、Cognito ログイン、Stripe 決済、クレジット消費、生成ジョブ、作品/キャラ/ページの編集パイプラインを壊さないことを最優先にする。

`docs/Lyra_Unified_Spec_v4.md` は現環境に存在しないため、本書では現行コードと既存クラウド方針を正本として扱う。

### 0.1 法人機能の完了定義

法人向け機能は、単なる「法人料金プラン」ではない。

Phase 1 の完了には、少なくとも以下が揃っている必要がある。

- 法人 Workspace / Organization を作成・取得できる
- 法人メンバーを招待し、owner / admin / billing / editor / creator / viewer のロールで権限判定できる
- 法人 Workspace に紐づく作品は `organization_id` で管理される
- 法人共有クレジットを使って生成ジョブを実行できる
- 法人生成ジョブの成功・失敗・返金が個人残高ではなく法人残高に反映される
- Stripe の法人 Customer / Subscription と Lyra の Organization が紐づく
- Usage Log / Audit Log に、生成・返金・エクスポート・権限操作が残る
- UI から所属 Workspace、現在のロール、法人残高、法人プランが確認できる

以下の状態は、法人機能として未完了とみなす。

- 料金プランだけが存在し、組織・メンバー・権限・共有クレジットがない
- 法人契約なのに生成ジョブが個人残高を消費または返金する
- 法人 Workspace のデータを membership なしで参照できる
- Usage Log / Audit Log がなく、問い合わせ時に利用履歴を説明できない

---

## 1. 採否判断

| 提案項目 | 判断 | 理由 |
|---|---|---|
| 法人 Workspace / Organization | 採用 | 法人契約、一括請求、共有クレジット、メンバー管理の軸になる |
| Cognito をログインに使い、Lyra DB で権限管理 | 採用 | 現行方針と一致。Cognito Group だけでは複数組織所属を扱いにくい |
| Stripe Customer を法人単位で持つ | 採用 | 法人請求ではユーザー個別決済より自然 |
| 法人共有クレジット | 採用 | 制作会社・出版社で複数メンバーが同じ枠を使える |
| Stripe Webhook 署名検証・冪等処理 | 採用 | 課金実装では必須 |
| メンバー招待・ロール管理 | 採用 | 法人導入時の最低要件 |
| Usage Log / Audit Log | 採用 | 問い合わせ対応、請求根拠、権限操作の追跡に必要 |
| Enterprise 手動契約 | 採用 | 初期の法人営業では自動化より管理者操作の方が現実的 |
| 個人ユーザーも即時 personal organization に全面移行 | 条件付き採用 | 最終形としては妥当だが、初期実装でやると既存ユーザー/課金/作品読み込みを壊しやすい |
| `credit_buckets` を新規主軸にする | 条件付き採用 | 概念は有効だが、現行 credit balance / ledger と二重化するため段階導入 |
| ProjectMember / WorkMember | 条件付き採用 | 外部作家管理には有効。ただし初期は Organization role で十分な可能性が高い |
| ユーザー別・作品別の月次上限 | 条件付き採用 | コスト管理に有効。MVP 後に追加 |
| SAML SSO / SCIM | 後回し | 大企業向けには必要だが、初期法人契約の成約前に入れるには重い |
| IP 制限 | 後回し | 企業向けには有効だが、運用事故が起きやすい |
| 専用DB tenant | 却下 | 初期法人導入には過剰。コストと運用負荷が大きい |
| Cognito Group を法人ロールの正本にする | 却下 | 1ユーザー複数組織・組織ごとの権限差に弱い |
| ユーザーごとに個別法人サブスク契約 | 却下 | 法人契約の意味がなく、運用が破綻する |
| 定額無制限生成 | 却下 | 画像生成APIコストが読めず、赤字化しやすい |
| 請求担当者が作品本文・画像・プロンプトを閲覧可能 | 却下 | 権限分離と機密保護に反する |

---

## 2. 実装の基本方針

### 2.1 最小破壊の段階導入

初期実装では、既存個人ユーザーのデータ構造をいきなり全面移行しない。

採用する方針:

- 個人向けの既存課金・クレジット・作品管理は維持する
- 法人機能は `organizations` を追加して横に増やす
- 作品は当面 `owner_user_id` と `organization_id` の両方を扱えるようにする
- `organization_id` は初期 migration では nullable にする
- 法人 Workspace 内で作成された作品だけ `organization_id` を必須扱いにする
- 既存個人作品の自動移行は別フェーズに分ける

却下する方針:

- 初回リリースで全ユーザー・全作品・全クレジットを強制的に Organization ベースへ移行する
- 既存 API のレスポンス形を一気に変更する
- 個人と法人で完全に別アプリ・別コードパスを作る

### 2.2 用語

UI では `Workspace`、DB/API では `Organization` を使う。

Lyra 既存の `work` は、法人向け説明上の `Project` に相当する。実装では既存語彙に合わせ、原則として `work` / `work_id` を使う。

---

## 3. 対象外

この法人機能で変更しないもの:

- 画像生成モデルの品質ロジック
- ページ骨格生成、話反映、プロンプトコンパイラの中核処理
- 既存の個人向けサブスク/単発クレジット購入UI
- Cognito Hosted UI そのもの
- Stripe の既存個人向け Checkout / Customer Portal
- モバイルアプリ専用機能

法人機能は、生成パイプラインの上に載る権限・請求・クレジット管理レイヤーとして実装する。

---

## 4. データモデル要件

### 4.1 organizations

法人契約の親単位。

必須カラム案:

```sql
organizations
- id UUID PRIMARY KEY
- type TEXT NOT NULL CHECK (type IN ('business', 'internal'))
- name TEXT NOT NULL
- legal_name TEXT
- status TEXT NOT NULL DEFAULT 'active'
- plan_key TEXT
- billing_email TEXT
- stripe_customer_id TEXT UNIQUE
- stripe_subscription_id TEXT UNIQUE
- created_by_user_id UUID REFERENCES users(id)
- created_at TIMESTAMP NOT NULL
- updated_at TIMESTAMP NOT NULL
```

初期実装では `personal` type は作らない。個人ユーザーの全面移行は Phase 3 に回す。

`status`:

- `active`
- `trialing`
- `past_due`
- `suspended`
- `canceled`

### 4.2 organization_members

法人 Workspace のメンバー。

```sql
organization_members
- id UUID PRIMARY KEY
- organization_id UUID NOT NULL REFERENCES organizations(id)
- user_id UUID NOT NULL REFERENCES users(id)
- role TEXT NOT NULL
- status TEXT NOT NULL DEFAULT 'active'
- invited_by_user_id UUID REFERENCES users(id)
- joined_at TIMESTAMP
- created_at TIMESTAMP NOT NULL
- updated_at TIMESTAMP NOT NULL

UNIQUE (organization_id, user_id)
```

`status`:

- `invited`
- `active`
- `suspended`
- `removed`

`removed` は物理削除しない。過去の生成・請求・監査ログとの整合性を守る。

### 4.3 ロール

初期実装で採用するロール:

| Role | 用途 | 権限 |
|---|---|---|
| owner | 契約責任者 | 全操作、請求、メンバー管理、権限変更 |
| admin | 運用管理者 | メンバー招待、作品管理、利用量確認 |
| billing | 請求担当 | 請求・支払い・クレジット購入のみ |
| editor | 編集者 | 法人内の作品編集、生成、エクスポート |
| creator | 制作者 | 許可された作品の編集・生成 |
| viewer | 閲覧者 | 許可された作品の閲覧のみ |

必須ルール:

- `billing` は作品本文、画像、プロンプトを閲覧できない
- `viewer` は生成、編集、エクスポートできない
- `creator` は請求情報を見られない
- `owner` は最低1人必要
- 最後の `owner` は削除・降格できない
- `suspended` / `removed` member は JWT が有効でも即時アクセス不可

### 4.4 organization_invitations

メール招待。

```sql
organization_invitations
- id UUID PRIMARY KEY
- organization_id UUID NOT NULL REFERENCES organizations(id)
- email TEXT NOT NULL
- role TEXT NOT NULL
- token_hash TEXT UNIQUE NOT NULL
- status TEXT NOT NULL DEFAULT 'pending'
- invited_by_user_id UUID NOT NULL REFERENCES users(id)
- accepted_by_user_id UUID REFERENCES users(id)
- expires_at TIMESTAMP NOT NULL
- accepted_at TIMESTAMP
- created_at TIMESTAMP NOT NULL
- updated_at TIMESTAMP NOT NULL
```

要件:

- 招待 token は平文保存しない
- 有効期限は7日
- 招待 email と Cognito email が一致しない場合は受諾不可
- 同一 Organization / email の未使用招待を重複作成しない
- 受諾後は `organization_members` を active 化する

### 4.5 works への organization_id 追加

法人 Workspace の作品を識別するため、既存作品テーブルに `organization_id` を追加する。

方針:

- 初期 migration では nullable
- 法人 Workspace で作る作品は必ず `organization_id` を持つ
- 個人作品は当面 `organization_id = null` のまま許容する
- Repository 層では、個人作品は `owner_user_id`、法人作品は `organization_id + membership` で認可する

既存個人作品を強制移行しない理由:

- 現在の作品一覧読み込み、生成ジョブ、Stripe 個人課金に影響が広い
- 移行バグが起きるとログイン直後に作品が消える事故につながる

---

## 5. 課金・クレジット要件

### 5.1 Stripe Customer

法人 Workspace では Stripe Customer を Organization 単位で作成する。

採用:

- `organizations.stripe_customer_id`
- `organizations.stripe_subscription_id`
- Stripe metadata に `lyra_organization_id` を入れる
- Stripe の customer/subscription id は DB 内部でのみ保持し、通常のOrganization APIレスポンスやUIには返さない

禁止:

- metadata にメール本文、契約書、秘密情報、プロンプト、画像URLを入れる
- client から送られた plan/credit amount を信用する

### 5.2 法人サブスクリプション

法人プランは既存個人プランと分離する。

初期実装:

| plan_key | 表示名 | 月額 | 月次付与クレジット | 実質単価 | 最低契約期間 | 支払い | SLA |
|---|---|---:|---:|---:|---|---|---|
| `enterprise_a` | エンタープライズプラン A | 10,000円 | 600 credits | 約16.7円/credit | 1か月 | Stripeカード決済中心 | なし |
| `enterprise_b` | エンタープライズプラン B | 30,000円 | 2,000 credits | 15.0円/credit | 3か月 | Stripeカード決済、必要に応じて請求書 | SLAなし、SLOのみ |
| `enterprise_c` | エンタープライズプラン C | 100,000円 | 7,000 credits | 約14.3円/credit | 6〜12か月 | 請求書対応可 | 個別契約でSLA検討 |

設計意図:

- 現行ToCサブスクの 20円/credit より月額単価を下げる
- 追加クレジットはToCと同じく 22円/credit とし、使いすぎ分で利益を確保する
- 月額クレジットは毎月規定数へ更新し、未使用分は原則として翌月へ繰り越さない
- トライアルは提供しない
- 無制限生成は提供しない
- SLAは初期から強い法的保証にしない。A/BはSLAなし、Bは努力目標としてSLOを表示可、Cのみ個別契約で検討する

法人サブスクの月次クレジットは、既存方針と同じく「毎月規定クレジットに更新」する。サブスク分の未使用クレジットは原則として翌月へ蓄積しない。

追加購入クレジットは別枠として扱う。追加クレジット単価は現行ToC追加購入と同じ 22円/credit を基本とし、期限はプラン設定で制御する。

### 5.3 クレジット残高

初期実装では既存の credit balance / credit ledger を拡張する。

採用する設計:

- 個人残高と法人残高を同じ ledger 概念で扱う
- ledger に `organization_id` nullable を追加する
- 法人消費では `organization_id` を必須にする
- 消費時は DB transaction + row lock を使う
- 生成ジョブ作成前にクレジットを確保する
- ジョブ失敗時の返却も ledger に記録する

後回し:

- `credit_buckets` を主テーブルにする全面移行

理由:

`credit_buckets` は期限・優先消費を表現しやすいが、既存実装と二重化する。初期は ledger 拡張で安定させ、必要になったら bucket 表示/計算レイヤーを追加する。

### 5.4 生成時のクレジット消費

法人 Workspace での生成APIは必ず以下を行う。

1. Cognito JWT を検証する
2. JWT から Lyra user を解決する
3. `organization_id` の membership を確認する
4. role が生成可能か確認する
5. サーバー側で必要クレジットを計算する
6. transaction 内で法人残高を lock する
7. 残高不足なら生成ジョブを作らず 402 を返す
8. クレジットを消費し ledger を作る
9. generation job を作る
10. audit log / usage log を記録する

禁止:

- client から渡された `creditCost` を信用する
- 残高確認と減算を別 transaction に分ける
- 残高不足でも先に SQS job を作る

---

## 6. Stripe Webhook 要件

### 6.1 必須

- raw body で Stripe 署名を検証する
- `STRIPE_WEBHOOK_SECRET` は Secrets Manager / 環境変数で管理する
- test/live の secret を混ぜない
- `stripe_event_id` で冪等処理する
- 同一 webhook の再配送でクレジットを二重付与しない

### 6.2 対象イベント

初期実装で処理するイベント:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.paid`
- `invoice.payment_failed`

`invoice.paid` でサブスク月次クレジットを更新する場合は、billing period ごとの idempotency key を必ず使う。

---

## 7. Usage Log / Audit Log 要件

### 7.1 usage_events

法人管理者が「誰が、どの作品で、どの生成に、何クレジット使ったか」を見られるようにする。

保存項目:

- `organization_id`
- `user_id`
- `work_id`
- `action_type`
- `generation_type`
- `model_key`
- `credits_used`
- `job_id`
- `status`
- `created_at`

初期UI:

- 今月の総使用クレジット
- メンバー別使用量
- 作品別使用量
- 生成タイプ別使用量

### 7.2 audit_logs

監査ログは append only とする。

記録対象:

- `organization.created`
- `organization.updated`
- `member.invited`
- `member.joined`
- `member.role_updated`
- `member.suspended`
- `member.removed`
- `credit.granted`
- `credit.consumed`
- `credit.refunded`
- `billing.portal_opened`
- `subscription.updated`
- `generation.started`
- `generation.completed`
- `generation.failed`
- `work.exported`

閲覧権限:

- `owner` / `admin`: 原則閲覧可
- `billing`: billing / credit 関連のみ
- `editor` 以下: 閲覧不可

---

## 8. API 要件

### 8.1 Auth / Me

既存 `me` 相当のレスポンスに、所属 Organization を追加する。

```json
{
  "user": {
    "id": "user_xxx",
    "email": "user@example.com"
  },
  "organizations": [
    {
      "id": "org_xxx",
      "name": "Publisher A",
      "role": "admin",
      "status": "active"
    }
  ]
}
```

### 8.2 Organizations

追加API:

- `GET /api/organizations`
- `POST /api/organizations`
- `GET /api/organizations/:organizationId`
- `PATCH /api/organizations/:organizationId`

### 8.3 Members / Invitations

追加API:

- `GET /api/organizations/:organizationId/members`
- `POST /api/organizations/:organizationId/invitations`
- `PATCH /api/organizations/:organizationId/members/:memberId`
- `DELETE /api/organizations/:organizationId/members/:memberId`
- `POST /api/invitations/:token/accept`

### 8.4 Billing

追加API:

- `POST /api/organizations/:organizationId/billing/subscription-checkout-session`
- `POST /api/organizations/:organizationId/billing/credit-pack-checkout-session`
- `POST /api/organizations/:organizationId/billing/customer-portal-session`
- `GET /api/organizations/:organizationId/billing`
- `GET /api/organizations/:organizationId/invoices`

既存個人向け billing API は残す。

### 8.5 Usage / Audit

追加API:

- `GET /api/organizations/:organizationId/credits/balance`
- `GET /api/organizations/:organizationId/usage`
- `GET /api/organizations/:organizationId/audit-logs`

### 8.6 生成APIの拡張

既存生成APIに `organizationId` を追加できるようにする。

挙動:

- `organizationId` がない場合: 既存個人ユーザーの残高で処理
- `organizationId` がある場合: membership / role / 法人残高で処理

これにより既存の個人向け生成を壊さない。

---

## 9. UI 要件

### 9.1 Workspace 切り替え

アカウント/決済エリアに Workspace 切り替えを追加する。

表示:

- 個人利用
- 所属法人 Workspace
- 現在の role
- 利用可能状態
- 残クレジット

モバイルでは下部ナビを増やしすぎない。法人設定は「決済/クレジット/設定」側に集約する。

### 9.2 法人設定

タブ:

- 基本情報
- メンバー
- 請求
- クレジット
- 利用量
- 監査ログ

初期は UI を増やしすぎず、法人営業で必要な最小画面だけ実装する。

### 9.3 メンバー画面

機能:

- メンバー一覧
- role 表示
- status 表示
- メール招待
- role 変更
- 停止/削除

注意:

- billing role に作品サムネイルや作品名を大量表示しない
- owner が最後の owner を消そうとしたら止める

### 9.4 請求画面

表示:

- 現在の法人プラン
- subscription status
- 次回請求日
- 残クレジット
- Stripe Customer Portal ボタン
- クレジット購入ボタン
- 請求書リンク

Customer Portal は `owner` と `billing` のみ表示する。

### 9.5 利用量画面

表示:

- 今月の総使用量
- メンバー別使用量
- 作品別使用量
- 生成タイプ別使用量

この画面ではプロンプト本文や画像詳細を出さない。利用量を知る画面であって、制作物を覗く画面ではない。

---

## 10. セキュリティ要件

### 10.1 認証・認可

必須:

- すべての法人APIは Cognito JWT を検証する
- client から送られた `userId` を信用しない
- `organizationId` が指定されたら membership を毎回確認する
- member status が `suspended` / `removed` なら即時拒否する
- role ごとの権限を route または service 層で検査する

### 10.2 データ分離

必須:

- 法人作品は `organization_id` で必ず絞る
- 画像URLやエクスポートURLは所有権確認後にだけ返す
- S3 bucket は private のまま
- 署名付きURLは短期間のみ有効
- Repository 層で org scope を省略できない設計にする

禁止:

- `SELECT * FROM works WHERE id = :id` のような owner/org 条件なし取得
- billing role に作品本文・画像・プロンプトを返す
- 管理者用APIを通常ユーザー token で叩ける状態

### 10.3 Stripe

必須:

- secret key / webhook secret はフロントに出さない
- Webhook は raw body で署名検証する
- Webhook event は DB で冪等管理する
- Stripe metadata に機密情報を入れない

---

## 11. 実装フェーズ

### Phase 1: 法人MVP

法人営業でデモ・小規模導入できる状態。

実装:

1. `organizations`
2. `organization_members`
3. `organization_invitations`
4. 既存 `works` への nullable `organization_id` 追加
5. Workspace 切り替え
6. 法人メンバー招待
7. 法人 role 判定
8. 法人 Stripe Customer / Subscription
9. 法人クレジット残高
10. 法人生成時のクレジット消費
11. Stripe Webhook 冪等処理
12. Usage Log
13. Audit Log
14. Billing / Members / Usage の最小UI

Phase 1 では `ProjectMember` / `WorkMember` は必須にしない。まず Organization role で動かす。

### Phase 2: 法人運用強化

実装:

1. `work_members`
2. 外部作家向け作品単位権限
3. メンバー別月次上限
4. 作品別月次上限
5. 利用量 CSV export
6. 請求書一覧
7. 管理者による法人クレジット手動付与
8. Enterprise 手動契約管理

### Phase 3: 大企業向け

実装候補:

1. personal organization への既存個人データ移行
2. SAML SSO
3. SCIM
4. IP 制限
5. 監査ログ長期保存設定
6. DPA / SLA 表示

### 明確にやらない

- 専用DB tenant
- 定額無制限生成
- 独自ログインUI
- Cognito Group を法人 role の正本にする
- 法人ごとの個別アプリ分岐

---

## 12. 受け入れ条件

### 12.1 既存個人機能

- 既存個人ユーザーがログインできる
- 既存作品一覧が消えない
- 既存の個人向け購入・サブスク・クレジット表示が壊れない
- 個人ユーザーは `organizationId` なしでも生成できる

### 12.2 Organization

- 法人 Workspace を作成できる
- 作成者が owner になる
- Workspace 一覧に所属法人が表示される
- 法人 Workspace で作成した作品に `organization_id` が入る

### 12.3 招待・権限

- owner/admin がメンバーを招待できる
- 招待されたユーザーが Cognito ログイン後に参加できる
- 招待 email とログイン email が違う場合は参加できない
- role ごとに表示UI/API権限が変わる
- removed/suspended member は即時アクセスできない

### 12.4 Billing / Credit

- Organization 単位で Stripe Customer が作られる
- 法人 Subscription を開始できる
- 法人追加クレジットを購入できる
- Webhook 成功時に法人クレジットが付与される
- 同じ Webhook が複数回来ても二重付与されない
- 法人生成時に法人残高から消費される
- 残高不足時はジョブを作らず 402 を返す

### 12.5 Audit / Usage

- member 招待・削除・role変更が audit log に残る
- credit 付与・消費・返却が audit log に残る
- generation started/completed/failed が usage log に残る
- billing portal access が audit log に残る

---

## 13. テスト要件

### Unit

- role 判定
- membership 判定
- 最後の owner 削除防止
- 招待 token hash / expiration
- 法人クレジット消費の cost 計算
- Webhook idempotency key

### Integration

- Cognito user 同期後に Organization member として認可できる
- 他 Organization の work を取得できない
- billing role が作品本文・画像・プロンプトを取得できない
- concurrent generation request でクレジットが二重消費されない
- Stripe webhook 再配送でクレジットが二重付与されない

### Frontend

- Workspace 切り替え
- Members 画面
- Billing 画面
- Credits/Usage 画面
- 権限ごとの表示制御

### Regression

- 個人ユーザーの作品一覧
- 個人ユーザーの決済UI
- キャラ生成
- ページ生成
- ページ骨格生成
- 話全体を反映

---

## 14. Codex 実装指示

実装時は以下を守る。

1. まず migration は追加のみで作る。既存カラム削除・既存テーブル破壊は禁止。
2. 法人機能は `ENTERPRISE_FEATURES_ENABLED` のような feature flag で切れるようにする。
3. 個人ユーザーの既存 API を変更せず、法人向け context を追加する。
4. `organizationId` がある処理だけ法人認可・法人課金へ分岐する。
5. すべての法人 DB query は `organization_id` と membership を確認する。
6. Stripe webhook は raw body 署名検証と冪等処理を必須にする。
7. クレジット消費は transaction + row lock で行う。
8. UI は法人ユーザーだけに法人設定を表示し、個人ユーザーの画面を重くしない。
9. billing role には制作物を見せない。
10. 実装後は個人機能の回帰テストを必ず行う。

---

## 15. 事業条件

### 15.1 確定条件

以下は本書で確定とする。

| 項目 | 内容 |
|---|---|
| 法人プラン名 | エンタープライズプラン A / B / C |
| 月額料金 | A: 10,000円、B: 30,000円、C: 100,000円 |
| 月次クレジット数 | A: 600、B: 2,000、C: 7,000 |
| 月次クレジット | 毎月規定数へ更新。未使用分は原則繰り越しなし |
| 追加クレジット単価 | 22円/credit |
| トライアル | なし |
| 無制限生成 | なし |
| 最低契約期間 | A: 1か月、B: 3か月、C: 6〜12か月 |
| SLA | A/Bはなし。BはSLO表示のみ可。Cは個別契約で検討 |

### 15.2 未確定条件

以下は販売開始前に事業側で決める。

- Cプランの最低契約期間を6か月にするか12か月にするか
- 請求書払いを許可する具体条件
- サポート窓口と対応時間
- SLO文言
- CプランでSLAを出す場合の稼働率、返金条件、免責条件
- DPA / 利用規約 / プライバシーポリシーの法人条項

Phase 1 の DB/API/UI の土台は、未確定条件を環境設定・管理画面設定で差し替えられる前提で実装する。

---

## 16. Phase 1 実装監査チェック

この節は、法人向け機能が「法人料金プランだけ」になっていないことを確認するための実装チェックである。
以下を満たさない状態では、法人機能を実装完了として扱わない。

| 項目 | 必須状態 |
|---|---|
| Workspace | Organization を作成・一覧取得・詳細取得でき、作成者が owner になる |
| メンバー管理 | owner/admin が招待・ロール変更・削除できる。最後の owner は削除・降格できない |
| ロール分離 | billing は請求情報のみ扱い、作品本文・画像・プロンプトにアクセスできない |
| 作品スコープ | 法人作品は `organization_id` を持ち、Repository 層で `organization_id + active membership` を必ず確認する |
| 共有クレジット | 法人生成は法人残高を transaction + row lock で消費し、失敗時は法人残高へ返金する |
| Stripe | 法人 Customer / Subscription / Checkout / Portal を Organization 単位で扱う |
| Webhook | 署名検証、冪等処理、最低金額チェック、法人 metadata 検証を通過した場合のみ残高・契約状態を更新する |
| Usage / Audit | 生成開始・成功・失敗・返金・エクスポート・権限操作・請求操作を記録する |
| UI | Workspace、ロール、共有残高、サブスク状態、法人プラン、メンバー、利用履歴、監査ログを確認できる |

### 16.1 実装上の注意

- 作成時に選ぶ法人プランは、サブスク開始前は「契約前の選択」であり、Stripe Checkout / Webhook 完了までは契約済みとして扱わない。
- `plan_key` や `status` は、通常の Organization 更新 API から直接変更できない。
- `organization_id` が指定された処理で OrganizationService が未設定の場合は、個人処理へフォールバックせずエラーにする。
- 法人向けの追加実装は、個人向け作品・課金・生成パイプラインを変更せず、`organization_id` がある処理だけに分岐して入れる。
