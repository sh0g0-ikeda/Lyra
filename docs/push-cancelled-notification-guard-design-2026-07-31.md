# Push cancelled notification guard design

## 目的と範囲

生成ジョブのterminal通知候補を作る際、`failed`へ誤遷移したキャンセル要求済みジョブを除外する。
対象は`PushNotificationOutboxRepository`のロック済み判定、単体テスト、Spec、Mobile release task listである。
generation terminal処理への接続、retry invalidate、delivery claim、APNs / FCM、Mobile navigationは対象外とする。

## Spec根拠

- `docs/Lyra_Unified_Spec_v4.md` Native push / Generation jobs
- `docs/mobile-release-task-list-2026-07-30.md` DB-300 migration 036

## 現行実装監査

- outbox enqueueはgeneration jobを`FOR UPDATE`し、`completed`または`failed`だけを候補にする。
- `cancelled`は既に除外されるが、判定rowはcancel metadataを読まない。
- migration 035は新規writeでcancel request pairを保証する一方、production既存行を未検証に保つ。
- したがって`failed`かつ`cancel_requested_at`ありのlegacy / 競合rowは、現行判定だけでは通知候補になり得る。

## 設計

- job lock queryで`cancel_requested_at`と`cancelled_at`を同時に読む。
- 通知候補は`completed`または`failed`かつ、両方のcancel timestampがNULLのrowだけに限定する。
- 判定とoutbox insertは既存どおり同一transaction・同一job lock内で行う。
- 既存の正常なcompleted / failed、冪等性、token snapshot、lock順は変更しない。
- migration、trigger、Route、Service、Worker、credit ledgerには変更を加えない。

## セキュリティと整合性

- user / organization / token scopeは既存rowとFKからのみ取得し、入力値から組み立てない。
- cancel metadataは内部判定だけに使い、通知payloadやAPIへ公開しない。
- job lock後に判定するため、同じrowのterminal / cancellation更新との競合を直列化する。

## テスト方針

先に`failed`でもcancel requestまたはcancelled timestampがあるrowでは、job lock以外のSQLを実行しないテストを追加してredを確認する。
実装後に既存completed / failed、active / cancelled、冪等enqueueの回帰、Backend全テスト、fresh PostgreSQL migration / invariant、Web gateを確認する。

## Sol / Terra

利用可能な`skills/lyra-sol-terra-orchestration`が作業環境に存在せず、上位ルールによりsub-agent委譲も行わない。
変更を1 Repositoryの判定へ限定し、Codex単独で設計・TDD・全ゲート確認を行う。
