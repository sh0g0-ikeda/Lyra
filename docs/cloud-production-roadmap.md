# Lyra クラウド本番化ロードマップ

最終更新: 2026-06-05

## 目的

Lyra を AWS 上で有料サービスとして運用するための方針をまとめる。

優先順位は次の通り。

1. ユーザーの画像・ストーリー資産を奪われないように守る。
2. 複数ユーザーが同時に生成しても API が詰まらない構成にする。
3. 課金・クレジットを監査可能にする。
4. 使えなくなった画像・履歴を早めに処分し、保存コストを抑える。
5. 将来の Lyra for mobile に拡張できる課金基盤にする。

## 目標構成

### フロントエンド

- S3 に静的ファイルを配置。
- CloudFront で配信。
- HTTPS は ACM。
- フロントは API と認証プロバイダだけに通信する。

### API

- ECS Fargate を internal ALB 配下で複数タスク稼働。
- 外部入口は CloudFront に集約し、CloudFront VPC Origin で internal ALB へ到達させる。
- CloudFront VPC Origin が採用できない場合だけ、CloudFront secret header + ALB/WAF 検証 + CloudFront origin-facing prefix list 制限で ALB 直アクセスを 403 にする。
- 少なくとも 2 Availability Zones に分散。
- API は認証、入力検証、クレジット消費、job 作成、SQS enqueue、問い合わせ API に集中する。
- API で画像生成を同期実行しない。

### Worker

- ECS Fargate worker が SQS を consume する。
- ページ生成 worker とキャラ生成 worker は、負荷が違うなら分離する。
- SQS の queue depth と oldest message age に応じて autoscale する。
- worker は DB で `queued -> processing` を claim できた job だけ処理する。
- SQS は重複配信されうる前提で、二重処理されても破綻しない設計にする。

### DB

- RDS PostgreSQL。
- 本番は Multi-AZ。
- automated backup を有効化。
- MVP は 7 日、課金開始後は 30 日程度の PITR を目安にする。
- migration は API 起動時ではなく、CI/CD の one-off task として実行する。

### Queue

- SQS standard queue。
- DLQ を必ず付ける。
- visibility timeout は想定最大 worker 処理時間より長くする。
- worker timeout は visibility timeout より短くする。
- 失敗 job は DB 上で failed にし、必要に応じてクレジット返却する。

### 画像

- S3 private bucket。
- CloudFront を前段に置く。
- S3 public access は block。
- 必要に応じて CloudFront signed URL または signed cookie を使う。
- S3 key は `user/work/entity/page` の所有関係が分かる prefix にする。
- API は所有者確認なしに画像 URL や export を返してはいけない。

### Secrets

- AWS Secrets Manager を使う。
- OpenAI、Stripe、認証、DB、webhook secret はすべて Secrets Manager。
- staging と production で secret を分ける。
- ECS task role で secret を読む。

## 可用性方針

### ひとつのサーバーに詰め込まない

画像生成は遅いので、API と生成処理を分離する。

API が行うこと:

- リクエスト検証。
- クレジットを transaction で消費。
- generation job を作成。
- SQS に enqueue。
- `202 Accepted` を返す。

worker が行うこと:

- queued job を claim。
- prompt と input image を組み立てる。
- OpenAI 等の画像生成 API を呼ぶ。
- S3 に保存。
- DB を更新。
- job を completed または failed にする。

これにより、複数ユーザーが同時に画像生成しても API 自体は詰まりにくくなる。

### 水平スケール

- API は internal ALB 配下の ECS task 数を増やす。
- worker は SQS の滞留量に応じて増やす。
- ただし worker を増やしすぎると OpenAI rate limit、DB、S3 が次のボトルネックになる。
- user ごとの同時生成数と global queue limit を必ず持つ。

### 画像生成の競合対策

画像生成の競合対策は 1 つの仕組みに寄せず、複数の層で止める。

必須にするもの:

- DB active job lock。
- resource status lock。
- per-user concurrent generation limit。
- stuck job recovery。
- global queue backpressure。

強く推奨するもの:

- idempotency key。

後続検討:

- SQS FIFO / message group。

#### DB active job lock

対象 page/entity ごとに、`queued` または `processing` の active job がある間は新しい生成 job を作らせない。

メリット:

- API が複数台でも効く。
- 二重課金と二重生成を防ぎやすい。
- ページ生成、キャラ生成の両方に適用できる。
- 競合制御の正本を DB に置ける。

デメリット:

- migration が必要。
- stuck job を回収する recovery が必須。
- すぐ再生成したい UX とは衝突するため、キャンセル、失敗復旧、待機表示が必要。

採用判断:

- 必須。
- まず `generation_jobs` に resource kind/resource id を持たせるか、既存 params から生成対象を正規化して active unique constraint を作る。

#### Resource status lock

`pages.status = generating` のように、生成対象リソース自体に生成中状態を持たせる。

メリット:

- UI と相性が良い。
- ユーザーに「このページ/キャラは生成中」と出しやすい。
- 編集禁止やボタン disable と連動しやすい。

デメリット:

- job と status がズレると stuck する。
- DB 制約だけでは守りきれず、service 実装に依存する。
- キャラ生成では entity/reference_set 側の status 設計追加が必要。

採用判断:

- 必須。
- DB active job lock の補助として使う。単独では使わない。

#### Per-user concurrent generation limit

ユーザー単位で同時生成数を制限する。例として free は 1、paid は 2 から 3。

メリット:

- コスト爆発を抑えられる。
- OpenAI quota、worker、DB、S3 の過負荷を抑えられる。
- 悪用対策になる。

デメリット:

- 複数ページをまとめて試したいユーザーには待ちが出る。
- plan ごとの UX 設計が必要。

採用判断:

- 必須。

#### Global queue backpressure

全体 queue が一定以上溜まったら、新規生成を一時的に制限する。

メリット:

- サービス全体の破綻を防ぐ。
- OpenAI 障害、quota 切れ、S3/DB 遅延時の被害を抑えられる。

デメリット:

- ユーザーには待機や制限として見える。
- しきい値調整が必要。

採用判断:

- paid beta 前に必須。

#### Idempotency key

同じクリック、通信 retry、ブラウザ retry に同じ key を付け、同じ生成リクエストなら既存 job を返す。

メリット:

- 二重クリックに強い。
- ネットワーク retry で二重課金しにくい。
- UI のエラー復帰が安定する。

デメリット:

- frontend/API の両方に実装が必要。
- 「同じリクエストの再送」と「新しい再生成」を区別する必要がある。

採用判断:

- 強く推奨。

#### SQS FIFO / message group

`page:{pageId}` や `entity:{entityId}` を message group にして、同じ対象の worker 処理を直列化する。

メリット:

- worker 側の同一対象並列処理を抑えられる。
- 順序制御が明確。

デメリット:

- API 側の二重課金や二重 job 作成は防げない。
- FIFO queue は Standard queue より設計制約が多い。
- throughput 設計が必要。

採用判断:

- 後続検討。
- まず DB active job lock + Standard SQS でよい。

### API key 方針

API key を複数用意することを主なスケール手段にしない。

推奨する使い方:

- production、staging、local で key を分ける。
- text 系と image 系を分け、コスト追跡しやすくする。
- Secrets Manager で rotation する。

複数 key pool を使うのは次の条件を満たす場合だけ。

- provider が明確に許容している。
- rate limit と quota が key 単位で本当に分離される。
- 失敗時の fallback と請求追跡が実装されている。
- どの job がどの key/provider を使ったか audit できる。

基本は worker autoscale、queue backpressure、provider quota 引き上げ申請で対応する。

## コスト最適化の採用方針

可用性とセキュリティを削らずに、次のコスト最適化を採用する。

### Worker autoscale

採用する。

方針:

- API は常時稼働させる。
- 画像生成 worker は SQS queue depth と oldest message age に応じて autoscale する。
- 初期は worker min 0 から 1 を検討する。
- paid beta 以降は UX 安定のため min 1 を基本にする。
- queue が溜まった場合だけ worker を増やす。

守ること:

- API で画像生成を同期実行しない。
- autoscale しても per-user concurrent generation limit を超えない。
- worker 数を増やしすぎて OpenAI quota、DB、S3 を詰まらせない。

### Fargate worker right sizing

採用する。

方針:

- worker は小さめの vCPU/memory から始める。
- OpenAI 待ちが中心なら CPU を盛りすぎない。
- 画像合成、prompt build、input image processing が重い場合だけ増やす。
- page generation worker と entity generation worker は、必要なら別 task size に分ける。

見る指標:

- CPU 使用率。
- memory 使用率。
- job duration。
- OpenAI 待ち時間。
- image composition 処理時間。
- OOM / timeout。

### Fargate Spot

限定採用する。

使ってよい処理:

- お金の絡まない処理。
- 時間のかからない処理。
- 中断されても UX に響きにくい処理。
- 再実行コストが低い batch/cleanup/reconciliation 系。

使わない処理:

- クレジット消費済みの画像生成。
- OpenAI 画像生成呼び出し中の worker。
- ユーザーが画面上で待っている主要処理。
- 失敗すると refund や support 対応が必要になる処理。

採用判断:

- Spot はコスト削減用の補助。
- UX と課金の安全性が必要な本線 worker には使わない。

### S3 lifecycle

採用する。

方針:

- 画像 asset state と S3 object tag を合わせる。
- `tmp` と `session` は短期削除。
- 未 confirm のまま置き換えられた画像は Deep Archive 対象。
- confirm を外して再生成した旧画像も Deep Archive 対象。
- 最新 usable image と confirmed reference は通常アクセス可能な storage class に置く。

守ること:

- confirmed reference は使用中に自動削除しない。
- Deep Archive は即時復元 UX に使わない。
- DB に `asset_state`, `storage_class`, `archived_at`, `restore_status` を持たせる。

### CloudWatch logs の削減

採用する。

方針:

- production の通常ログは structured summary にする。
- full prompt、巨大 JSON、画像 base64 は CloudWatch に出さない。
- CloudWatch retention は短めにする。目安は 14 から 30 日。
- 長期 audit が必要なログだけ S3 archive に移す。
- debug log は staging と一時調査時だけ有効にする。

残す情報:

- request ID。
- user ID。
- job ID。
- provider request ID。
- error code。
- model。
- cost。
- status transition。
- refund ledger ID。

### NAT traffic 削減

採用する。

方針:

- S3 Gateway Endpoint を使う。
- 課金あり運用では SQS と Secrets Manager の Interface Endpoint を採用する。
- ECR Endpoint は Fargate 起動頻度が高い場合に採用する。
- CloudWatch Logs Endpoint は NAT 削減より先にログ量削減を行い、それでも必要なら採用する。
- 画像配信 traffic を NAT に流さない。
- worker と NAT/VPC endpoint の AZ 配置を意識する。

守ること:

- production で NAT Gateway を単一 AZ に寄せて可用性を落とす判断は慎重にする。
- staging では NAT 構成を簡略化してよい。

### API 基盤の Lambda 化

本番初期では採用しない。

判断:

- 課金あり運用では、API の安定性、RDS 接続管理、既存 ECS 前提の実装継続を優先する。
- API は ECS Fargate + internal ALB + CloudFront VPC Origin を本線にする。
- API Gateway HTTP API + Lambda は、低トラフィック期のコスト削減 PoC としてのみ扱う。
- Lambda 化する場合は RDS Proxy、同時実行上限、DB 接続再利用、管理 API 分離が必要。

### Internal ALB + CloudFront VPC Origin

採用する。

理由:

- ALB 直アクセスを根本的に防ぎやすい。
- WAF と入口制御を CloudFront 側に集約できる。
- API/RDS/worker を private subnet 内に閉じやすい。
- 課金あり運用では、ALB 直叩きによる WAF 回避や生成 API 乱用を避ける価値が高い。

代替:

- CloudFront VPC Origin が使えない場合のみ、public ALB + secret header + ALB/WAF 検証 + CloudFront prefix list 制限を採用する。

### RDS 構成の環境差

採用する。

方針:

- 課金あり production は Multi-AZ を採用する。
- staging は single-AZ 小型でよい。
- local は Docker PostgreSQL。
- production の backup、encryption、restore test は削らない。

削ってよいもの:

- staging の Multi-AZ。
- staging の長期 backup。
- 初期段階の RDS Proxy。

削ってはいけないもの:

- production の Multi-AZ。
- production の automated backup / PITR。
- production の暗号化。
- restore test。

### LLM/OpenAI コスト削減

採用する。

方針:

- text 系は安価モデルを優先する。
- page 単体 autofill は軽量・structured output 寄りにする。
- 話全体の plan など破綻すると影響が大きい箇所だけ高信頼モデルを使う。
- compiler 結果と job result を保存し、同じ入力で無駄に再実行しない。
- prompt の重複を削る。
- 失敗時の無限 retry を禁止する。

削ってはいけないもの:

- JSON/structured output の堅牢性。
- generation 前 validation。
- dialogue/entity/visual lock。
- credit/refund の安全性。

### AWS Budgets / Cost Anomaly Detection / Kill Switch

採用する。

理由:

- 課金あり運用では、最も危険なのは数十ドルの固定費ではなく、生成ジョブ暴走による OpenAI/AWS コスト増加。
- 不正利用、バグ、retry ループ、webhook 不整合を早く止める必要がある。

必須の予算・アラート:

- AWS 月次予算。
- OpenAI 日次予算。
- OpenAI 月次予算。
- S3 転送量アラート。
- CloudWatch Logs 取り込み量アラート。
- NAT Gateway data processing アラート。
- SQS DLQ > 0 アラート。
- Worker 同時実行数アラート。
- Stripe webhook 失敗率アラート。
- credit negative balance アラート。

Kill Switch:

- `generation_enabled = false`
- `high_quality_generation_enabled = false`
- `free_user_generation_enabled = false`
- `worker_max_concurrency = 0`
- `page_generation_enabled = false`
- `entity_generation_enabled = false`

実装方針:

- DB または SSM Parameter Store に runtime config として持つ。
- API と Worker の両方が生成前に参照する。
- ECS desired count の手動変更を kill switch の主手段にしない。

## ログイン方針

### 採用方針

独自ログイン UI は作らない。

AWS をできるだけ使う方針なので、第一候補は Cognito Managed Login / Hosted UI とする。

Web は Authorization Code + PKCE を使う。API は Cognito JWT を JWKS で検証する。

Cognito のメリット:

- AWS-native。
- Hosted UI/Managed Login を使える。
- 独自 password UI を持たずに済む。
- MFA、social login、passkey 等に拡張しやすい。
- mobile でも同じ user pool を使いやすい。

Cognito のデメリット:

- callback URL、Hosted UI、token 検証、MFA、メールテンプレートの設定が多い。
- UI の自由度は専用 auth サービスより低い。
- 初期設定を間違えるとユーザー視点のログインエラーが出やすい。

判断:

- AWS 統一を優先するため、Cognito Managed Login を本番第一候補にする。
- ただし、Cognito 設定に起因するログインエラーが多い場合は、Supabase/Auth0/Clerk の hosted login に戻す余地を残す。
- どの場合でも独自 password UI は避ける。

## 課金方針

### Web は Stripe

Web では Stripe Checkout と Customer Portal を使う。

クレジット付与は frontend の成功画面ではなく、検証済み webhook から行う。

必要なテーブル:

- `credit_balances`
- `credit_ledger`
- `billing_customers`
- `subscriptions`
- `payments`
- `stripe_events`

すべてのクレジット移動を ledger に残す。

- 初回無料付与。
- クレジット購入。
- 月次付与。
- 生成消費。
- 生成失敗 refund。
- 管理者調整。
- chargeback 対応。

### Mobile 拡張

Lyra for mobile では、iOS/Android のアプリ内デジタル商品ルールに注意する。

設計として Stripe 固定にしない。

内部の entitlement/credit layer を provider 非依存にする。

例:

- `credit_ledger.source = stripe | apple_iap | google_play | admin | system`
- `external_transaction_id`
- `external_product_id`
- `platform`
- `idempotency_key`

これにより、Web は Stripe、iOS は Apple IAP、Android は Google Play Billing という拡張が可能になる。

## 課金リスク

特に危険なもの:

- Stripe webhook の重複配送で二重付与する。
- checkout success page を信じてクレジット付与する。
- webhook が遅延し、ユーザーには決済済みに見えるが credit が増えない。
- OpenAI 失敗時に job failed にならず credit だけ減る。
- worker timeout 後に refund されない。
- chargeback/refund 後もアプリ内 credit が残る。
- subscription downgrade/cancel が反映されない。
- 管理者が DB を直接編集して ledger と balance がズレる。
- mobile で Stripe 決済を使い、App Store/Google Play の digital goods policy と衝突する。

対策:

- Stripe event ID に unique constraint。
- クレジット付与は webhook のみ。
- credit 消費は DB transaction + row lock。
- refund は service 経由のみ。
- balance と ledger の reconciliation job。
- Stripe subscription と local subscription の reconciliation job。
- negative balance alarm。
- admin credit adjustment UI。

## 管理者によるクレジット返却

管理者が簡単に返却できる仕組みを作る。

必要機能:

- email/user ID でユーザー検索。
- 残高と ledger を表示。
- job ID を指定して refund。
- 任意の credit 付与。
- 理由入力必須。
- 確認ダイアログ。
- 管理者 ID、対象 user ID、amount、reason、timestamp を保存。

DB の balance を直接更新しない。必ず ledger entry を作る。

## 保存コスト削減

### 画像

S3 object tag と lifecycle policy を使う。

分類:

- `tmp`: import 一時画像。1 から 7 日で削除。
- `session`: 未確定の生成候補。7 から 30 日で削除。
- `current`: ユーザーが現在使える画像。Standard。
- `confirmed`: ユーザーが確定した画像。Standard または Standard-IA。
- `superseded_unconfirmed`: 未確定のまま再生成で置き換えられた旧画像。Deep Archive 対象。
- `superseded_after_reopen`: confirm を外して再生成した旧画像。Deep Archive 対象。
- `archive_deep`: ユーザーが通常 UI から使えない低頻度参照用画像。Deep Archive。

MVP 方針:

- ユーザーが使えるページ画像は最新だけ。
- confirm 済み画像はユーザー資産として保持する。
- confirm されていない生成候補は、再生成で置き換えられた時点で Deep Archive 対象にする。
- confirm を外して reopen し、再生成した場合も、旧画像は Deep Archive 対象にする。
- 最新の usable image だけ Standard に置く。
- 通常 UI では Deep Archive 画像を即時復元できる前提にしない。
- キャラの confirmed reference は資産なので、使用中は自動削除しない。

Deep Archive 採用時の注意:

- 復元が遅いため、ユーザーが即時に戻せる履歴として扱わない。
- support/法務/事故調査用の低頻度アーカイブとして扱う。
- 復元コストと復元時間を運用 runbook に明記する。
- DB には asset state、storage class、archived_at、restore_status を持たせる。

### ストーリー

- 現在の編集内容は DB に保持。
- edit history は 30 日程度で削除または圧縮。
- 長期保存が必要な場合だけ S3 archive に移す。
- ユーザーがアクセスできなくなった古い履歴は早めに処分する。
- 問い合わせ用には全文ではなく、job ID、version、timestamp、差分 metadata を残す。

## 画像資産の保護

画像はユーザー資産なので private 前提にする。

必須:

- S3 Block Public Access。
- KMS encryption。
- TLS。
- CloudFront signed URL/cookie。
- user ownership check。
- object listing 禁止。
- user input を S3 key に直接使わない。
- export/download も API 認可を通す。
- admin/support 権限を分離。

## ログと問い合わせ対応

問い合わせに答えるため、次は保存する。

- request ID。
- user ID。
- work ID。
- page ID/entity ID。
- job ID。
- provider request ID。
- model。
- cost。
- job status transitions。
- error code。
- refund ledger ID。

保存しない、または長期保存しないもの:

- API key。
- 生の決済情報。
- 画像バイナリ。
- 過剰な story text。
- full prompt の無期限保存。

full prompt は support window の間だけ保持し、その後 redaction または TTL 削除を検討する。

## AWS セキュリティ基本方針

Network:

- CloudFront を唯一の外部入口にする。
- ALB は internal ALB として private subnet に置く。
- ECS API/worker と RDS は private subnet。
- RDS は public にしない。
- Security group は DB 接続を ECS からだけ許可。
- CloudFront VPC Origin が使えない場合のみ public ALB を許容し、secret header と WAF/ALB rule で CloudFront 経由以外を拒否する。

IAM:

- API task role と worker task role を分ける。
- worker だけが生成画像 write できる。
- API は所有確認後に read/export できる。
- deployment role と admin/support role を分ける。

Data:

- RDS encryption。
- S3 encryption。
- Secrets Manager。
- CloudTrail。
- GuardDuty。
- IAM Access Analyzer。
- Security Hub。
- AWS Config。
- S3 Block Public Access。
- CloudFront OAC。
- WAF logs。
- ALB access logs。
- CloudFront logs。
- VPC Flow Logs。

Runtime:

- production で dev auth bypass を拒否。
- production で local asset storage を拒否。
- production で S3/SQS/CDN/OpenAI/Auth secret 不足を拒否。
- production の 5xx で内部詳細を返さない。

## 実装ロードマップ

### Phase 1: 課金前の安全修正

- キャラ生成 active job lock。
- Redis 系 rate limit。
- admin credit adjustment。
- 画像 lifecycle tag。
- migration one-off 実行。
- job/support detail API。

### Phase 2: AWS staging

- VPC、RDS Multi-AZ、S3、CloudFront、WAF、SQS、DLQ、ECS API、ECS worker を作成。
- CloudFront VPC Origin + internal ALB を構築する。
- S3 Gateway Endpoint、SQS Endpoint、Secrets Manager Endpoint を作成する。
- CloudTrail、GuardDuty、IAM Access Analyzer、Security Hub、AWS Config を有効化する。
- Secrets Manager に secret を投入。
- AWS Budgets、Cost Anomaly Detection、OpenAI 日次/月次上限、generation kill switch を設定する。
- staging deploy。
- migration one-off task。
- 生成、保存、export、confirm、reopen、refund を検証。

### Phase 3: Stripe test mode

- Checkout。
- Customer Portal。
- Webhook。
- duplicate webhook test。
- failed generation refund test。
- ledger/balance reconciliation。
- admin refund test。

### Phase 4: paid beta

- Stripe live mode。
- 招待制で少人数。
- worker max count を低めに設定。
- production RDS Multi-AZ で運用する。
- CloudFront VPC Origin + internal ALB を本線にする。
- API Gateway + Lambda 化は paid beta では採用しない。
- 毎日確認:
  - job failure。
  - queue age。
  - OpenAI spend。
  - Stripe webhook。
  - credit ledger anomaly。

### Phase 5: public launch

- quota 引き上げ。
- WAF rate-based rule。
- support runbook。
- 利用規約、プライバシーポリシー、返金ポリシー。
- account deletion flow。
- mobile-ready billing abstraction。

## Launch Gate

- API で画像生成を同期実行していない。
- worker が水平スケールできる。
- SQS DLQ がある。
- job が冪等。
- ページ生成とキャラ生成に active job lock がある。
- credit 消費と refund が ledgered。
- admin credit return がある。
- Stripe webhook が署名検証され、冪等。
- Cognito JWT を署名、issuer、audience/client_id、token_use、期限、scope/group まで検証している。
- CloudFront VPC Origin + internal ALB、または CloudFront secret header + ALB/WAF 検証で ALB 直アクセスが拒否される。
- WAF が CloudFront に有効。
- S3 bucket が private。
- CloudFront OAC で S3 にアクセスしている。
- 画像取得に所有者確認がある。
- CloudFront signed URL/cookie が短 TTL かつ狭い scope。
- superseded 画像に lifecycle がある。
- production が local storage と dev auth bypass を拒否する。
- CloudWatch alarm がある。
- AWS Budgets / Cost Anomaly Detection / generation kill switch がある。
- CloudTrail、GuardDuty、IAM Access Analyzer、Security Hub、AWS Config が有効。
- S3 Gateway Endpoint、SQS Endpoint、Secrets Manager Endpoint がある。
- production RDS が Multi-AZ。
- RDS restore test 済み。
- request ID、job ID、provider request ID で問い合わせ追跡できる。

## Image Delivery Implementation Note

The current app displays generated previews and candidates from `session/*` and
imported sources from `tmp/*` before the user confirms them. The image bucket
policy therefore has to allow CloudFront origin access to `saved/*`,
`session/*`, and `tmp/*`.

Before paid production, viewer access to image paths must be protected at
CloudFront with signed cookies/URLs or an equivalent authenticated edge policy.
S3 itself must remain private, with CloudFront as the only read principal.
