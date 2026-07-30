# Generation job management migration 030 design

## 目的と範囲

Mobileを含む将来のジョブ履歴一覧で、利用者ごとにterminal jobを非表示にできるDB土台を、既存キャンセル・返金挙動へ影響させず追加する。

対象は`generation_job_history_hides`と一覧用index、migration契約テストだけである。ジョブ一覧 / 非表示Route・Service・Repository、pagination、汎用キャンセル、Worker checkpoint、返金処理、Mobile UIは接続しない。

## Spec根拠

- `docs/Lyra_Unified_Spec_v4.md` Availability contract / Data and migrations / Verification gate
- `docs/mobile-release-task-list-2026-07-30.md` GIT-110 PR-D / DB-300 migration 030

## 現行実装の確認

現mainにはmigration 024 / 025とJobServiceがあり、`episode_story_autofill`のqueued / processingキャンセル、commit開始後の拒否、terminal retentionを既に扱う。旧PR #67のmigration 030は履歴table・indexに加え、cancelled jobへ遅れてconsume ledgerが追加された場合にDB triggerで残高更新とrefund ledger追加を行う。

このtriggerはmigration適用直後から既存Web APIとcredit残高を変更する。現在のrefund unique index、個人 / 法人balance lock順、既存JobServiceのepisode限定キャンセルと同時に検証しなければ、二重返金・deadlock・consume transaction rollbackを起こし得る。そのためschema先行単位から除外する。

## 設計

- `(generation_job_id, user_id)`を主キーとする`generation_job_history_hides`を追加する。
- jobまたはuser削除時は表示設定も削除する。金融・生成結果そのものは削除しない。
- user起点のanti-join用indexと、personal / organization scope・作成日時cursor用indexをconcurrentに追加する。
- 途中失敗後の再実行でinvalid indexを残しにくくするため、同名indexをconcurrent dropしてから作成する。
- status constraint、credit balance、credit ledger、triggerは変更しない。

## セキュリティ

履歴非表示行はアクセス権を付与せず、表示から除外する利用者設定だけを保持する。将来のRepositoryはjobのpersonal ownershipまたはactive organization membershipを先に確認してから行を追加する。migration単体ではRouteがないため外部入力を受けない。

## 既存運用への影響

- 生成・キャンセル・返金: 変化なし。
- 話の一貫性・生成時間: 変化なし。
- DB: 新規空tableとconcurrent indexだけ。generation job書込み時のindex更新コストは小幅に増える。
- API / Web / Mobile: 変化なし。

## 後続条件

DB-300 migration 030全体は、以下が揃うまで未完了とする。

- personal / organization capabilityを強制する一覧・非表示Repository
- cursor paginationとcredit settlement集計
- queued / processing / commit開始後の汎用キャンセル競合テスト
- late consumeとrefund unique barrierのロック順検証
- Worker cancellation checkpoint

## テスト方針

先にmigrationの安全な追加物と、trigger / balance / status非変更を要求するテストを追加し、migration不在でredを確認した。実装後はfresh PostgreSQL 001〜030、再実行、invariant、Vitest / Bun、Backend build、Web lint/build、Playwright smokeを確認する。

## Sol / Terra

利用可能な`skills/lyra-sol-terra-orchestration`が作業環境に存在しないため委譲しない。旧triggerを除外する統合判断と全検証をSol相当の同一作業で行う。

