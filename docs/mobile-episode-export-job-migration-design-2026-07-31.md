# Episode export job migration 032 design

## 目的と範囲

Mobileから話単位のPDF / ZIPを将来非同期生成するため、episode export jobとdispatch outboxの永続化契約だけを追加する。

対象はmigration 032、deployment invariant、契約テスト、Specとtask listである。Repository、Service、Route、SQS dispatch、artifact build、S3 read/write/delete、signed download URL、Web / Mobile UIは接続しない。既存`GET /api/pages/:id/export-image`は変更しない。

## Spec根拠

- `docs/Lyra_Unified_Spec_v4.md` Authentication and authorization / Persistence and tenancy / Input and output safety
- `docs/mobile-release-task-list-2026-07-30.md` GIT-110 PR-B / DB-300 migration 032

## PR #67案から変更する理由

PR #67のschema案はexport jobの基本列を持つ一方、artifact keyのowner binding、TTL上限、snapshot shape、statusとtimestamp / artifactの組合せをDBで固定していない。mainへそのまま持ち込まず、API未接続の加算schemaとして次を先に保証する。

## 永続化契約

- personal jobはepisodeが属するworkの`user_id`と一致し、organization jobはworkの`organization_id`と一致する。deployment invariantでも継続監査する。
- pageは1〜100件、snapshotは同数のJSON arrayに限定する。pageの削除後も完了済みartifactの監査記録を保持できるよう、page ID配列には外部キーを付けない。作成時の同一episode・画像ownership確認は後続Repositoryの責任とする。
- request fingerprintはlowercase hex SHA-256、idempotency keyとfilenameは長さと制御文字を制限し、filename拡張子をformatと一致させる。
- artifact keyは`exports/{organizationIdまたはuserId}/episodes/{episodeId}/{jobId}.{format}`と完全一致させる。
- PDFは`application/pdf`、ZIPは`application/zip`だけを許可し、artifactは1 byte〜128 MiBとする。
- expiryは作成後かつ最大24時間。completed artifactはexpiry前に完成し、削除記録はexpiry以後だけを許可する。
- queued / processing / completed / failed / canceledごとにprogress、timestamp、artifact、errorの整合性をDB制約で固定する。
- active duplicateとidempotency scopeをunique indexで保護する。

## outbox

job作成とqueue dispatchを将来同一transactionにできるよう、job IDを主キーにしたoutboxを用意する。migration適用だけではrowが作られず、SQS送信も起きない。dispatch回数は非負、message IDとerrorはbounded、dispatch timestampは作成後に限定する。

## セキュリティ

- S3 keyはserver-side UUIDと認証scopeだけから構築し、filenameを含めない。
- DB rowはdownload権限を与えない。後続Routeはpersonal ownershipまたはactive organization membershipを必ず再確認する。
- snapshotへ保存するsource keyは後続Repository / Workerでpage ownershipと安全な画像key policyを検証する。
- raw S3 / provider errorは保存せず、後続Serviceが安定したbounded error code/messageへ変換する。

## 既存運用への影響

- 新規tableとindexだけで、既存table・rowのscanや更新はない。
- Route / Worker未接続のため、既存API、1ページexport、credit、generation job、S3処理は変化しない。
- migration時間は空table作成分だけである。

## 後続条件

- transaction内でepisode / page / work scopeをlockしてsnapshotを作るRepository
- job作成とoutbox insertのatomicity、idempotency競合テスト
- source imageのMIME / size / magic bytes再検証とbounded timeout
- PDF / ZIP builderのpage順、総source size、artifact size制限
- S3 put / signed get / expiry cleanupと失敗時の孤児object回収
- 認証・active membershipを持つRoute、Worker、Web / Mobile client

## テスト方針

先にmigrationとinvariantを要求するテストを追加し、missing migration / invariantでredを確認する。実装後はfocused test、fresh PostgreSQL 001〜032、DB制約とscope invariant、Vitest / Bun、Backend build、Web lint/build、Playwright smokeを確認する。

## Sol / Terra

利用可能な`skills/lyra-sol-terra-orchestration`が作業環境に存在せず、上位ルール上sub-agent委譲も行わない。schema限定の設計・実装・検証を同一作業で行う。
