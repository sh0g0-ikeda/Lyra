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

The 2026-10-04 requirement that published-app operations continue makes that
write-freeze bridge unsuitable for this release. Its successful local fixture
tests do not authorize its use against production or establish an uninterrupted
cutover. Representative-lineage inspection and old/new writer acceptance, or a
separately tested additive compatibility transition if the bridge is needed,
remain blocking release gates. Keep this distinct from old-client response
compatibility and fresh staging-schema results.

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


## 2026-10-05 現在の公開判定と旧DB対応の残境界

本番反映可能との判定は **未成立**。本節は過去の3f5e289・Dots・旧stagingの結果と区別する。最新コードの全体gateと検証配備は実施結果を実装記録へ追記し、途中停止や未実施を合格にしない。

| 項目 | 現在の証拠と残事項 |
|---|---|
| ローカル修正 | upload発行の退会/role/scope直列化、同一署名期限と応答時期限判定、temporary inventory、旧claim FK循環、completion3marker CAS、一時import keyの実lifecycle契約を限定修正。実PG/Node/Bunの根拠は実装記録の各receipt。canonical契約・DDL・料金変更なし。 |
| Web/Mobile | fa9固定でMobile1042・型/lint/contracts、Web型/lint/build/smoke25とorgON/OFF基本操作が合格。新固定SHAの全体証明は別。Hy4はWeb無効ボタンのみ、Mobile入口なし。state previewは1cr。 |
| APK/実機 | APK472c508は完成済み。今回のMobile/packages差分は0。旧store版と新APKの実機・認証・編集・中断復帰・実API受入は未確認。 |
| 検証環境 | 現在稼働imageは678c8e8、API1/worker全0。保存済み画像/手動保存/戻る・cancel等の実画面結果はこのimageの証拠。Google/link/billing/deletion/export/state新受付はOFFで、実受入へ読み替えない。 |
| 旧DBの候補起動 | legacy_2debe_v1は全環境で起動拒否を維持。app/recoveryの退会factoryはcanonical固定。未対応の候補を既存DBへつなぐ状態ではない。稼働旧runtimeを停止/置換しない。 |
| 外部処理・退会耐久性 | 外部作用前intent、3同意永続化、処理中crashからの安全再開、entity削除後も保持するupload exact key inventoryが未実装。tag/DBmarkerは物理画像削除の証明ではなく、旧URL実期限/進行中PUT/tmp lifecycleも未確認。 |
| 本番代表データ/M2 | 指定本番snapshotの保護copyは自動承認レビューがデータと宛先の承認不足で拒否。copy/restoreを実施せず、別経路で迂回しない。代表データの保存作品/画像/残高、mixed writer、候補作成行の旧binary rollbackが未確認。local人工DBの71invariantsは代用しない。 |
| 長編/P9 | 指定長い原文のOpenAI送信は既存自動承認拒否のまま未実施。別fixture/宛先/セッションへの置換で迂回しない。既存15ページ品質FAILも取り消さない。保存成功・offline preview・過去の短編成功を意味品質合格へ流用しない。 |
| 公開PR | 公開GitHub更新は既存拒否を再試行しない。ローカル統合branch/commit/diff/PR本文・bundleとしてレビュー可能な形を整える。本番/main/store提出は今回実施しない。 |

### schemaと旧writerの未解決仕様境界

Spec §11は第一phaseで物理schemaと既存billing/deletion/export/worker workflowを保持し、046の全writer停止を許さない。旧027に3同意/外部intentの保存先がなく、旧031はentity削除でupload tokenをCASCADE削除する。既存checkpoint配列/failure欄の別用途流用は旧workflowの意味を変えるため採用しない。旧runtimeはprocessing ownerを10分で再取得し、completion/failureでtokenを解除する。C0 044のattempt/token CHECKはこの旧UPDATEと衝突するため、旧INSERTが通ることだけではmixed writer/rollback互換を証明できない。

選択肢は、第一phaseの旧workflow保持を満たす互換adapterと混在/切り戻し証拠を先に揃えるか、退会専用受諾・外部step/attempt/unknown状態とnon-cascading upload inventoryの追加schemaを後続phaseとして明示的に設計すること。後者でも旧writerの所有権、旧binaryへの切り戻し、候補作成行を含む代表copy検証が必須で、nullable/opt-inだけで互換とはみなさない。048追加・factory接続・guard解除を未確認のまま行わない。

## 2026-10-05 d02535c固定の更新結果 r2

本節が最新sourceの索引。旧sourceの記録は履歴であり、今回の合格証明ではない。

- 最新製品SHA d02535c2567540634b9c9c280405cae1c70fbfde。ローカル必須gateは個別結果・件数・証拠hashを docs/uiux-backend-expansion-2026-09-30/receipts/d02535c-final-gates-r3.json に記録。
- 検証環境runtime確認PASS。 実画面QAはpartial。 provider acceptance=false、physical device=false。
- productionReady=false。M2/P9/public GitHub拒否、旧writer互換とrollback、外部設定、物理実機は未完。本番/main/storeへ変更しない。


## 2026-10-05 Web画像解析後の残高更新 (c343192)

- 実画面で画像解析後の残高が11のまま、再読込すると10になることを確認し、送信時のworkspace/sessionに限定した再取得を実装。個人の成功/500返還、組織の残高だけの再取得を回帰テストで確認。確定操作は料金0のため追加再取得を入れていない。
- 根拠: Unified Spec の認証・テナンシー・クレジット・Verification gate。影響は Web の表示キャッシュとE2Eのみ。API/DB/料金/画像/保存済み入力を変更していない。
- 回帰検証: 担当のRED/GREENにはrawが残っておらず採用しなかった。統合コミット前に主担当がbaselineコードへ新テストを当て3件RED、修正コードで3件GREENをログ・JSON付き確定した。R1のtestIgnore対象誤り、R2の使用中port、R3の隔離下終了処理、R4の存在しないPC用Accountボタンの失敗を保存し、PCのAccount menu→Workspace settingsへテストを修正してR5で合格。これは実装前に保存済みのREDがあったという意味ではない。Sol追加レビューの起動はagent thread limitで失敗したため主担当がquerykey/session/scope/finallyとテストを直接レビュー。
- Web 78件、型検査、lint warnings=0、build合格。バックエンド3545件・モバイル1042件は d02535c2567540634b9c9c280405cae1c70fbfde で実行済み。今回その入力全件のGit blob/mode/path一致を確認し、同じテストの再実行を省略した。新SHAで再実行したとは記録していない。
- 検証環境の最新反映: image sha256:6754dce8fab618e66a43d6181ebd572f5a776adf1ed2b73e53be09eb05f9e095 / healthz・readyz 200 / workers 0。残高の実画面再確認: 再読込せず更新を確認。オフラインテストを実課金・実生成の全体合格とは扱わない。
- 元checkoutのdirty28件とstore-assetsを保護。M2/P9/legacyDB・旧writer・rollback/Google・課金・実機の保留は継続。本番・main・ストア・公開GitHubを変更していない。本番判定はNO-GO。
- 根拠receipt: docs/uiux-backend-expansion-2026-09-30/receipts/c343192-web-balance-final-r1.json。既存の失敗ログ・d02535c証跡を保存。


## 2026-10-05 Codexで進められる残作業の完了範囲 (37490ff)

- 組織生成のcompleted/failed/cancelled後に組織残高・組織一覧だけ再取得する更新漏れを修正。個人生成の従来更新と、組織の遅い応答が個人の残高更新を起こさない境界も確認。製品変更はApp.tsxの2行、API/DB/料金/ジョブ契約/保存画像/Mobile変更0。Spec §§4/7/8/10と第11節の既存利用維持が根拠。
- Solの設計・静的最終レビュー承認。Terraの再開はthread limitで失敗したため主担当が限定実装。実装前r2の4 RED/1 PASS、固定baseline比較r4の4 RED/1 PASS、最終r5の5 GREENをraw/JSONで保存。UI要素・初回読込回数・明示的scope再訪の通常GETによるharness誤失敗を保存し、scope跨ぎの検証を維持して補正。
- 最新製品SHA 37490ff6a7a1b2dd7af12c520ff264ae768065c2: Web全83件・type・lint warnings0・build PASS、組織OFFの個人terminal1件PASS、runtime helper16件PASS。Backend Node/Bun各3545・Mobile1042はd02535cで実行した入力全件のGit tree一致とraw SHAを確認。新SHAで再実行したとは記載しない。PG16/18人工DBの前回readonly証拠は実代表データの代替ではない。
- コンパイル済みbackend429/Web28、secret/env/DB非包含の検証imageをローカル作成。新37490ff payloadの既存非公開ECR送信は自動承認レビューが『宛先は承認済みだが新payloadの明示承認不足』として拒否。実送信・CFN更新0、別経路/再試行0。最新候補の実環境受入は未実施。
- 現在の検証環境はc343192のまま。14:02Z readonlyでAPI1、全worker0、health/ready200。CUAで通常ログイン、既存4作品/2キャラ、レファレンス読込、残高9不変を確認。この結果を37490ffのQAとして扱わない。追加生成・購入・保存・削除0。
- 元HEAD85625cdとdirty28件・store-assetsを保護。APK472c508のhash/107229392 bytesを再確認し、Mobile/packagesの製品treeは最新と同一。実機は未実施。公開PR更新拒否が継続するためローカルdiff・PR本文・復元bundleを用意。
- 旧DB profileは全環境で起動拒否を維持。旧027の3同意/外部intent欠落、processing再開の旧10分reclaimと新pending-onlyの衝突、旧031CASCADEによるexact-key inventory消失、tag/markerだけでは物理削除を証明できない問題をSolと主担当で再確認。factory接続/048追加/guard解除は行わない。既存退会の旧runtime単独所有を維持する運用分離、または後続durable protocol/schemaを明示設計し、混在・切戻し・代表copy証拠が必要。
- 15pageの意味欠落FAILを維持。gated-OFF引用coverageのローカル成功から意味検出・修復を合格へ読み替えない。M2/P9/publicGitHub/newIAMの以前の拒否を迂回しない。Google・課金・旧版/新APK実機・S3・shutdown/一週間固定費は未完了。productionReady=false。本番/main/store変更0。
- 証拠: docs/uiux-backend-expansion-2026-09-30/receipts/37490ff-organization-balance-final-r1.json。
