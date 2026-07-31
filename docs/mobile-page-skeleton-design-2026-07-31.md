# Mobile 初回ページ骨格生成 slice 設計

## 目的と範囲

Mobile の Page tab で、選択した話の既存ページ一覧を確認し、ページがまだない場合だけ初回ページ骨格生成を開始して進捗・完了を確認できるようにする。

今回は既存ページの上書き再生成、ストーリーから設定を自動入力、個別ページ設定、コマ編集、画像生成、job cancel / hideを実装しない。初回生成requestは常に `overwrite_existing: false`、`apply_story_plan: false` とし、既存ページ・画像・確定データを削除または上書きしない。

## Spec 根拠

- `docs/Lyra_Unified_Spec_v4.md` 2: page skeletonを作成した後にstoryをeditable panel fieldsへ反映する二段階フロー。
- 同 4、5: personal owner / active organization membershipとworkspace scopeを既存Routeとquery keyで維持する。
- 同 6: `episode_page_skeleton`はqueued / processing / terminal stateを持つgeneration jobで、active uniqueness、timeout、retry、recovery、cancellation契約を壊さない。
- 同 6: Sceneはoptional contextであり、Scene 0件でもページ骨格生成を許可する。

## 影響レイヤー

- Mobile: API client、query key、PagesScreen、Page planning component、i18n、tests。
- Backend / DB / Worker / Web / prompt / credit / billing / external API: 変更しない。

## API インターフェース

- `GET /api/episodes/:id/pages?organization_id=...` -> `{ pages: Page[] }`
- `POST /api/episodes/:id/generate-page-skeleton?organization_id=...`
  - body: `{ overwrite_existing: false, apply_story_plan: false, language: 'ja' | 'en' }`
  - queued production path: 202 + `{ job_id, queued: true, story_plan_applied: false }`
  - synchronous local fallback: 201 + `{ pages_created, panels_created, replaced_existing, story_plan_applied, story_plan_job_id }`
- `GET /api/jobs?limit=50&organization_id=...` -> recent active-first job history
- `GET /api/jobs/:jobId?organization_id=...` -> enqueueまたは履歴復元で特定した単一job
- 既存の認証、1回だけの401 refresh、timeout、canonical response schema、sanitized `ApiError` を再利用する。

## UI と状態遷移

- 話選択後、「ページ設計」とScene editorをPage tab内に置く。ページ一覧は page number / status / panel countを表示し、0件は正常empty stateとする。
- ページ0件かつepisodeの `page_skeleton_generated` がfalseの場合だけ「ページ骨格を生成」を有効にする。
- 既存ページまたは生成済みflagがある場合は上書きbuttonを出さず、「既存ページを保護するためMobileからの上書き再生成は未接続」と表示する。
- Scene draftがdirtyの場合、保存 / 破棄 / cancelを解決してからenqueueする。保存失敗またはcancelではenqueueしない。
- Scene保存・Scene作成・骨格enqueueは同じsingle-flight mutation境界で直列化する。
- 同じepisodeのactive `episode_page_skeleton` または `episode_story_autofill` jobがある間は新規enqueueとScene編集を止める。Backend active uniquenessも最終防壁として維持する。
- job historyはsession / workspace scoped queryでactive job IDを発見・復元するためだけに使う。未追跡時は8秒間隔で履歴を再取得し、Webや別端末から後発した同じ話のactive jobも検出する。enqueue responseまたは履歴から特定した正確なjob IDを`GET /api/jobs/:jobId`で監視し、active jobがある間だけ8秒間隔でpollする。履歴一覧をprogress pollとして使わず、別jobへの取り違えを防ぐ。
- Mobile全体でAppStateをTanStack Queryのfocus stateへ接続する。background中はnetwork pollを止め、foreground復帰時はstaleなjob queryを即時再取得する。
- 各pollは前回のreadが完了していない間は次のtickをskipする。API timeout 15秒より短い8秒intervalでも同じhistory / job readを重ねない。
- queued / processingではsanitized progress messageと利用可能な進捗値を表示する。terminal時はpollを止め、pages / episodesを再取得する。
- failed / cancelledは既存入力を変更せず、安定した再試行案内を表示する。completed後にページが読めない場合はpage list errorとして区別する。

## 破壊防止とセキュリティ

- Page responseとjob responseは既存generated schemaで検証し、不正payloadをstateへ入れない。
- raw worker / provider errorの `error_message` やstack traceを直接表示しない。
- page skeletonはtext AIでcredit 0の現行Backend契約を変更しない。Mobile側でcreditを加減しない。
- job ID、episode ID、organization ID以外のstorage / provider identifierを送らない。
- 既存ページ上書きは、generated image S3 orphan、confirmed page、active page generation、story source metadataへの影響をBackendで安全化するまでfail closedにする。
- generic cancelは本番feature flagがOFFのため、このsliceでbuttonを表示しない。
- job履歴取得中・取得失敗・active job中はScene保存・作成と骨格enqueueの各入口でもfail closedにする。UIのdisabledだけを安全境界にしない。

## TDD と検証

先に以下の失敗テストを追加する。

- API clientがpage list、page skeleton enqueue、job historyのpath / body / organization scope / canonical schemaを守る。
- PagesScreenが0件、既存page、page query errorを区別し、既存page時にenqueueしない。
- dirty Sceneのsave / discard / cancel後だけenqueueし、Scene保存失敗では止まる。
- queued responseをhistoryへ接続し、active job中の二重enqueueとScene編集を防ぐ。
- active jobを再表示し、terminal時にpages / episodesを再取得する。
- 画面表示後に別端末で開始されたactive jobを履歴pollで検出し、Scene編集と骨格enqueueを止める。
- 404ではtrackingを解除してpages / episodesを再取得し、一時通信失敗では同じjob IDのlockとretryを維持する。terminal後は単一job pollを停止する。
- AppState background / activeでquery focusを停止 / 再開する。
- synchronous responseでもpages / episodesを再取得する。
- failed / cancelledでraw errorを表示せず、retry可能な安定文言を出す。

focused Mobile testsをred確認後に実装し、Mobile full gate、両OS export、Backend / Web / Playwright、fresh DB migration / invariant / integration、GitHub CIを統合前に確認する。

## Terra 委譲

TerraはBackend Route / job / Web readiness / Mobile schemaのread-only監査を担当する。Solが初回生成限定、overwrite fail-closed、dirty連携、job poll、統合可否を判断し、全差分と検証をレビューする。
