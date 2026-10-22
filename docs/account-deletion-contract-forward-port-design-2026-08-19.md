# アカウント削除契約の安全な前方移植設計（2026-08-19）

## 0. 設計ステータス

この文書は設計のみであり、コード、DB、本番設定、ECS、Cognito、S3、Stripe を
変更しない。実装と本番復旧は、本文の TDD、リリースゲート、停止条件を満たす
別工程とする。

現時点では、アカウント削除 API と recovery worker を有効化してはならない。
稼働 API の削除契約と、復旧候補 worker の削除契約が一致していないためである。
この文書とartifact guardを含むPRをmainへmergeしただけでも復旧完了にはならない。
実装は、稼働release sourceを基点にした専用integration branchで行う。

## 1. 目的と非対象

### 目的

公開済み Mobile のアカウント削除 API 契約を変えずに、次を同じレビュー済み
source revision へ揃える。

- API の削除受付、blocker 判定、acknowledgement 変換
- DB schema、claim、checkpoint、recovery fencing
- Cognito、S3、Stripe の削除 adapter
- 削除開始後の再 provisioning、課金権利復活、個人 content 再作成の防止
- recovery worker の artifact、task definition、実行時設定

### 非対象

- Mobile / Web の画面変更、新しい公開 API v2、AAB / iOS build
- 組織作品、組織課金、法令・会計用 ledger の削除
- App Store / Google Play subscription のサーバー側強制解約
- export 機能や generation 機能の別系列の同期
- 適用済み migration の編集、migration history の手動更新、down migration
- 既存の欠落した worker image を rollback artifact として復元すること

## 2. Spec 根拠

- `docs/Lyra_Unified_Spec_v4.md` Account deletion:
  - Cognito subject を匿名化する前に keyed one-way identity tombstone を保存する。
  - processing / recovery pending / completed の identity を再 provisioning しない。
  - 削除開始後の personal root write を DB guard でも拒否する。
  - client から user ID、identity ID、subscription ID、S3 key を受け取らない。
  - provider operation は exact target、timeout、idempotency を持つ。
  - recovery は processing token、backoff、bounded batch / time で行う。
  - provider の遅延 event が plan / credit を復活させない。
- 詳細な削除順序と保持対象は
  `docs/account-deletion-backend-design-2026-07-31.md` を参照する。ただし実装時の最終契約は
  Unified Spec、forward migration、Route / Service、executable tests の順で確認する。
- この文書は上記契約を、現在の production release fork へ安全に移植する方法だけを
 追加定義する。

## 3. 現在の不整合と直接復旧を禁止する理由

read-only 調査時点の production は次の状態である。

- API は旧削除契約を持つ release source から稼働している。
- account-deletion worker service は `desired=0 / running=0` である。
- 登録済み worker task definition の image digest は ECR から削除済みである。
- production DB には migration 037 相当の column、index、trigger が存在する。
- `account_deletion_requests` は 0 件で、legacy recovery 対象も 0 件だった。

一方、復旧候補 worker は `identity_key`、`next_retry_at`、processing-token fencing、
exact S3 delete、bounded recovery を前提にする。旧 API は異なる acknowledgement と
checkpoint を書く。この二つを同時に稼働させると、次の破綻を作り得る。

- identity tombstone を保存しない request を新 worker が claim する。
- `scheduled_asset_keys` を「実際に削除済み」と誤解し、未削除 object を残す。
- token で fence されない旧 checkpoint と recovery が競合する。
- 削除後の有効 JWT、Stripe webhook、store event が user / plan / credit を復活させる。
- API と worker で blocker、lock order、completion 条件が異なる。

したがって、worker image だけを再作成して service を起動する案は **NO-GO** とする。

## 4. 最小変更の基本方針

### 4.1 公開 API は legacy 契約を維持する

今回維持する endpoint は次だけである。

- `GET /api/account/deletion-preview`
- `POST /api/account/deletion`

POST body は公開済み Mobile と同じ strict schema を維持する。

- `confirmation`
- `acknowledge_active_subscription`
- `acknowledge_confirmed_assets`

内部では次のように安全な service input へ変換する。

- `acknowledge_active_subscription`
  → personal Stripe subscription と Apple / Google store billing の両方への明示確認
- `acknowledge_confirmed_assets`
  → personal asset の exact delete への明示確認

legacy response adapter は次の固定表だけを使う。別の意味を持つ blocker / action へ
便宜的に変換しない。

| 内部結果 | legacy 応答 |
| --- | --- |
| `UNIQUE_ORGANIZATION_OWNER` | 同名 blocker をそのまま返す |
| personal Stripe + store subscription | 合計件数を1件の `ACTIVE_PERSONAL_SUBSCRIPTION` として返す |
| `PERSONAL_ASSETS` | `CONFIRMED_PERSONAL_ASSETS` として件数を返す |
| `ACTIVE_PERSONAL_JOB` | destructive service を開始せず、productionでsanitizedされるglobal API error envelopeのHTTP `503`を返す |
| `cancel_personal_subscriptions` | `cancel_subscription` |
| `delete_personal_assets` | 偽の lifecycle action に変換せず `in_progress` |
| `anonymize_personal_data` / `disable_identity` / `delete_identity` | legacy の同名 action |

legacy preview は Stripe と store の件数を従来どおり個別・合計で返す。active job は
preview schema に追加せず、POST の transaction 内再検証で上記 503 とする。特定の内部
error codeがproductionで公開されることには依存せず、HTTP statusとglobal error schemaだけを
互換契約にする。公開済み
Mobile は200 / 202 / 409だけを削除結果schemaでparseし、それ以外をglobal API errorとして
扱うため、503なら既存の汎用再試行表示へ安全に入る。job を subscription 等へ誤表示しない。

provider ID、S3 key、identity、raw error は返さない。今回 v2 endpoint を追加しない。
公開契約と Mobile binary を変えないことで、復旧範囲を Backend / DB / Worker / Ops に
限定する。

### 4.2 maintenance gate を最初に配備する

最初の実装 slice は、`ACCOUNT_DELETION_ENABLED=false` のとき GET / POST の両方を
Repository や provider に到達する前に stable `503` で拒否する route gate とする。
この containment を先に配備し、旧 API が移行中に旧形式 request を作れないことを
確認する。

feature flag は既定 `false`。true のときだけ route を有効化し、Cognito、S3、
Stripe、identity HMAC、recovery 設定が一つでも不足すれば起動時に fail closed する。

### 4.3 同一 source revision と同一 runtime contract

API と worker は同じ reviewed source revision から一度だけ同じ Linux ARM64 image を
build する。別系列の file copy や古い API image の worker 利用は禁止する。image は
API repository と worker 専用 ECR repository へ同一 manifest として保存してよいが、
OCI revision label、content digest、runtime code、Repository / Service / adapter factory
が一致しなければならない。

API task は image の default API command を使う。worker task は `entryPoint=[]`、
`command=["/usr/local/bin/bun", "dist/scripts/startProductionAccountDeletionWorker.js"]`、
`runtimePlatform=LINUX/ARM64` を明示する。task definition 登録前に両 repository の digest、
OCI revision、architecture、worker entrypoint を相互検証する。
worker task definition は、承認済み image / command / entryPoint / runtimePlatform / shutdown
設定以外の task role、execution role、secret reference、network、logging、CPU、memoryを
直前の承認済み定義から変えない。差分をmachine-readableに検査する。
API task definitionも同様に、変更をimage digest、`ACCOUNT_DELETION_ENABLED`、承認済みの
新env referenceだけへ限定する。task role、execution role、secret、network、logging、CPU、
memory、health check、port、API commandを保持し、machine-readableに差分検査する。

## 5. 影響レイヤーと移植単位

広い commit の cherry-pick や main 全体の同期は行わない。production release fork に、
account deletion に必要な hunk だけを TDD で手動移植する。

| Layer | 移植する責任 | 移植しないもの |
| --- | --- | --- |
| Route / API contract | legacy GET/POST、strict validation、503 gate、response adapter | 新v2公開API、Mobile UI |
| Domain | blocker、checkpoint、stable failure code、bounded recovery constants | 無関係な generation/export 契約 |
| Service | preview、claim、external step、final revalidation、completion | provider SDK 詳細 |
| Repository | parameterized SQL、lock order、processing-token fencing、recovery claim | 動的な未許可 table 名 |
| Infrastructure | HMAC、exact S3 delete、Stripe cancel、Cognito disable/delete、timeout | prefix delete、client-derived ID/key |
| Auth | provisioning 前の identity/deletion guard | 通常 user の認証方式変更 |
| Billing | deletion 開始後 event の dedupe と権利非復活 | ledger の物理削除 |
| Organization | sole-owner と member mutation の共通 lock order | 組織データ削除 |
| Worker / Ops | bounded runner、専用artifact、同SHA preflight | desired count の設計時変更 |

移植元の account-deletion 実装を参照しても、Repository の recovery claim は曖昧な
`RETURNING` を修正済みの形にする。file 全体を上書きせず、release fork に後から入った
billing / scheduled-plan 等の処理を保持する。

## 6. 内部削除契約

### 6.1 claim と identity tombstone

claim transaction は user と organization を既定順で lock し、sole owner、active job、
subscription、store billing、asset、acknowledgement を再検証した後、同時に次を保存する。

- `users.account_deletion_started_at`
- `account_deletion_requests.identity_key`
- `processing_token`
- `processing_started_at`

`identity_key` は専用 secret による `HMAC-SHA256(Cognito subject)` の base64url である。
raw subject を tombstone や log に保存しない。ただし recovery 中の Cognito 操作には
対象 identity が必要なため、認可・fenceされた request の `identity_id` に完了まで一時
保持する。Cognito delete 後の completion で `identity_id` を匿名値へ置換し、復元不能な
`identity_key` だけを tombstone として残す。HMAC secret の rotation はこの工程に含めず、
API と worker が同じ version を使う。

全 checkpoint 更新は `user_id + processing_token` が一致した場合だけ成功させる。
stale worker が別 claim の進捗や別 user を更新できないようにする。

### 6.2 外部操作と checkpoint

- Stripe: personal subscription ID だけを stable idempotency key で cancel する。
- S3: DB が返した personal exact object key だけを `DeleteObject` する。
- Cognito: configured pool の対象 user だけを disable / delete する。
- 既キャンセル、既不存在、UserNotFound は冪等成功として扱う。
- Cognito / S3 command は 30 秒 timeout とする。
- 成功した S3 key だけを deletion checkpoint に記録する。

1 attempt は最大 25 external steps、15 秒で新しい外部操作の開始を止める。上限到達は
失敗ではなく continuation とし、retry count を増やさず claim を解放する。provider
failure は raw error ではなく stable code と `next_retry_at` を保存する。

### 6.3 final revalidation と completion

completion transaction は claim 時と同じ lock order で最新状態を再走査する。preview
以後に増えた asset、subscription、store billing、active job、owner blocker があれば
完了しない。個人データの削除・匿名化と `account_deleted_at` 保存後、Cognito identity
を削除し、最後に raw identity / subscription / S3 checkpoint を scrub する。

organization content、organization billing、credit/payment/store ledgers は物理削除せず、
匿名化した user anchor と会計・監査整合性を維持する。

## 7. 再作成と late-event の防止

### 7.1 provisioning guard

identity tombstone の検査は `findBySupabaseId` の既存 user 早期 return より前に行う。
既存 user でも `account_deletion_started_at` がある場合は復活させない。email linking、
unique violation 後の再取得、signup bonus 付与の各分岐も同じ guard を通す。

claim と provisioning の競合 test を追加し、削除開始と同時に別 request が user を
再作成・再リンクできないことを確認する。application guard だけでなく、personal
content root の DB trigger も防御層として残す。

### 7.2 billing / store / organization

削除開始後の Stripe / Apple / Google event は provider event として冪等記録してよいが、
personal plan、credit、monthly allowance を復活させない。account deletion と owner
移譲・member remove は organization row を先に ID 順で lock して直列化する。

## 8. Migration 042 / 043 の forward-only 設計

### 8.1 migration 番号を再利用しない

production 物理 schema には migration 037 相当の object が存在する一方、稼働 release
fork の source migration 列は別の 032 / 035 / 036 を持ち、040 / 041 まで進んでいる。
main の `037_connect_account_deletion.sql` は `episode_export_jobs` を前提にするため、
release fork へそのまま追加・再実行してはならない。

新しい未使用番号を merge 直前に確認し、現時点では責任を次の二つへ分離する。

- `042_forward_port_account_deletion_state.sql`: request / user の物理 schema、constraint、index
- `043_connect_account_deletion_write_guards.sql`: export 互換 view、guard function、trigger

適用済み migration は編集せず、`schema_migrations` を手作業で書き換えない。

### 8.2 additive schema

042 は transaction 内で次を additive に整備・検査する。

- `users.account_deletion_started_at` / `account_deleted_at`
- request の `identity_key` / `next_retry_at` / processing fencing columns
- identity shape、timestamp order、processing-token pair、status/checkpoint constraints
- identity-key partial unique index
- recovery 用の新しい partial index 名

production request 0件と全asset checkpoint空を再確認した上で、上流の安全契約どおり
既存 `scheduled_asset_keys` を「exact delete 成功済み key」のcheckpointとして使う。
非空の legacy row が1件でもあれば migration / activation を止め、意味を推測しない。
completion 時は raw key array を scrub する。独自の永続 column は追加しない。

同名 object が存在していても定義が異なる場合は、黙って `IF NOT EXISTS` で通さず、
PII を含まない固定 error code で migration を abort する。

042 / 043 は `lock_timeout` と `statement_timeout` を明示する。既存大tableに対する check は
まず `NOT VALID` で追加し、catalog / data invariant が通った後の別stepで `VALIDATE
CONSTRAINT` する。timeout時はtransactionをrollbackし、無期限に本番writeを待たせない。

### 8.3 export table fork の adapter

環境により `export_jobs`、`episode_export_jobs`、両方、どちらも無しの4形状があり得る。
実装前preflightは table / column / index / trigger / function definitionをobject単位で保存し、
「037相当」という粗い判定を使わない。043 は存在する table に write guard trigger を
付け、両方ある場合は両方に付ける。

Repository から table 名を分岐させず、共通列だけを投影する
`account_deletion_export_jobs` view を migration が作る。

- `id`
- `user_id`
- `organization_id`
- `status`
- `artifact_s3_key`
- `artifact_deleted_at`

片方ならその table、両方なら `UNION ALL` とする。どちらも無い場合は、export featureが
false、対応outboxも無い、active export を保存できるrelationが無いことをpreflightで確認し、
同じ列型を持つ空 view を作る。この形状では deletion feature の起動時guardも export feature
false を必須にする。exportを後日有効化するときは、そのmigrationでviewを実tableへ張り直す。

動的 SQL の table 名はこの固定 allowlist だけを使う。fresh release schema、
production-like schema、両table存在、どちらも無しの四形状を PostgreSQL integration test
で検証する。

write guard は両export tableで「削除開始前からactiveだったjobのterminal化」は許可し、
新規root、terminal→active、owner変更を拒否する。他の personal-root table と併せ、
trigger function と実PostgreSQL testでこの差を固定する。

### 8.4 legacy row gate

`blocked` request の null `identity_key` は worker 対象外として許容できる。
`processing`、`pending_external_action`、`completed` の null は activation **NO-GO** とする。
HMAC secret を migration へ渡さず、推測で backfill しない。該当行が見つかった場合は、
本人 identity を安全に取得できる別の認可済み repair workflow を設計する。

既知 production は request 0 件だが、migration と feature activation の直前に aggregate
count を再確認する。

## 9. TDD と検証計画

コード変更時は次の RED を先に作る。今回は設計のみなのでテスト追加は行わない。

### Route / contract

1. flag false の GET / POST はsanitizedなglobal error schemaの503、Repository/provider callは0回。
2. legacy GET / POST body、status、response が公開済み schema と完全一致する。
3. mixed / unknown field は strict validation で拒否する。
4. legacy acknowledgement が内部の Stripe/store/assets へ正しく変換される。
5. `ACTIVE_PERSONAL_JOB` はaccount deletion resultとしてparseされる409を返さず、503 global
   errorとなり、production-modeの公開済みMobile clientが汎用ApiErrorとして扱う。
6. active-job 503ではclaim、provider call、deletion-start timestamp、checkpoint writeが0回。

### Repository / migration

1. claim が identity key、started timestamp、processing token を原子的に保存する。
2. recovery claim の qualified `RETURNING` が実 PostgreSQL で成功する。
3. token 不一致の checkpoint update は 0 rows で拒否される。
4. 042 / 043 が export relation の四形状で成功する。
5. object 名だけ同じで定義が異なる場合、042 / 043 は修復せず失敗する。
6. active/pending/completed の null identity と constraint / trigger drift を invariant が検出する。
7. export job は active→terminalだけ許可し、新規・terminal→active・owner変更を拒否する。
8. activation invariantは追加した全constraintの`pg_constraint.convalidated=true`を要求する。

### Service / provider / concurrency

1. exact S3 delete、Stripe/Cognito の idempotency、30秒timeout。
2. 25 steps / 15秒 budget、continuation、backoff、stale claim。
3. final rescan が preview 後の asset / subscription / job を検出する。
4. sole-owner mutation と deletion の競合で owner invariant が壊れない。
5. provisioning-vs-claim race で user / bonus / content が再作成されない。
6. deletion 後の Stripe/store event は dedupe されても entitlement を復活させない。

### Release gate

- 対象 Vitest、Repository PostgreSQL integration、migration test
- `npm run build`
- `npm run db:check-invariants`
- full Backend/Web/Mobile verification gate
- Docker Linux ARM64、worker command / entrypoint、OCI revision / digest、API/worker同一SHA preflight
- disposable account による preview → execute → recovery → re-login拒否の staging E2E

## 10. 実装と本番展開の段階

各段階は独立した review / stop point を持つ。

1. **Containment**: legacy API の 503 gate を flag false で配備。DB/provider call 0 を確認。
2. **Schema preflight**: request、checkpoint、export四形状、catalog定義をaggregateで確認。
3. **Migration**: 042で`NOT VALID` constraintまで追加し、aggregate/data invariantを実行する。
   043のtransaction冒頭で`VALIDATE CONSTRAINT`を完了してからview/function/triggerを接続し、
   再度invariantを実行する。未検証constraintのままAPI/workerを有効化しない。
4. **Final artifact**: legacy compatibility、provisioning、billing/store、organization guardを含む
   exact SHAからLinux ARM64 imageを一度だけbuildし、API/worker両repositoryへ保存・preflightする。
   dedicated repositoryはtag immutableとし、task definitionは常にdigest pinする。lifecycleの
   保持数は将来の上限であり、存在しない過去rollback artifactの証明とは扱わない。
   push前にdedicated repositoryの存在、tag immutability、lifecycle policyを確認する。
   PR #193のworker-only preflightを拡張し、API/worker両task definitionのdigest、OCI full
   40-character SHA、実効command、entryPoint、runtimePlatformを相互比較するread-only checkを
   新しい実装対象にする。
5. **API forward-port**: preflight済みdigestを配備するが、API taskのflagはfalseのまま。
6. **Idle worker canary**: request 0の状態で、canary taskだけflag=trueとし、commandを
   `["/usr/local/bin/bun", "dist/scripts/startProductionAccountDeletionWorker.js", "--once"]`
   にする。recovery scanを1回だけ行い、DBをcloseしてexit 0する。request 0ならprovider callは
   0回でなければならず、timeoutや設定不一致を成功扱いにしない。現行の無限polling
   entrypointをone-off完了と見なさない。
7. **Worker service**: worker taskだけflag=true、desired 1、maximum concurrency 1。APIはfalse。
   flagは共有secretで一括変更せず、taskごとの非secret環境値で分離する。
8. **Activation**: schema/data/runtime/E2E gate がすべて通った後だけ API taskのflagをtrueにする。
9. **Observation**: task start failure、recoverable age、stable failure code、provider timeout、
   API 5xx、DB invariant を監視する。

上記の request 0、schema object、ECS desired count、digest 等は時点依存である。各 stop point
の直前にaggregate-only readbackをやり直し、この文書に記載した過去の観測値で代用しない。

新 worker の実績がない初回復旧では「過去4世代のrollback image」を必須にしない。
旧 digest は欠落しており安全な rollback ではない。初回の主 rollback は新規受付停止と
同一契約workerのgraceful drainである。以後、検証済み digest を最大5世代保持する。

## 11. Rollback と停止条件

DB down migration は行わない。問題時は API の新規受付停止と worker drain を同時に開始し、
API deployment の完了を待ってからworker停止を始めるような直列手順にしない。

1. API taskをflag=falseへ戻してforce deploymentし、新規GET/POSTを503にする。
2. 同時にworker serviceを`desired=0`へ更新する。ECSのSIGTERMを受けたworkerは新しいclaimを
   止め、進行中の1 external stepとfenced checkpoint完了だけを待ってexitする。task
   `stopTimeout=120` とgraceful shutdown testを必須にする。
3. service停止後、active claimが0、またはstale後に同一か新しいcontract workerへ引継げる
   durable checkpointだけが残ることをaggregateで確認する。
4. 即時停止が必要な破損疑いではtaskを停止してよいが、requestはstale claim回復待ちとして
   保持し、同じか新しい契約workerだけで再開する。
5. schema と identity tombstone は保持し、旧 API / 旧 workerへ戻さない。

次のいずれかがあれば worker 起動・feature activation を禁止する。

- API と worker の source SHA / deletion contract が異なる。
- flag false でも request、provider call、checkpoint が発生する。
- active/pending/completed request に null identity key がある。
- legacy `scheduled_asset_keys` の意味を推測しないと再開できない。
- migration history と physical schema、index、constraint、trigger が一致しない。
- export table adapter を一意に構成できない。
- provisioning guard、billing/store anti-resurrection、organization lock が未配備。
- Cognito/S3/Stripe/HMAC/recovery config、IAM、timeout が未検証。
- API と worker artifact の OCI revision / architecture / entrypoint が不一致。
- worker task definition が承認範囲外のrole、secret、network、logging、CPU、memoryを変更する。
- staging disposable-account E2E または full verification gate が失敗する。

## 12. Terra 委譲と Sol 統合判断

read-only の三つの限定監査へ委譲した。

- production schema fork と migration forward-port
- release API、公開 Mobile 契約、必須 code slice
- worker artifact、API/worker整合、段階展開

Sol は結果を統合し、次を採用した。

- worker 単独復旧を禁止し、API-first containment と同一SHA契約を必須にする。
- 公開 API は legacy-only とし、v2追加を今回から外す。
- main の 037 を復元・再実行せず、release fork の次番号 042 / 043へ責任分割する。
- export table 名の差と未作成状態をview、catalog allowlist、feature gateで吸収する。
- 独自asset checkpoint列を増やさず、0-row gateの下で上流の既存列契約を採用する。
- 初回に存在しないrollback imageを要求せず、受付停止と同一契約worker drainを主rollbackにする。

これにより、削除順序や provider side effect を変えず、現在停止中の機能を安全な
forward-only contract として復旧できる。ただし、本文の実装と全 gate が終わるまでは
アカウント削除は利用不可のままとする。
