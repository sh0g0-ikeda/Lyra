結論：**ある**。
この構成は「ALBだけパブリック、ECS/RDS/Workerはプライベート、SQSで非同期化、Secrets Manager利用」という方向性自体は妥当です。ただし、図だけ見る限り、**実装を間違えると高リスクになる未定義箇所**がかなりあります。特に危ないのは、**ALB直アクセス、S3/CloudFront署名配信、外部AI送信、SQSワーカーの冪等性、課金・クレジット整合性、JWT検証、Secrets/IAM**です。

以下、「未実装なら危険」という前提で優先度順に見ます。

---

## 1. ALBへの直アクセスを防いでいるか不明

図ではALBがパブリックサブネットにあります。これは普通の構成ですが、問題は**CloudFrontを経由せずにALBのDNS名へ直接アクセスできる状態**だと、CloudFront側のWAF、レート制限、キャッシュ、ヘッダー制御を全部バイパスされることです。

対策は必須です。CloudFrontからALBへ送るリクエストに**秘密のカスタムヘッダー**を付け、ALBリスナールールまたはWAFでそのヘッダーがないリクエストを403にします。さらにALBのセキュリティグループは、CloudFront origin-facing のAWS管理プレフィックスリストからの443だけを許可します。AWSも、CloudFront配下のALBを直接叩かれないように、カスタムヘッダー、ALBルール、HTTPS、CloudFront用プレフィックスリストを使う方法を示しています。([AWS ドキュメント][1])

より堅くするなら、CloudFront VPC originsで**内部ALB**をオリジンにする設計も検討対象です。AWSのCloudFrontドキュメントでも、VPC originsを使うとVPC内の内部ALB/NLBをCloudFrontオリジンにでき、アプリをパブリックインターネットに直接露出させない構成が説明されています。([AWS ドキュメント][2])

**判定基準：** `https://ALBのDNS名/...` を直接叩いてAPIが返るならアウトです。403で落ちる必要があります。

---

## 2. WAFが「任意」扱いになっているのは甘い

図ではCloudFront側に「WAF連携（任意）」と見えますが、本番では任意ではなく**ほぼ必須**です。特にこのサービスは、ログイン、課金、画像生成、SQS投入、外部AI呼び出しがあるため、攻撃者にとって「コストを発生させやすい」構成です。

最低限、CloudFrontまたはALBにAWS WAFを付け、AWS Managed Rules、IPレピュテーション、既知の悪性入力、レートベースルールを入れるべきです。AWS Managed Rulesは一般的なWeb脅威に対する保護レイヤーを提供しますが、AWS自身も「アプリケーション側の責任の代替ではない」と説明しています。つまり、WAFだけで安全にはなりません。([AWS ドキュメント][3])

具体的には、次を入れるべきです。

* `/api/jobs` や生成開始APIへのユーザー単位・IP単位レート制限
* 未ログイン状態での大量アクセス制限
* 異常なUser-Agent、国・ASN、Tor/VPN系IPへの制限
* リクエストボディサイズ制限
* WAFログ保存とアラーム

---

## 3. CognitoのJWTを「受け取るだけ」では危険

Cognitoを使っていても、API側でJWTを正しく検証していなければ意味がありません。API側では最低限、署名、issuer、audience/client_id、`token_use`、`exp`、scope、group、ユーザー状態を検証する必要があります。AWSのCognitoドキュメントでも、JWTの署名検証、JWKS取得、`kid`のキャッシュとローテーション対応が説明されています。([AWS ドキュメント][4])

ありがちな危険パターンは以下です。

* JWTを単にデコードしているだけ
* IDトークンをAPI認可に使っている
* `sub`だけ見て、scopeやtenant/owner権限を見ていない
* 期限切れトークンを許している
* CORSを `*` にしてAuthorizationヘッダーを許可している
* 管理者APIと一般ユーザーAPIの権限境界が曖昧

このサービスでは、生成画像・キャラクター・クレジットがユーザー資産です。したがって、**「ログイン済みか」ではなく「そのユーザーがそのjob/image/credit ledgerにアクセスできるか」** を毎回DBで検証する必要があります。ここを甘くするとIDOR、つまり他人の画像や生成結果を取得できる脆弱性になります。

Cognito側では、MFAを完全任意にするより、課金・高額生成・管理者操作ではMFAまたはリスクベース認証を要求する設計が妥当です。CognitoのAdaptive Authenticationは、不審なサインインをブロックしたり追加認証を要求できる仕組みです。([AWS ドキュメント][5])

---

## 4. SPAなのでXSS時の被害が大きい

フロントエンドがS3 + CloudFrontのSPAなので、トークンはブラウザに置かれます。これは一般的ですが、XSSが入るとCognitoトークン、署名付きURL、ユーザー操作権限が盗まれます。

特にこの構成では、OpenAI等から返ったテキストや生成メタデータを画面に表示するはずです。LLM出力やユーザー入力をHTMLとしてそのまま描画すると、XSSになります。OWASPのLLM Top 10でも、Prompt InjectionやInsecure Output Handlingが、データ漏えい・不正操作・下流システム侵害につながるリスクとして挙げられています。([OWASP][6])

対策は以下です。

* LLM出力、ユーザー入力、キャラ説明文をHTMLとして直接描画しない
* React等でも `dangerouslySetInnerHTML` を原則禁止
* Markdown表示するならサニタイザ必須
* CSPを設定する：`default-src 'self'` をベースに厳しく
* トークンをlocalStorageへ長期保存しない
* CloudFront Response Headers PolicyでCSP、HSTS、X-Content-Type-Optionsを設定
* CORSは本番ドメインだけ許可

---

## 5. 画像S3バケットのアクセス制御が最重要

図では「画像バケット（プライベート）」とあるので方向性は正しいです。ただし、実際には以下が必須です。

* S3 Block Public Accessをアカウント・バケット両方で有効化
* CloudFront OAC経由以外の読み取り禁止
* Worker/APIのIAM Roleは必要なprefixだけアクセス可
* `Current`、`Confirmed`、`Superseded` のprefixごとに権限を分ける
* 署名URL/署名Cookieは短TTL
* ユーザーがアクセス可能なobject keyをAPIで必ず所有者チェック
* S3 object keyに推測可能なIDを使わない
* S3の直接URLやpresigned URLを不用意に返さない

CloudFrontからS3をプライベート配信するなら、AWSはOAIよりOACを推奨しており、OACはSSE-KMSや動的リクエストにも対応します。([AWS ドキュメント][7]) また、S3 Block Public AccessはS3リソースへのパブリックアクセスを中央的に制限する仕組みです。([AWS ドキュメント][8])

CloudFront署名URL/署名Cookieについても注意が必要です。CloudFrontの署名URLは有効期限などの条件を持てますし、カスタムポリシーならIP範囲も条件にできます。署名Cookieは複数ファイルへのアクセスに便利ですが、スコープを広くしすぎると漏えい時の被害範囲が大きくなります。([AWS ドキュメント][9])

特に危険なのは、`/users/*` のような広すぎる署名Cookieを長時間発行することです。漏れたら、その範囲内の資産を期限まで見られます。

---

## 6. 外部AIサービスへ送るデータの扱いがリスク

WorkerがOpenAI APIへ画像・プロンプト・キャラクター情報を送る構成です。ここは明確に**データ越境・第三者処理・機密情報送信**の境界です。

OpenAI Platformの公式ドキュメントでは、APIに送信されたデータは明示的にオプトインしない限り学習には使われないとされています。一方で、デフォルトではabuse monitoring logsにプロンプト・レスポンス等の顧客コンテンツが含まれる可能性があり、最大30日保持されると説明されています。Zero Data RetentionやModified Abuse Monitoringは対象顧客の承認が必要です。([OpenAI Developers][10])

したがって、少なくとも以下は決めるべきです。

* ユーザー画像・プロンプトに個人情報、未成年、機密素材が含まれる可能性をどう扱うか
* OpenAIに送る前にPIIを削るか
* 利用規約・プライバシーポリシーに第三者AI処理を明記するか
* ZDR/MAMが必要な事業領域か
* APIログにプロンプト全文・画像URLを残すか
* OpenAI APIキーの漏えい時に即時停止できるか
* 月額/日額のOpenAI利用上限とkill switchがあるか

この構成で一番現実的な攻撃は、データ盗難だけではありません。**不正生成によるコスト爆発**もあります。盗まれたアカウントや自動作成アカウントで生成ジョブを大量投入されると、SQS・Worker・OpenAIコストが膨らみます。

---

## 7. Workerの外向き通信が広すぎると、侵害時にデータ流出する

図ではWorkerからOpenAI APIへ直接通信しています。ECS Fargateがプライベートサブネットにあっても、NAT Gateway経由で `0.0.0.0/0` へ出られるなら、侵害されたコンテナから外部へデータを送れます。

AWS系サービスへの通信はVPCエンドポイントに寄せるべきです。Secrets ManagerはVPCエンドポイントにより、インターネットゲートウェイやNATなしでAWSネットワーク内通信ができます。([AWS ドキュメント][11]) SQSもVPCエンドポイント経由で、パブリックインターネットを横断せずに接続できます。([AWS ドキュメント][12]) S3もGateway Endpointを使えば、VPCからNAT/Internet Gatewayなしでアクセスできます。([AWS ドキュメント][13])

現実的な対策は以下です。

* S3、SQS、Secrets Manager、ECR、CloudWatch LogsはVPC Endpoint経由
* OpenAI/StripeだけNATまたはEgress Proxy経由
* Egress Proxyで許可ドメインを `api.openai.com`、Stripe API等に限定
* ECS Task RoleをAPI、Page Worker、Character Workerで分離
* WorkerからDB/S3/Secretsへ必要最小限のみ許可
* Security Group egressを無制限にしない
* Network Firewallまたはプロキシで外向き通信ログを保存

ECSでも、ALB配下のサービスはALBのSecurity Groupからの通信だけを許可し、RDS等のVPC内リソースとの通信もSecurity Groupで制御すべきとAWSは説明しています。([AWS ドキュメント][14])

---

## 8. Secrets Managerを使っていても漏れる設計はある

Secrets Managerがあるのはよいですが、次のどれかをやっていると危険です。

* OpenAI APIキーやStripe Secret KeyをSPAの環境変数に入れる
* CloudFront/S3配信されるJSに秘密情報が混ざる
* ECSの全タスクが全シークレットを読める
* APIタスクとWorkerが同じTask Roleを使う
* Secretsを環境変数に注入し、そのままログやデバッグ出力に漏れる
* ECS Execを本番で常時有効にしている

AWSはECSタスクごとにTask Roleを割り当てることで最小権限にできると説明しています。([AWS ドキュメント][15]) また、ECSでSecretsを環境変数として渡す場合、コンテナやログ/デバッグツールから環境変数にアクセスできるため、漏えいリスクが高い点もAWSドキュメントで注意されています。([AWS ドキュメント][16])

この構成なら、最低でも以下のように分けるべきです。

* API Task Role：DB接続、SQS SendMessage、必要最小限のS3 read/write
* Page Worker Role：該当prefixのS3 read/write、SQS receive/delete、OpenAI secret取得
* Character Worker Role：該当処理に必要なSecretのみ
* Stripe Webhook処理Role：Stripe webhook secret、DB ledger更新権限
* 管理者用Role：通常タスクから完全分離

---

## 9. SQSは重複実行を前提にしないと課金・生成が壊れる

SQS + Worker構成で最も危険なのは、**同じジョブが複数回処理される前提を忘れること**です。Amazon SQSのStandard Queueはat-least-once配信で、重複配信や順序入れ替わりがあり得るとAWSが説明しています。([AWS ドキュメント][17])

つまり、Workerは必ず冪等である必要があります。

危険な実装例：

1. APIがクレジットを減らす
2. SQSにjob投入
3. WorkerがOpenAI APIを呼ぶ
4. Workerが失敗
5. visibility timeout後に再実行
6. OpenAI APIをもう一度呼ぶ
7. 画像が二重生成される、またはクレジット整合性が崩れる

必要な対策：

* `job_id` をDBで一意制約
* `idempotency_key` をクライアント・サーバー両方で持つ
* ジョブ状態を `queued -> processing -> succeeded/failed/refunded` の状態機械で管理
* クレジットは「消費」ではなく、まず「予約」にする
* 成功時に確定、失敗時に返却
* Worker開始時にDB row lockまたは条件付きupdate
* 同一job_idが再実行されてもOpenAI呼び出し前に状態確認
* DLQ行きでもクレジットが宙ぶらりんにならない処理

DLQは入っているので方向性はよいですが、DLQは「失敗を隔離する仕組み」であり、「整合性を保証する仕組み」ではありません。DLQに移ったジョブをどう再処理し、クレジットをどう戻すかまで設計が必要です。

---

## 10. StripeはSuccess画面ではなくWebhookを正とする必要がある

図にはStripe Checkout、Customer Portal、Webhook、Credit Ledgerがあります。ここで絶対に避けるべきなのは、**CheckoutのSuccessリダイレクトを見てクレジットを付与すること**です。Success URLはユーザーのブラウザ遷移なので、信用してはいけません。

クレジット付与はStripe Webhookで行い、WebhookではStripe署名を検証し、イベントIDを保存して冪等処理にする必要があります。Stripe公式ドキュメントでも、Webhookには `Stripe-Signature` ヘッダーが付与され、公式ライブラリ等で署名検証すべきと説明されています。([Stripeドキュメント][18])

必要な設計：

* Webhookのraw bodyを保持して署名検証
* `event.id` の一意制約
* `checkout.session.completed` だけでなく、返金・失敗・サブスク更新・キャンセルも処理対象にする
* Stripe Customer IDとCognito user `sub` をDBで固定対応
* クライアントから送られた金額・プランIDを信用しない
* Webhook再送、順序入れ替わり、重複到着を前提にする
* Credit Ledgerはappend-onlyにして、残高は集計または安全なトランザクションで更新

---

## 11. RDS Multi-AZは可用性であって、権限対策ではない

RDS for PostgreSQL Multi-AZは障害耐性には効きますが、認可・暗号化・監査の代わりにはなりません。

必要な確認項目は以下です。

* RDSはPublicly Accessible = false
* RDS SGはAPI/WorkerのSGからの5432のみ許可
* DBユーザーをAPI用、Worker用、管理用で分離
* RDS暗号化を有効化
* スナップショットも暗号化
* 自動バックアップ/PITR有効
* 復旧テストを定期実施
* DB接続情報はSecrets Managerでローテーション
* 管理者アクセスは踏み台/VPN/SSM経由に限定

Amazon RDSはAWS KMSを使ってDB、バックアップ、スナップショット等を暗号化できます。([AWS ドキュメント][19]) SQSもSSE-SQSまたはSSE-KMSでメッセージ本文を暗号化できます。([AWS ドキュメント][20]) S3はデフォルトでSSE-S3暗号化されますが、KMSを使うと鍵ポリシーやCloudTrailでの追跡など、より細かい制御ができます。([AWS ドキュメント][21])

---

## 12. ログに機密情報が出る可能性が高い

この構成ではログに出やすい機密情報が多いです。

* JWT
* Cognito user sub
* OpenAI prompt
* 画像URL
* CloudFront署名URL
* Stripe webhook payload
* Stripe Customer ID
* SQS message body
* DBエラーに含まれるSQL/パラメータ
* OpenAI/Stripe/DBのエラー応答

CloudWatch Logsがあるだけでは不十分です。**何をログに残さないか**を決める必要があります。

対策：

* Authorizationヘッダーはログ禁止
* 署名URLはログでマスク
* prompt全文保存は原則避ける、必要なら暗号化・短期保持
* Stripe payloadは最小限だけ保存
* SQS message bodyに画像本体や長大promptを入れない
* CloudWatch Logs retentionを設定
* KMS暗号化
* ログ閲覧IAMを最小化

---

## 13. 監視が運用監視寄りで、セキュリティ監視が足りない

CloudWatch Logs/Metrics/Alarmsは描かれていますが、セキュリティ観点では不足です。

追加すべきもの：

* CloudTrail有効化
* GuardDuty有効化
* Security Hub有効化
* IAM Access Analyzer
* AWS Config
* S3 public access検知
* WAF logs
* ALB access logs
* CloudFront logs
* VPC Flow Logs
* Secrets Manager `GetSecretValue` 異常検知
* OpenAI利用量急増アラート
* SQS queue depth / DLQ > 0 アラート
* Stripe webhook失敗率アラート

GuardDutyはCloudTrail、VPC Flow Logs、DNS logs等を使って不審な通信や異常行動を検知するサービスです。([AWS ドキュメント][22]) Security Hub CSPMはAWS環境のセキュリティ状態を集約し、標準やベストプラクティスに対する評価を行います。([AWS ドキュメント][23]) Secrets ManagerのAPI呼び出しはCloudTrailに記録されます。([AWS ドキュメント][24])

---

## 14. 将来のモバイル課金は別の攻撃面になる

図の右下にApple In-App Purchase / Google Play Billingの将来拡張があります。これはStripeと同じCredit Ledgerに統合するなら、かなり慎重に設計すべきです。

危険なのは以下です。

* クライアントから「購入成功」と送られた情報を信用する
* レシート再送で二重付与
* 返金・チャージバック・サブスク解約を反映しない
* StripeとApp Store購入の権利状態が競合
* 同一ユーザーの複数ログイン/端末復元でledgerが壊れる

モバイル課金を入れるなら、Stripeとは別のWebhook/receipt検証パイプラインを作り、最終的にCredit Ledgerへappend-onlyで反映する構成が安全です。

---

# 本番前に最低限確認すべきチェックリスト

優先順位はこの順です。

## P0：本番前に必須

1. ALB直アクセスが403になる
2. CloudFront → ALBに秘密ヘッダー + ALB側検証がある
3. ALB SGがCloudFront origin-facing prefix listまたは内部ALB構成に制限されている
4. WAFがCloudFront/ALBに有効
5. S3 Block Public Accessが全バケットで有効
6. CloudFront OACでS3へアクセスしている
7. JWTをAPI側で署名・issuer・audience・scope・期限まで検証している
8. job/image/creditに対して所有者チェックがある
9. Stripe webhook署名検証 + event id冪等処理がある
10. SQS Workerが重複実行されても二重課金・二重生成しない

## P1：早期に必須

11. S3/SQS/Secrets/ECR/CloudWatch LogsのVPC Endpoint化
12. OpenAI/Stripe向けegress制限
13. ECS Task RoleをAPI/Worker/Webhookで分離
14. Secretsの環境変数露出・ログ露出を抑制
15. CloudFront署名URL/署名Cookieを短TTL・狭スコープ化
16. Credit Ledgerをappend-onlyまたは厳密トランザクション設計にする
17. OpenAI送信データの分類・保持・規約反映
18. OpenAI利用量の上限・アラート・kill switch
19. CloudTrail/GuardDuty/Security Hub/Access Analyzer有効化
20. DBバックアップからの復旧テスト

## P2：堅牢化

21. CSP/HSTS/Security Headers
22. 管理者画面の分離、MFA、IP/VPN制限
23. IaC drift検知
24. ECRイメージスキャン、非rootコンテナ、read-only filesystem
25. DLQ再処理手順とクレジット返却ルール
26. S3 lifecycleとユーザー削除要求の整合
27. プロンプト・生成結果のログ最小化
28. 監査ログの改ざん耐性
29. WAF/ALB/CloudFrontログの分析基盤
30. 障害時の生成停止スイッチ

---

## 最終評価

この図の構成は、**ネットワーク分離の方向性は悪くない**です。RDSやECSをプライベートに置き、ALBだけ公開、SQS/DLQ、Secrets Manager、CloudWatchを入れている点は基本形として成立しています。

ただし、本番セキュリティとして見ると、**図に書かれていない部分がそのまま主要リスク**です。特に次の5つは未対応なら重大です。

1. **ALB直アクセス遮断**
2. **S3/CloudFront署名配信の厳密化**
3. **JWT検証 + ユーザー所有権チェック**
4. **SQS/Stripe/Credit Ledgerの冪等性**
5. **OpenAI送信データとegress制御**

この5つが弱いと、侵害パターンはかなり具体的です。
他人の画像取得、クレジット不正消費、生成コスト爆発、OpenAI APIキー悪用、Webhook偽装、S3資産漏えい、ALB直叩きによるWAF回避が起こり得ます。


結論から言うと、**次に加えるべき変更は「インフラをさらに堅牢化すること」より先に、「生成コストの暴走を止める仕組み」です。**
この構成では、初期は **RDS / NAT Gateway / ALB / ECS常時起動** が固定費になりますが、ユーザーが増えると支配的になるのは **OpenAI画像生成費・画像配信費・ログ費用** です。特に画像生成サービスは、不正利用やリトライ設計ミスで一気に赤字化します。

---

# 優先順位1：OpenAI生成ジョブに「原価制御」を入れる

一番先にやるべきです。
図の構成では、SQSにジョブが入るとWorkerがOpenAI APIを呼びます。この時点で、アプリ側に強い制限がないと、攻撃・バグ・リトライ・ヘビーユーザーによって直接コストが発生します。

OpenAIの現行画像生成モデルは、モデル・サイズ・品質で単価差が大きいです。例えば公式ガイド上の `gpt-image-2` の1024×1024画像は、Lowが約 $0.006、Mediumが約 $0.053、Highが約 $0.211 と示されています。単純計算で、Highを1万枚生成すると約 $2,110、Lowなら約 $60 です。ここを制御しない限り、AWS側を細かく節約しても意味が薄いです。([OpenAI Developers][1])

追加すべき変更は以下です。

| 変更         | 内容                                                                                 |
| ---------- | ---------------------------------------------------------------------------------- |
| 生成前の原価見積もり | `model`, `quality`, `size`, `n`, 入力画像枚数から概算原価を計算                                   |
| クレジット予約    | 生成前にユーザーのクレジットを「消費」ではなく「予約」                                                        |
| 生成成功時に確定   | 成功したら予約クレジットを確定消費                                                                  |
| 失敗時に返却     | OpenAI呼び出し前失敗なら返却、呼び出し後失敗ならルールを明確化                                                 |
| 日次・月次の全体上限 | 例：`OPENAI_DAILY_BUDGET_USD` を超えたら新規生成停止                                            |
| ユーザー単位上限   | 無料ユーザー・新規ユーザー・不審ユーザーの生成回数を制限                                                       |
| 同時実行数上限    | Worker数だけでなく、OpenAI呼び出し同時数も制限                                                      |
| 高品質生成の有料化  | Low/Mediumを標準、Highは明確に高いクレジットを消費                                                   |
| `n=1` 原則   | 複数候補をデフォルト生成しない                                                                    |
| 非同期Batch利用 | 急がない生成はBatch価格を使えるか検討。OpenAI価格表では画像生成モデルにもBatch価格が示されています。([OpenAI Developers][2]) |

特に重要なのは、**SQSに入れる前にコスト判定すること**です。
SQS投入後にWorker側で弾く設計だと、キュー滞留、再試行、DLQ処理が複雑になります。

推奨するジョブテーブルの項目はこうです。

```text
generation_jobs
- job_id
- user_id
- job_type
- model
- quality
- size
- estimated_provider_cost_usd
- reserved_credits
- actual_provider_cost_usd
- status: queued / processing / provider_called / succeeded / failed / refunded
- attempt_count
- idempotency_key
- created_at
- completed_at
```

ここまでやらないと、**生成サービスの原価管理ができません**。

---

# 優先順位2：料金設計を「使い放題」ではなく「クレジット制」に寄せる

この種のサービスで、最も危険なのは「月額固定で画像生成し放題」です。
画像生成はユーザーごとの利用量に極端な偏りが出ます。上位数%のヘビーユーザーが原価を食い尽くします。

推奨は、**サブスク + 月次クレジット + 超過課金**です。

例：

| プラン   | 内容                 |
| ----- | ------------------ |
| Free  | 低品質プレビューのみ、日次上限あり  |
| Basic | 月◯クレジット付与、Mediumまで |
| Pro   | 月◯◯クレジット付与、High利用可 |
| 追加購入  | クレジットパック購入         |

Stripe Japanの標準価格では、国内カードの成功取引ごとに3.6%と示されています。つまり、たとえば税込・税抜の扱いを別にして単純化すると、¥1,000の売上でも決済手数料後は約¥964からOpenAI費、AWS費、返金、サポート、人件費を払うことになります。([Stripe][3])

したがって、各生成タイプには最低でも以下を反映させるべきです。

```text
必要クレジット = OpenAI想定原価 + AWS変動費 + 決済手数料 + 失敗/返金バッファ + 利益
```

安全側に倒すなら、最初は**原価の3〜5倍程度の売価**を置いて、実データを見ながら下げる方がよいです。逆に、安く出しすぎると、あとから値上げしてもユーザーの反発が強くなります。

---

# 優先順位3：WorkerをARM64化し、Spotは「使いどころを限定」する

ECS Fargateは維持してよいですが、まず**ARM64 / Graviton対応**に寄せるべきです。AWSは、Fargate on Graviton2について、x86 Fargate比で20%低コスト、最大40%良い価格性能を示しています。([Amazon Web Services, Inc.][4])

ただし、Fargate Spotは慎重に使うべきです。AWSはFargate Spotを通常Fargateより最大70%割引と説明していますが、Spotは中断され得ます。([Amazon Web Services, Inc.][5])

この構成では、WorkerがOpenAI APIを呼びます。
Spot中断でWorkerが落ちた場合、**OpenAI側では生成費が発生したのに、アプリ側では結果を保存できない**という状態が起こり得ます。これは最悪です。

使い分けはこうです。

| 処理                 | 推奨                   |
| ------------------ | -------------------- |
| OpenAI API呼び出し本体   | 原則 On-Demand Fargate |
| サムネイル生成            | Spot可                |
| 画像圧縮               | Spot可                |
| メタデータ整理            | Spot可                |
| Superseded画像のアーカイブ | Spot可                |
| DLQの手動再処理          | Spot可。ただし同時実行数を絞る    |

Workerは以下のように分けるべきです。

```text
page-generation-worker-on-demand
character-generation-worker-on-demand
image-postprocess-worker-spot
archive-worker-spot
dlq-retry-worker-manual
```

さらに、SQSのキューも分けるべきです。

```text
paid-high-priority-queue
normal-generation-queue
postprocess-queue
retry-queue
dlq
```

これにより、有料ユーザーの生成と、低優先度の後処理を同じWorkerプールで奪い合わなくなります。

---

# 優先順位4：API基盤は「低トラフィックならLambda化」を検討する

現在の図では、CloudFront → ALB → ECS Fargate API です。
これは本番向きですが、**初期フェーズでは固定費がやや重い**です。

選択肢は2つです。

## 案A：現構成を維持する

向いている条件：

* APIが常時そこそこ呼ばれる
* Docker前提の実装がすでにある
* RDS接続を安定管理したい
* コールドスタートを避けたい
* 将来の負荷が読めている

この場合は、APIタスクもARM64化し、最小タスク数を段階的に変えます。

| フェーズ      | APIタスク数          |
| --------- | ---------------- |
| 検証・MVP    | min 1            |
| 課金開始後     | min 2            |
| SLAを掲げる段階 | Multi-AZでmin 2以上 |

ALBは時間課金とLCU課金があります。AWSの料金例ではALBに時間あたり料金とLCU料金が加算される形が示されています。低トラフィックでもALB固定費はゼロにはなりません。([Amazon Web Services, Inc.][6])

## 案B：API Gateway HTTP API + Lambdaに寄せる

向いている条件：

* 初期トラフィックが少ない
* APIが軽いCRUD中心
* 長時間処理はSQS Workerに逃がせる
* WebSocketや常時接続が不要
* Lambdaのコールドスタートを許容できる

API Gatewayは最低料金・前払いなしで、HTTP API / REST APIはAPIコール数とデータ転送量に課金されます。Lambdaもリクエスト数とGB秒ベースで課金され、無料枠もあります。([Amazon Web Services, Inc.][7])

ただし、Lambda + RDSは接続数管理が問題になります。使うなら以下が必要です。

* RDS Proxyの検討
* DB接続の再利用
* Lambda同時実行数の上限設定
* 管理系APIと公開APIの分離
* 重い処理は絶対にLambdaでやらずSQSへ逃がす

個人的には、**API実装がまだ固まっていないならLambda案を検証**、すでにECS前提で作っているなら**ECSのままARM64化 + min 1/2調整**が現実的です。

---

# 優先順位5：ALBを残すなら「内部ALB + CloudFront VPC Origin」を検討する

セキュリティ面でもコスト面でも、ALBを直接パブリックに出す理由は弱くなっています。
CloudFront VPC originsを使うと、プライベートサブネット内のALB/NLB/EC2をCloudFrontオリジンとして使えます。AWSのドキュメントでも、VPC originのオリジンリソースとしてプライベートサブネット内のALB等が説明されています。([AWS ドキュメント][8])

これにより、

* ALB直アクセスを根本的に防ぎやすい
* CloudFrontだけを入口にできる
* ALBのパブリックIPv4利用を避けやすい
* WAF/CloudFront側に防御を集約しやすい

というメリットがあります。

ALB料金ページでも、ロードバランサーで使うパブリックIPv4アドレスには標準のパブリックIPv4アドレス料金が発生すると説明されています。([Amazon Web Services, Inc.][6])

ただし、ALB自体の時間課金は残ります。
したがって、**ALBをなくしたいなら API Gateway + Lambda**、**ALBを残すなら internal ALB + CloudFront VPC Origin** という整理です。

---

# 優先順位6：RDS Multi-AZは「本当に今必要か」を判断する

図ではRDS for PostgreSQL Multi-AZです。これは堅いですが、初期コストは重くなります。
AWSの説明では、Multi-AZ配置では別AZにスタンバイをプロビジョニングし、計画停止・非計画停止時に自動フェイルオーバーします。つまりこれは**可用性のための費用**であって、セキュリティのための費用ではありません。([Amazon Web Services, Inc.][9])

判断基準はこうです。

| 状況            | 推奨                       |
| ------------- | ------------------------ |
| まだ検証段階        | Single-AZ RDS + 自動バックアップ |
| 無料β           | Single-AZでも可。ただし復旧手順を用意  |
| 課金ユーザーあり      | Multi-AZ推奨               |
| 売上停止が大きな損失になる | Multi-AZ必須               |
| SLAを出す        | Multi-AZ必須               |

ただし、Single-AZにするなら最低限これが必要です。

* 自動バックアップ有効
* PITR有効
* スナップショット暗号化
* 復旧手順を実際にテスト
* DBスキーママイグレーションのロールバック手順
* Credit Ledgerはappend-only
* Stripe WebhookイベントIDの一意制約

RDSのT3/T4g系を使う場合はCPUクレジットにも注意が必要です。AWSはRDS for PostgreSQLのT4g/T3がUnlimitedモードで動作し、24時間平均でベースラインを超えるとCPUクレジット追加料金が発生すると説明しています。([Amazon Web Services, Inc.][9])

RDS費用が安定してきたら、Reserved Instanceを検討します。AWSはRDS Reserved Instanceについて、1年または3年契約でオンデマンドより割引を受けられると説明しています。([Amazon Web Services, Inc.][9])

注意点として、**Aurora Serverlessにすれば安くなるとは限りません**。小規模・常時稼働・単純CRUDなら、普通のRDS PostgreSQLの小さいGraviton系インスタンスの方が安いことがあります。Aurora移行は、負荷パターンを測ってからでよいです。

---

# 優先順位7：NAT GatewayとVPC Endpointを「安全だが過剰にしない」

セキュリティだけ見ると、S3/SQS/Secrets/ECR/CloudWatch LogsなどはVPC Endpoint化したくなります。
ただし、コスト面では**全部入れれば安くなるわけではありません**。

NAT Gatewayは、利用可能な時間と処理したGBごとに課金されます。さらに、NAT Gatewayを複数AZに置くとAZ単位の固定費が増えます。([Amazon Web Services, Inc.][10])

一方で、Interface型VPC Endpoint、つまりAWS PrivateLinkも、各AZでエンドポイントがプロビジョニングされている時間と、処理データ量に対して課金されます。([Amazon Web Services, Inc.][11])

したがって、推奨はこうです。

## すぐ入れる

**S3 Gateway Endpoint**。
S3 Gateway Endpointは追加料金なしで利用でき、VPCからS3へNATなしでアクセスできます。これはコスト・セキュリティ両面でほぼ無条件に入れるべきです。([AWS ドキュメント][12])

## 条件付きで入れる

| Endpoint                 | 判断                            |
| ------------------------ | ----------------------------- |
| SQS Interface Endpoint   | SQS通信量が多い、またはNATを減らしたいなら入れる   |
| Secrets Manager Endpoint | セキュリティ優先なら入れる。ただし固定費に注意       |
| ECR Endpoint             | Fargate起動頻度が高いなら入れる           |
| CloudWatch Logs Endpoint | ログ量が多いならNAT削減になるが、ログ自体を減らす方が先 |
| KMS Endpoint             | KMS呼び出しが多い・閉域要件があるなら入れる       |

重要なのは、**OpenAIとStripeに出る通信は結局インターネット向きegressが必要**という点です。NATを完全になくすのは難しいです。
したがって、MVPでは以下が現実的です。

```text
S3 Gateway Endpoint：必須
NAT Gateway：OpenAI / Stripe 用に維持
Interface Endpoint：SQS / Secrets / ECR から順に費用対効果で追加
```

---

# 優先順位8：S3画像ストレージは「状態別ライフサイクル」を明確にする

図には `Current → Confirmed → Superseded → Deep Archive` の流れがあります。これは方向性として良いです。
ただし、さらにコストを下げるなら、状態別に「消すもの」「残すもの」「圧縮するもの」を明確にしてください。

推奨は以下です。

| 種別                    | 保存先                                | ライフサイクル                          |
| --------------------- | ---------------------------------- | -------------------------------- |
| 編集中画像 `current/`      | S3 Standard                        | 7〜14日で削除                         |
| 確定画像 `confirmed/`     | S3 Standard or Intelligent-Tiering | アクセス頻度が読めないならIntelligent-Tiering |
| 上書き済み画像 `superseded/` | 原則削除                               | 30〜90日後削除                        |
| 法務・監査上必要な画像           | Deep Archive                       | 復元が遅い前提で保存                       |
| サムネイル                 | S3 Standard                        | 長期キャッシュ                          |
| 表示用WebP/AVIF          | S3 Standard                        | CloudFront配信用                    |
| オリジナル高解像度             | private                            | 直接配信しない                          |

S3 Intelligent-Tieringはアクセスパターンに応じて階層移動しますが、オブジェクトごとのモニタリング・自動化料金があります。また、128KB未満のオブジェクトは自動階層化の対象外です。画像ファイルは通常128KBを超えやすいので相性は悪くありませんが、細かいメタデータや小ファイルに使うと無駄が出ます。([Amazon Web Services, Inc.][13])

さらに重要なのは、**CloudFrontで配る画像をオリジナルにしないこと**です。

最低限この3種類を作るべきです。

```text
original.png        // 非公開・再編集用
display.webp        // 通常表示用
thumb.webp          // 一覧・履歴用
```

一覧画面で毎回オリジナルを配信すると、CloudFront転送量とS3 GETが増えます。生成AIサービスでは、画像そのものより**画像配信量**が後から効いてきます。

---

# 優先順位9：CloudWatch Logsを絞る

CloudWatchは便利ですが、ログを雑に出すと費用が増えます。
AWSのCloudWatch料金例でも、ログ取り込みGB単位、アーカイブGB単位、カスタムメトリクス数に応じた料金が示されています。特に大量ログ・大量カスタムメトリクスはコスト要因になります。([Amazon Web Services, Inc.][14])

この構成でやるべきことは明確です。

| 対象             | 推奨                 |
| -------------- | ------------------ |
| ECS APIログ      | 14〜30日保持           |
| Workerログ       | 14〜30日保持           |
| エラーログ          | 90日程度              |
| 監査ログ           | S3に長期保存            |
| ALBアクセスログ      | S3保存               |
| CloudFront標準ログ | S3保存               |
| prompt全文       | 原則保存しない。必要なら短期・暗号化 |
| base64画像       | 絶対にログに出さない         |
| JWT / 署名URL    | マスク                |

特に、OpenAIに送るpromptや画像URLを全ログに残すのは避けるべきです。
セキュリティリスクであると同時に、ログ量の面でも無駄です。

---

# 優先順位10：WAFは削らない。ただし高額オプションは後回し

コストを意識しても、WAFは削るべきではありません。
理由は単純で、WAF費用よりも、BotによるOpenAI生成費の方がはるかに危険だからです。

AWS WAFはWeb ACL、ルール、リクエスト数に応じた料金体系で、Bot ControlやCAPTCHAなどは追加費用が発生します。([Amazon Web Services, Inc.][15])

推奨はこうです。

## 最初から入れる

* AWS Managed Rules Common Rule Set
* Amazon IP Reputation List
* Anonymous IP List
* 生成APIへのRate-based rule
* ログインAPIへのRate-based rule
* `/api/jobs` への厳しめの制限
* 国・ASN制限は必要に応じて

## 後回し

* Bot Control
* CAPTCHA多用
* Fraud Control
* 高価なMarketplace Managed Rule

つまり、**標準WAF + レート制限 + 生成API保護**を最小構成で入れ、Bot Controlは攻撃傾向を見てからでよいです。

---

# 優先順位11：AWS Budgets / Cost Anomaly Detection / Kill Switchを必ず入れる

コスト最適化で一番重要なのは、安くすることではなく、**予期せぬ請求を止めること**です。

AWS Budgetsは予算しきい値を超えた、または超過予測されたときに通知でき、アクション付きBudgetも最初の2つは無料です。([Amazon Web Services, Inc.][16])
AWS Cost Anomaly Detectionは機械学習で異常支出と根本原因を検出し、SNSやメールで通知できます。([Amazon Web Services, Inc.][17])

入れるべき制御はこれです。

```text
AWS総額 月次予算
OpenAI 日次予算
OpenAI 月次予算
S3転送量アラート
CloudWatch Logs取り込み量アラート
NAT Gatewayデータ処理量アラート
SQS DLQ > 0 アラート
Worker同時実行数アラート
Stripe webhook失敗率アラート
```

Kill Switchは必須です。

```text
generation_enabled = false
high_quality_generation_enabled = false
free_user_generation_enabled = false
worker_max_concurrency = 0
```

これをDBまたはSSM Parameter Storeで持ち、APIとWorkerが必ず参照するようにします。
障害時にECS Serviceのdesired countを手動で変える運用は遅すぎます。

---

# 優先順位12：コミット割引は「実績が出てから」

Savings PlansやReserved Instanceは、使い方を誤ると節約ではなく固定費化します。

Compute Savings PlansはEC2、Lambda、Fargateに適用でき、最大66%のコスト削減が可能と説明されています。([Amazon Web Services, Inc.][18])
ただし、これは**一定使用量へのコミット**です。需要が読めない段階で買うべきではありません。

推奨タイミングは以下です。

| タイミング             | やること                                 |
| ----------------- | ------------------------------------ |
| リリース前             | 何も買わない                               |
| リリース後30日          | Cost Explorerで日次使用量を見る               |
| 60〜90日後           | 最低利用ラインだけSavings Plan検討              |
| RDS安定後            | RDS RI検討                             |
| CloudFront転送量が安定後 | CloudFront Security Savings Bundle検討 |

CloudFront Security Savings Bundleは、1年の月額利用コミットと引き換えにCloudFront請求を最大30%節約でき、コミット額の10%までAWS WAF利用も含むとAWSが説明しています。([Amazon Web Services, Inc.][19])

ただし、これも最初から買うものではありません。
画像配信量が読めるようになってからで十分です。

---

# 優先順位13：モバイル課金は後回し

図では将来拡張としてApple In-App Purchase / Google Play Billingがあります。
コスト面だけ見れば、最初からモバイル課金を入れるのは不利です。

AppleのSmall Business Programは条件を満たすと15%コミッションになります。([Apple Developer][20])
Google Playも、サービスフィー対象デベロッパーの99%が15%以下のフィー対象と説明しています。([Googleヘルプ][21])

これはStripe Japanの国内カード3.6%と比べると、かなり重いです。もちろん、アプリ内デジタルコンテンツ販売ではストアポリシー上IAPが必要になる場合がありますが、**Webで課金モデルと原価構造を検証してからモバイルに広げる**方が安全です。

---

# 変更後の推奨構成

コスト重視で現実的に組むなら、まずはこうです。

```text
ユーザー
  ↓
CloudFront + WAF
  ↓
S3 SPA

API案A：
CloudFront → internal ALB → ECS Fargate API ARM64

API案B：
CloudFront → API Gateway HTTP API → Lambda

生成：
API → DBでクレジット予約 → SQS
SQS → ECS Fargate Worker ARM64
Worker → OpenAI API
Worker → S3保存
Worker → DB状態更新

画像：
S3 original/private
S3 display.webp
S3 thumb.webp
CloudFront signed URL/cookie

ネットワーク：
S3 Gateway Endpoint
NAT Gateway for OpenAI/Stripe
Interface EndpointはSQS/Secrets/ECRから段階導入

コスト制御：
AWS Budgets
Cost Anomaly Detection
OpenAI daily/monthly cap
generation kill switch
worker concurrency cap
```

---

# やらない方がいい変更

コスト面を強く見るなら、次は後回しです。

| 後回しにすべきもの                    | 理由                       |
| ---------------------------- | ------------------------ |
| Kubernetes / EKS             | この規模では運用・固定費が重い          |
| OpenSearch                   | 検索要件が固まるまで不要             |
| ElastiCache                  | DB負荷が実測されるまで不要           |
| 全AWSサービスのInterface Endpoint化 | 固定費が増える                  |
| Multi-Region Active-Active   | 初期には過剰                   |
| WAF Bot Control常時ON          | まず標準WAFとRate Limitで様子を見る |
| 画像オリジナルの長期Standard保存         | S3費・配信費が増える              |
| CloudWatchへの全アクセスログ投入        | ログ費用が増える                 |
| 早期のSavings Plans購入           | 需要未確定だと固定費化              |
| 使い放題プラン                      | 生成AIでは赤字化しやすい            |

---

# 最短の実行順

実装順はこれがよいです。

## まず1週間以内

1. OpenAI日次/月次予算を設定
2. 生成APIにユーザー単位・IP単位レート制限
3. `generation_enabled` kill switch追加
4. ジョブ投入前のクレジット予約
5. Worker同時実行数の上限
6. S3 Gateway Endpoint追加
7. CloudWatch Logs retention設定
8. WAFをCloudFrontに設定

## 次の2〜4週間

9. ECS API/WorkerのARM64化
10. WorkerをOn-Demand系とSpot可系に分離
11. S3画像の `original/display/thumb` 分離
12. S3 lifecycle設定
13. Cost Anomaly Detection設定
14. API Gateway + Lambda案のPoC
15. RDS Multi-AZ継続可否を判断

## 60〜90日後

16. 実コストから生成クレジット単価を見直し
17. RDS RI検討
18. Compute Savings Plans検討
19. CloudFront Security Savings Bundle検討
20. モバイル課金導入可否を判断

---

# 最終判断

この構成でコスト面を強く加味するなら、**AWSの細かい節約よりも、生成原価の制御が最優先**です。

優先度はこうです。

1. **OpenAI生成費の上限・見積もり・クレジット予約**
2. **使い放題ではなくクレジット制**
3. **WorkerのARM64化**
4. **Workerの同時実行数制限**
5. **S3 Gateway Endpoint**
6. **S3画像の圧縮・派生画像・ライフサイクル**
7. **CloudWatch Logs削減**
8. **初期フェーズのRDS Multi-AZ見直し**
9. **API基盤のLambda化検討**
10. **実績が出てからSavings Plans / RI**

一番避けるべき失敗は、**インフラ費を月数十ドル削るために時間を使い、OpenAI生成費が数千ドル膨らむ設計を放置すること**です。
このサービスのコストリスクは、サーバー代ではなく、生成ジョブの原価管理にあります。

