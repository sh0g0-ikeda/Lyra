# Release audit follow-up and dormant state-copy recovery

## Release judgment

This is a local improvement candidate, not a production-release approval. The
preserved CI-green baseline is `6c0c9681d8354ab2ed7cfbef51edf6990370930e`.
Passing isolated tests does not establish production data compatibility, provider
configuration, remote erasure guarantees or native-device acceptance.

## Compatibility fixes after the green baseline

The independent audit compared actual production Mobile source schemas with the
candidate HTTP responses, rather than parsing every response with only the new
client's schema. It found and repaired:

- New import-analysis jobs breaking old clients' four-type job enum. Unversioned
  history/detail/cancel keep the old contract; updated clients request v2. Type
  filtering happens before database pagination
- Flat legacy export status fields and completed download URLs missing from the
  replacement DTO. Unversioned status is restored through the existing scoped
  signing service; updated clients request v2. Blank names retain defaulting
- Organization members/invitations/usage/audit pagination dropped, with monthly
  totals based on only the most recent 200 records. Stable authorized pagination
  and complete-month aggregates are restored
- A historical Google refund reversing a later renewal's allowance; and a new
  replacement token's RTDN being ignored before linked-token ownership lookup
- The limited persisted nested page-provenance shape conflicting with the strict
  response schema. Normal flat worker results and private image redaction remain
  covered

The exact local compatibility checkpoint is
`58e6b1c2b48ece5d2463b2da48d666f6d1314b90`. It passes 2,587 tests in 345 files on
PostgreSQL 18/Vitest and PostgreSQL 16/Bun 1.3.14, plus 927 Mobile tests, typecheck,
lint, generated contracts, backend build, Web lint/build and 150-route inventory.
Those figures apply to that checkpoint, not to unfinished later changes.

## Dormant state-copy v2

New migration 047 adds a non-cascading journal. Admission is OFF by default.
Conditional image writes, retained ordinary markers, exact-version purge and
immutable receipts provide a locally testable recovery protocol. Source admission,
reader/quote authorization, account deletion, image/job retention and runtime
configuration use that journal. Existing legacy unknown outcomes remain blocked.

Independent local review additionally required recovery before stale preview
validation, authorized organization-editor recovery after the original actor
leaves, preservation of orphaned original source inventory, and rejection of v2
keys by all ordinary deletion adapters. Each confirmed finding has a reproducible
local regression; final aggregate results belong in the exact revision manifest.

The storage contract assumes policy-enforced conditional writers, exclusive
recovery authority, retained ordinary markers, controlled versioning history and
no unmanaged replication/restore. Configuration attestation records an operator's
assertion; it neither inspects nor enforces those AWS settings.

## Preserved state-recovery checkpoint verification

The combined candidate passes 2,769 tests in 356 files in each of these runs:

- Vitest with PostgreSQL 18.3
- Vitest with PostgreSQL 16.14
- Native Bun 1.3.14 (production Dockerfile version) with PostgreSQL 16.14
- Native Bun 1.4.2 (last observed CI version) with PostgreSQL 18.3

A fresh PostgreSQL 18.3 database applies migrations 001–047, a second application
makes no changes, and all 71 deployment invariants pass. The production 041
lineage bridge, historical 039/041 preflight, concurrency, authorization and
corruption fixtures are included in the test totals. Mobile passes 927 tests in
183 files, typecheck, lint and contract generation. Backend TypeScript, Web
lint/build and the 150-route API inventory pass. Android and iOS JavaScript/assets
export offline with telemetry and upload disabled; these are not signed packages
or store submissions. The independent final review re-ran 46 public-recovery and
journal tests after rechecking all reproduced findings.

These tests use disposable databases and in-process storage/provider doubles.
No actual AWS or paid-provider operation was performed. New-revision GitHub CI
and browser smoke remain unrun: the source-publication action was blocked. The
last successful remote CI/browser run belongs only to preserved 6c0c968. The exact
new local source commit and artifact hashes are recorded in the delivered manifest.

## Deployment and rollback boundaries

Apply 047 only through the reviewed migration process. Its new empty table and
indexes do not rewrite existing application rows; real lock/load acceptance is
still required. The earlier production-lineage bridge retains its full write
freeze, queue drain and forward-only rollback restrictions.

Before any v2 admission, an intake-disabled image can remain on the compatibility
baseline only if there are no v2 journal entries and all earlier release gates
pass. After the first v2 attempt, a rollback image must retain v2 journal-aware
reads, pruning exclusions, deletion fencing and recovery while admission is OFF.
Returning to a pre-v2 binary is not an accepted rollback. Disabling admission must
not remove recovery role configuration. Never delete journal rows or markers to
make a release check pass.

## Remaining acceptance gates and minimum decisions

1. Production database: obtain an approved read-only path, inspect actual full
   filename migration history and sizes, rehearse the production-lineage bridge
   on a protected representative copy, and measure locks with a bounded budget.
   Existing-data, identity-subject and mixed old-client/worker acceptance are
   independent of empty-database migration tests
2. State-copy storage: approve the role/policy changes and marker-retention
   policy described in `review/state-copy-recovery/実行前レビュー.md`, inspect
   bucket versioning/lifecycle/replication/restore and KMS conditions, then run a
   bounded real-S3 acceptance plan. No such infrastructure change or live S3
   mutation is included here. Legacy unknown attempts require individual proof
3. Google sign-in/link: verify the actual IdP, app clients, redirect/logout URLs,
   scopes and linking trigger. Select the iOS sign-in policy where needed and
   exercise cancelled/replayed callbacks and account recovery
4. Web-only images: the current source packages a shared Web/Mobile Cognito
   client ID. Never allowlist that shared ID. A dedicated Web client and rejection
   checks with both old/new Mobile tokens are mandatory before enabling delivery
5. Quotes and image providers: new Mobile paid flows require server quotes.
   Leaving quotes OFF is not a complete paid-flow release. Verify configured
   tariffs, refund/timeout behavior and real output quality with an explicit
   provider spending budget. Hy4 stays unavailable until its official image API,
   output contract and price are established; no substitute is inferred
6. Artifacts and device acceptance: build the actual target container architecture,
   validate the signed-distribution configuration without submitting it, and
   exercise old installed clients plus native editing, safe areas, interruption,
   accessibility and purchase/restore flows using authorized test accounts.
   Browser smoke and local JavaScript exports are narrower evidence

No item above authorizes merging, deployment, production migrations, store/OTA
submission, a paid build, purchasing, persistent access changes or paid generation.

## Adopted frontend requirements follow-up

The frontend design at `01c1bf6dc1057f1731770d4118e7508eee884433` selects new-form
defaults, operation-specific failure/outcome context and readable dark controls.
A bounded follow-up from `138d62c` closes the identified local omissions:

- Six editable existing-domain defaults apply only to fresh person drafts. Saved
  blank/null values, hidden fields, aliases and imported suggestions are preserved.
  Unresolved existing selections cannot accept edits that a delayed read discards
- Core editor, hierarchy and job-action errors retain operation/target and proven
  local draft facts. Confirmed writes are separated from failed subsequent reads;
  refresh never silently repeats a mutation or infers credit settlement
- Named-state confirmations preserve valid receipts. Unknown outcomes keep the
  same original request across state selection. Explicit reconciliation renews
  the original completed job's token; generic conflicts do not prove settlement.
  A successful read of changed saved values permits an explicit return to editing
  while retaining the uncertainty notice
- Actual rendered-style foreground/background/ancestor-opacity combinations cover
  changed active help text, placeholders, inputs, notices and selected panels.
  Targeted text ratios exceed 4.5:1 and essential input boundaries exceed 3:1.
  This does not certify every screen or actual native accessibility

The combined Mobile suite passes **1,011 tests in 186 files**, typecheck, full lint,
generated contracts and mojibake checks. Backend TypeScript, Web lint/build and the
150-route inventory pass again. An independent bounded review found no remaining
local blocker in these repaired flows and checked the final file hashes. The
source SHA and offline-export results are recorded in the delivered manifest.

The full backend suite also passes again on disposable PostgreSQL 18.3:
2,769 tests in 356 files. The new UI changes do not modify backend, Web, package locks, migrations or shared
API schemas from `138d62c`. Clothing search and page-number selection implement
documented alternatives. Unsupported detailed example presets, frequency ranking
and a full PC state editor are not added by inference. Branded authentication
domain/mail are separately retained infrastructure proposals, not newly imposed
Google release prerequisites. Real layouts, devices, provider images and external
configuration remain unverified.

## Codex final local amendment (2026-10-02)

Current verified code: `e5f4eb20aaf7954cb83f3433f3234c1b0f349e12`. The earlier source-candidate results above are historical. Current local gates: full backend Vitest 2810/2810 with PG16, PG18 integration 274/274, native Bun non-DB 2536 pass/326 skips, focused Bun PG18 15/15, backend build, Mobile 1014 tests/type/lint/Expo Doctor20, Web type/lint/build/16 unique browser cases with visual duplicates, and real local HTTP+PG18 11 checks. Native Bun full PG18 status: 358files/2810 tests全合格、終了0.

Both PG versions pass migrations001–047,71 data invariants,lineage and read-only source/compiled backend-only preflight. New-Mobile preflight correctly rejects quotes OFF and absent paid-runtime configuration. No test result certifies signed devices, live Google/provider/store/S3, representative production data, current production configuration or the target ARM64 container. Existing AWS profile readback failed (exit255; cause unclassified). Existing dirty work and source checkout remain preserved; production/store/main/public GitHub remain untouched.

See the updated [integration manifest](uiux-backend-expansion-2026-09-30/統合検証manifest-2026-10-02.json) and [implementation record](uiux-backend-expansion-2026-09-30/実装記録.md) for current commands, failures and remaining acceptance gates. Production readiness remains false.


## 2026-10-03 current verification amendment (3f5e289)

- **要件/Spec/設計**: StoryAIの任意scene・全文/原文台詞・因果保持、Unified Specの所有者境界・原子的保存・クレジット/画像・有限監査・旧client互換契約を根拠とする。Web/Mobile通常CTA「カラー生成」「白黒で生成」。Webだけ「より自由な生成」にHy4カラー/白黒を用意。公式image/reference-edit仕様未確認のため無効（見積り/ジョブ/課金0）、Mobile入口なし・Web限定画像拒否を維持。
- **採用修正**: 61da135 partial基本参照のconfirmed primaryをstate baseとして読取（RED1→GREEN3files/21tests、missing primary/空key/tenant/journal守る）。a56b5e7 全compiler briefへ保存済み全文草稿を8000文字boundで転送（RED3→GREEN）。b33dfb1 前提/原因・同時継続動作の描写指示。3f5e289 同page所有要点をpanel直前へ併記、追加分だけ旧150K予算を超える場合は補足のみ省略（2RED→GREEN3files/115tests）。モデル/call数/2回有限監査/旧semantic soft-save/料金は不変。Page v10/Beat v6/Outline v5/Audit v12。Sol実装をrootレビュー。
- **最終ローカルgate**: source 3f5e2899e5d9e3bcf26650acdc441696324947ad。backend359files/2899tests、Vitest/Bun両方PASS skip0、build PASS。Web/Mobile型・lint、Web build PASS。PG18 invariants71/違反0。HEAD/製品入力不変をgate前後確認。UI/packages/API契約scriptはAPKbc46554とGit object同一。自前Mobile186files/1025tests、Web19smoke skip/flaky0。過去のDots合格を最終コードの証明として流用しない。
- **検証配備PASS**: Docker通常復旧失敗は記録保持。既存stage image9ddのprovenance/runtime/dependencies/COPY契約を確認し、隔離source409files→dist401filesを型/build。非root/read-only OCI overlayの新image84dを既存ECRへ。CFN previous templateでContainerImageだけ変更、5TaskDefinition+4Serviceのみ、IAM/Lambda/DB設定0。create/review/execute intent/statusを別証拠にし、実taskの401file SHA全部一致、Page v10/Audit v12、API1/全worker0/4queue空、healthz/readyz200、無認証works401を確認。Secret version/hash不変・新state generation/admission OFF・recovery設定維持。本番0。
- **状態実受入PASS/実機未確認**: source957で人工state実生成→1cr→確認2回。実DB consume1/refund0/net-1、残高12→11、confirmed journal1、基本画像/name/description保持。source3f反映後read-only認証済みAPIでpartial基本参照のstate一覧confirmed/descriptorあり/画像200/基本primary保持/残高11不変を確認。追加生成・ユーザー作品変更0。state UIはフラグOFF、物理Android操作は未実施。
- **15ページ品質FAIL**: source3f実OpenAI/実PageService・人工物語2797文字、15page/60panel原子的保存・全15引用保持・全brief全文到達・app credit0。最初のrunでP1道標説明/P15十分充電欠落。別trace runでもdetailへ原文到達後P1道標/P15充電・絵本を閉じる/P9除去後の再押下が欠落し、audit issues0/repair0が見逃す。P14継続回転と外景人物空は正しく、trace primary/strict P14否定は偽陽性。P9 broad-order検査は偽陰性。manual-v2で分類訂正しprimary/strict SHA不変。初版manualは別run strict参照誤り/scope表現誤りを残しv2が置換。保存成功を品質合格としない。原因はdetail出力と意味監査、フロント/patch repairではない。実provider9calls、画像生成0、in-memoryで最新SQS/実DB15pageとは別。追加未変更反復/fixture専用製品判定は行わない。旧9cのsnapshotはQA helper誤上書きで復元不能、合格扱いしない。
- **APK/画面**: c831278f-4d73-4561-bb06-d73a0cc25e74 FINISHED、com.lyra.mobile.staging/0.1.18。https://expo.dev/accounts/sh0g0/projects/lyra-mobile/builds/c831278f-4d73-4561-bb06-d73a0cc25e74 。実Webで通常2buttons有効/Hy4両方無効。物理Android・旧store client未実施。
- **運用/残事項**: Ops15files/114tests PASS、実RDS drain契約install/count/teardown・4対象不存在PASS。旧expiryはDISABLED。新IAM文書送信/解析は自動承認拒否requests0・回答待ち、同効果迂回なし。DB/ALB/API固定費継続、一週間自動停止/料金ゼロは未成立。公開GitHub更新拒否を再試行せずlocal PR/bundle。Stripe実購入はユーザー見送り。Google外部設定、Hy4公式契約、代表data移行/復旧、物理APK/旧版、最新SQS/DB長編受入・意味品質改善、shutdown/cleanup実演が残る。本番反映可能との判定は未成立。
- **保護/公開**: 元HEAD85625cd・dirty28paths内容/削除状態不変、store-assets/google-play保護。Dots23878f9/clean再確認。main merge/本番/store/public GitHub更新0。


### 長編意味欠落の次候補（設計のみ・未実装）

段階traceをAstraが独立レビューし、原作から位置付き文・節IDを作り、既存audit call内で各IDに対応する実panel/entity action fieldの完全一致引用を返すsidecar契約を次候補とした。beat ledgerだけを基準にするとledger自身の省略を固定化するため不可。ID過不足/重複・field存在・引用一致は機械検証できるが、「安定点灯」を「十分充電」と誤対応する意味判定は証明できない。未検証のため今回の修正として採用せず、flag既定OFFの限定検証候補に留める。追加provider call、旧経路への保存拒否、保存済みページ再生成、モデル置換は導入しない。採用前に今回の4省略検出/修復、P14正当な継続動作、偽引用/未知panel、token/timeout/最大2audit/legacy soft-save互換を検証する必要がある。設計レビュー自身のnetwork/provider/AWS/writeは0。
