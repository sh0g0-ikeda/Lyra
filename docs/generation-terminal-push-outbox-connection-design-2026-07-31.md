# Generation terminal push outbox connection design

## 目的と範囲

`generation_jobs` の `completed` / `failed` 確定と Mobile push outbox の作成を同じ PostgreSQL transaction で接続し、DB-300 migration 034 の terminal settlement 契約を完成させる。

対象は page / entity / episode story autofill / episode page skeleton の terminal 更新、共通 `GenerationJobRepository.markFailed`、page generation の手動 retry、outbox の retry event identity、deployment invariant、競合テスト、Spec と Mobile release task list である。

この変更では token 登録 Route、Mobile の通知権限、delivery claim、APNs / FCM provider、外部配送 runner、本番 feature flag の有効化を行わない。Push は引き続き配送されず、既存生成 API の wire response、credit 金額、SQS payload、保存データ構造は変更しない。

## Spec 根拠

- `docs/Lyra_Unified_Spec_v4.md` §5 Persistence and tenancy
- `docs/Lyra_Unified_Spec_v4.md` §6 Generation jobs
- `docs/Lyra_Unified_Spec_v4.md` §7 Credits and billing
- `docs/Lyra_Unified_Spec_v4.md` §8 Input and output safety
- `docs/Lyra_Unified_Spec_v4.md` §10 Verification gate
- `docs/mobile-release-task-list-2026-07-30.md` PR-D / DB-300 migration 034

## 実装前の現行実装監査

- migration 034 は outbox / delivery table と `generation_job_id + terminal_status` の一意性を持つ。
- `PushNotificationOutboxRepository.enqueueForTerminalJob` は job row lock、cancel metadata 除外、token registry lock、token snapshot を同じ transaction で行うが、terminal 更新元から未接続である。
- terminal 更新は四つの execution repository と共通 `GenerationJobRepository.markFailed` に分散している。
- `prepareRetry` は `failed` を同じ job row の `queued` へ戻すが、既存 failed delivery を無効化しない。
- 現行 Worker が SQS 再試行を要求する経路は job を `failed` にせず `queued` / `processing` のまま返す。したがって中間 retry を terminal 通知から除く追加の attempt 判定は不要で、実際に `failed` へ確定した時点だけが通知 event である。
- 同じ job が `failed -> queued -> failed` になり得るため、現在の `job + status` 一意性だけでは二回目の failed event を表現できない。

## 設計

### Terminal settlement

- transaction は最初に push token registry advisory lock を取得し、その後 terminal `UPDATE ... RETURNING` が取得した server-side job row を outbox helper へ渡す。
- helper は同じ transaction client を使い、outbox insert、同一 user の token delivery snapshot を実行する。account deletion が registry lock 後に job を scrub する既存順序と揃えることで、`job row -> registry lock` / `registry lock -> job row` の逆順 deadlock を作らない。
- terminal 更新、関連 page state 更新、outbox、delivery のどれかが失敗した場合は全体を rollback し、terminal state だけまたは通知だけが残る状態を作らない。
- `cancel_requested_at` または `cancelled_at` がある row は terminal update predicate と enqueue eligibility の両方で除外する。
- trigger は追加しない。新しい terminal producer は明示的 helper 接続がテストで必要になる。

### Retry identity と invalidation

- 新規 migration 039 で outbox に `generation_retry_count` を追加し、event identity を `generation_job_id + terminal_status + generation_retry_count` にする。
- snapshot は既存 `generation_jobs.retry_count` と同じ整数範囲を受け入れ、負数だけを拒否する。通知側だけに新しい上限を加えて既存 terminal 更新を失敗させない。
- 既存 migration を編集せず、旧 `job` 単独または現行 `job + status` unique constraint だけを catalog で特定して段階的に置換する。
- `prepareRetry` は job を `queued` に戻す同じ SQL statement 内で、その job の未送信 `failed` delivery を `canceled` にする。
- retry 後に再度失敗した場合は増加後の retry count で別 outbox event を作る。retry 後に成功した場合も completed event を別に保持する。
- 将来の delivery claim は job の現在 status と retry count が outbox snapshot と一致することを必須にする。配送は今回未接続なので、claim / provider を統合する後続 PR でこの predicate を実装してから feature を有効化する。

## 影響レイヤーとインターフェース

- Repository: terminal transaction、retry invalidation、outbox helper。
- Domain: outbox event snapshot に retry count を追加する内部型。
- Migration / Ops: 039 と deployment invariant。既存 001〜038 は変更しない。
- Worker / Service: public interface と処理順は維持し、既存 repository 呼出しの内部 transaction だけを強化する。
- Route / Web / Mobile / provider: 変更しない。

入力は既存の server-side job ID / user ID / organization ID / terminal status / retry count だけで、client 由来の token、作品本文、provider payload は受け取らない。出力は既存 boolean 契約を維持する。

## セキュリティと運用安全性

- user / organization / retry count は terminal 更新で返った DB row を正とし、request body から outbox scope を組み立てない。
- delivery は token ciphertext を複製せず、同一 user の token row ID だけを参照する。
- 全 SQL は parameter binding を使い、constraint 置換の dynamic SQL は PostgreSQL catalog の constraint name を `%I` で quote する。
- notification payload、作品名、本文、provider error、secret を永続化またはログ出力しない。
- migration 先行適用を release gate とする。code 先行で table / column がない状態は許可しない。
- terminal ごとに outbox 1 row と登録端末数分の delivery row が増える。token registry lock は snapshot 中だけ保持し、外部 API 呼出しは transaction 内で行わない。
- Push 配送は既定 OFF のままであるため、APNs / FCM credential がなくても既存生成は外部通信を開始しない。

## TDD と検証方針

先に次のテストを追加し、現行実装で期待どおり red になることを確認する。

- migration 039 が retry count、non-negative check、event unique contract を追加する。
- completed / failed settlement が同じ transaction で outbox と token snapshot を作る。
- cancel metadata がある job は failed / outbox へ進まない。
- 同じ terminal event の再実行は重複せず、retry 後の同じ failed status は別 event になる。
- retry と delivery snapshot / claim 相当の競合で、未送信 failed delivery が canceled になり stale lease は確定できない。
- outbox scope / token scope / retry snapshot の deployment invariant が fresh DB で 0 件になる。

対象テスト後、Vitest / Bun、fresh PostgreSQL 001〜039、deployment invariant、backend build、Web lint/build、Playwright、Mobile contract/typecheck/lint/test/両 OS export の release gate を実行する。

## Sol / Terra

Sol が設計、transaction / lock 順、migration、統合判断、最終検証を所有する。Terra には現行 terminal transition site と既存テスト漏れの read-only 監査だけを委譲し、実装・migration・Git 操作・本番操作は委譲しない。Sol が監査結果を現行コードと照合して採否を決める。
