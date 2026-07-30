# Generation job cancellation contract migration 035 design

## 目的と範囲

既にmigration 024で存在するgeneration job cancellation列について、新規writeが停止要求・保存開始・停止完了の矛盾状態を作らないDB契約を追加する。

対象はmigration 035、deployment invariant、契約テスト、Specとtask listである。列追加、既存Repository / Worker変更、全job typeへのcancel拡張、refund、push enqueue、triggerは含めない。

## Spec根拠

- `docs/Lyra_Unified_Spec_v4.md` Generation jobs
- `docs/mobile-release-task-list-2026-07-30.md` GIT-110 PR-D / DB-300 migration 035

## 現行実装監査

- `GenerationJobRepository.requestCancellation`はqueued / processingのepisode story autofillだけを対象にし、`commit_started_at IS NULL`を要求する。
- queued停止はrequest metadata、cancelled status、cancelled / completed timestampを同一UPDATEで設定する。
- processing停止はrequest metadataだけを設定し、Worker側のfinalizeがcancelled / completed timestampを設定する。
- `EpisodeStoryAutofillExecutionRepository.beginEpisodeStoryAutofillCommit`は`cancel_requested_at IS NULL`の場合だけcommitを開始する。
- retryはcancel / commit metadataをすべてNULLへ戻す。

したがって現行writeは、requester pair、cancelとcommitの排他、cancelled stateのtimestamp契約を満たす。

## DB契約

- `cancel_requested_at`と`cancel_requested_by`は両方NULLまたは両方非NULLにする。
- request / commit timestampはjob作成後に限定する。
- cancel requestとcommit startは同一rowで両立させない。
- cancelled statusはrequest metadata、cancelled / completed timestampを必須にし、commit startを禁止する。
- cancelled timestampはrequest以後、completed timestampはcancelled以後にする。
- cancelled以外のstatusでは`cancelled_at`を禁止する。

## rollout

本番既存行をこの作業環境から事前監査できないため、constraintは`NOT VALID`で追加する。PostgreSQLは追加後のINSERT / UPDATEへ制約を適用する一方、既存全行scanによるmigration失敗を避けられる。

deployment invariantで既存違反を可視化し、productionで0件を確認した後の別migrationで`VALIDATE CONSTRAINT`する。今回はvalidation完了やprocessing cancellation全体の完成を主張しない。

## セキュリティと整合性

- cancel requesterは既存user FKを維持する。
- IDだけを知るrequestからの認可は既存Route / Repository scopeを維持し、migrationで緩和しない。
- credit refund、late consume、push outboxへtriggerを追加しない。
- commit開始後の取消拒否をDB contractでも維持し、部分保存を誘発しない。

## 既存運用への影響

- 既存tableへ2つの`NOT VALID` CHECKを追加するだけで、全行validationやindex buildを行わない。
- 現行Repositoryの正常writeは契約内であり、API wire responseやWorker処理時間は変わらない。
- 矛盾した将来writeだけがcheck violationで拒否される。

## テスト方針

先にmigrationとinvariantを要求するテストを追加し、missing migration / invariantでredを確認する。実装後はfocused test、fresh PostgreSQL 001〜035、valid queued / processing / cancelled / commit states、不正pair / timestamp / cancel+commit / cancelled stateのDB拒否、全verification gateを確認する。

## Sol / Terra

利用可能な`skills/lyra-sol-terra-orchestration`が作業環境に存在せず、上位ルール上sub-agent委譲も行わない。既存write path監査と限定constraintを同一作業で検証する。
