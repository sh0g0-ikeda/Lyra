# Mobile push notification outbox substrate design

## 目的と範囲

generation jobの完了通知を将来APNs / FCMへ安全に配送するため、push outbox / deliveryの永続化契約と明示的enqueue Repositoryを追加する。

対象はmigration 034、domain型、enqueue Repository、deployment invariant、push token row identityの安全化、テスト、Specとtask listである。generation job更新trigger、既存GenerationJobRepository / Workerへの接続、delivery claim、APNs / FCM provider、Route、Mobile navigationは追加しない。

## Spec根拠

- `docs/Lyra_Unified_Spec_v4.md` Generation jobs / Persistence and tenancy / Input and output safety
- `docs/mobile-release-task-list-2026-07-30.md` GIT-110 PR-D / DB-300 migration 034

## PR #67案から変更する理由

PR #67のmigration 034は適用直後に`generation_jobs`へtriggerを作り、既存の全completed / failed遷移でoutbox書込みを開始する。delivery workerが未統合の段階で本番job経路を変えるため採用しない。

また、同案はoutboxをjobごとに1件へ限定するため、failed jobをretryしてcompletedになった場合のcompletion eventを記録できない。本設計では`generation_job_id + terminal_status`を一意にし、異なるterminal eventを分ける。

## enqueue契約

- Repositoryはgeneration job rowを`FOR UPDATE`し、その時点のstatusがcompleted / failedの場合だけenqueueする。
- token snapshot前にpush token registryと同じadvisory lockを取り、token移動・logoutとの競合を直列化する。
- outbox insertと対象userのtoken delivery insertを同一transactionで行う。
- 同じjob / terminal statusの再実行は既存outboxを返し、新しいdeliveryを増やさない。
- queued / processing / cancelled / unknown jobは何も書かず`null`を返す。
- triggerは作らず、後続のgeneration terminal settlementから明示的に呼ぶまでoutbox rowは作成されない。

## push token row identity

deliveryはpush token rowを外部キー参照する。token hashが別user / installationへ移る際に同じrow IDをUPDATEすると、既存deliveryが別userのtokenを指す危険がある。

そのためPushTokenRepositoryは、scopeまたはhashが変わる登録を先にDELETEして新しいrow IDでINSERTする。同じuser / installation / hashの再暗号化だけ既存rowをUPDATEする。削除されたtokenを参照するdeliveryは`ON DELETE SET NULL`となり、後続workerが送信対象から除外できる。

## DB契約

- outboxはjob、user、任意organization、completed / failed snapshot、作成時刻を保持する。
- deliveryはpending / processing / sent / dead / canceledの状態、lease、attempt、available、sent、bounded error codeを保持する。
- 各状態でlock / lease / sent / errorの組合せとtimestamp順序をDB制約で固定する。
- token削除後の監査を残すため`push_token_id`はnullable、FKは`ON DELETE SET NULL`とする。
- deployment invariantはoutbox user / organizationがjob snapshotと一致し、残存tokenがoutbox userと一致することを監査する。

## retry境界

既存generation jobはfailedからqueuedへretryできる。今回のRepositoryは未配線であり、後続統合では次を同時に実装する。

- 自動retryを使い切る前のfailedではenqueueしない。
- delivery claim時にgeneration jobの現在statusがoutbox terminal statusと一致するか再確認する。
- retry開始後の未送信failed deliveryをcanceledへする。

この境界が完成するまでDB-300 migration 034全体は完了扱いにしない。

## セキュリティ

- notification payloadや作品内容、provider error本文をoutboxへ保存しない。
- deliveryはtoken ciphertextを複製せず、同一userのtoken row IDだけを参照する。
- Repositoryはparameter bindingとtransactionだけを使う。
- module追加だけではPush送信、端末permission prompt、外部API callを開始しない。

## 既存運用への影響

- 新規table、index、未配線Repository、およびpush token upsertの内部安全化だけである。
- PushTokenRepositoryはまだRoute未接続のため現在の本番API挙動は変わらない。
- generation job、cancel/refund、Workerへtrigger / callを追加しないため、既存job完了時間とDB write数は変わらない。

## テスト方針

先にmigration、enqueue Repository、token row identity、invariantのテストを追加し、missing migration / module / invariantおよび旧UPDATE方式でredを確認する。実装後はfocused test、fresh PostgreSQL 001〜034、terminal / nonterminal / idempotency / scope DB cases、全verification gateを確認する。

## Sol / Terra

利用可能な`skills/lyra-sol-terra-orchestration`が作業環境に存在せず、上位ルール上sub-agent委譲も行わない。既存job / retryへ接続しない限定設計を同一作業で実装・検証する。
