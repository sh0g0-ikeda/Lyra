# Generation job history management design

## 目的と範囲

`GET /api/jobs`で認証ユーザーが閲覧可能なジョブ履歴をbounded cursor paginationで返し、
`DELETE /api/jobs/:id`でterminal jobだけをそのユーザーの履歴一覧から非表示にする。
非表示は表示設定であり、job本体、status、result、credit、queue、worker、push outboxを変更しない。

generic cancellation、refund、credit settlement、worker checkpoint、push deliveryは本PRに含めない。
適用済み`migrations/030_add_generation_job_management.sql`も変更せず、既存table/indexだけを使用する。
非表示後もscoped direct `GET /api/jobs/:id`は200を維持し、polling・deep link・support導線を壊さない。

## Spec根拠

- `docs/Lyra_Unified_Spec_v4.md` §3 Architecture
- 同 §4 Authentication and authorization
- 同 §5 Persistence and tenancy
- 同 §6 Generation jobs
- 同 §8 Input and output safety
- 同 §10 Verification gate

## 影響レイヤー

- Domain: job history専用opaque cursor codec
- Repository: personal / active organization scoped list、terminal-only hide transaction
- Service: listの委譲とhide結果のdomain error変換
- Route / shared contract: bounded query、既存safe job mapperの再利用、list response guard
- Mobile / Web / Worker / Credit / Push / Migration:変更しない

## インターフェース

- list query: `organization_id?`、`limit`（default 25、1〜100）、`cursor`（最大512文字）
- list response: `{ jobs: GenerationJobResponse[], next_cursor: string | null }`
- cursor order: active rank（queued/processingを先頭）、`created_at DESC`、`id DESC`
- cursor wire: version、endpoint kind、active rank、canonical UTC timestamp、UUIDをJSON化して
  canonical base64urlにする。別endpoint、非canonical値、不正日時・UUIDを422で拒否する。
- hide: terminal（completed/failed/cancelled）だけ204。activeは409、scope外・inactive membershipは404。
  同じユーザーによる再実行は`ON CONFLICT DO NOTHING`で204とする。

activeからterminalへの遷移中はlive listのrankが変わり得る。APIはsnapshotを偽装せず、
各page内で決定的なkeyset orderを保証する。active jobは既存hide rowがあっても常に表示し、
retry後に不可視の実行中jobを作らない。

## セキュリティとtransaction

- personalは`generation_jobs.user_id = viewer`かつ`organization_id IS NULL`に限定する。
- organizationは指定organizationとviewerのactive membershipをSQLでも再確認する。
- IDを知っているだけのlist/hideを許可しない。
- hideはtransaction内でscoped job rowを`FOR UPDATE`し、terminal判定とpreference insertを行う。
- lock対象はjob rowだけで、credit balance、ledger、capacity advisory lock、queueを取得しない。
- responseは既存`toJobResponse`を再利用し、provider request ID、S3 key、raw promptを返さない。

## TDDと検証

1. cursorのround-trip / kind / canonical / boundsテストをredにする。
2. Repositoryのscope、order、limit+1、active再表示、FOR UPDATE、terminal-only、
   idempotencyテストをredにする。
3. Serviceのlist非回復、hide success / active / not-foundテストをredにする。
4. Routeのpersonal / organization list、invalid query、hide、direct GET維持、
   response contractテストをredにする。
5. shared list schemaのstrict validationをredにする。
6. focused green後、Vitest / Bun、fresh migration / invariant、Backend build、
   Web lint/build、Playwright、Mobile required gateを確認する。

## Sol / Terra

Solが設計、cursor/security判断、統合、全ゲートを担当する。Terraは既存interface、
scope SQL、test harnessをread-onlyで監査した。実装ファイルの所有はSolに限定し、
Terra結果を現行mainの実装と照合してから採用する。
