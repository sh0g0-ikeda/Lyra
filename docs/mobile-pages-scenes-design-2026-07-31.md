# Mobile ページ画面・シーン編集 slice 設計

## 目的と範囲

Mobile のページ導線を追加し、選択した話に紐づく任意のシーンを一覧・作成・更新できるようにする。シーン UI は Story 画面ではなく Page 画面に置き、場所・時間・雰囲気を将来の Story AI、ページ骨格、ページ設定自動入力が参照できる状態までを今回の範囲とする。

今回は Scene 削除、並べ替え、登場人物の割り当て、Entity state、Story AI、ページ骨格、ページ・コマ編集、生成ジョブ、画像表示を実装しない。特に削除は、`pages.scene_id` の参照、`layout_config.story_source_scene_ids`、実行中の生成処理を同時に検査する Backend 安全境界がないため UI を公開しない。

## Spec 根拠

- `docs/Lyra_Unified_Spec_v4.md` 2: scene は episode story に追加できる optional context であり、scene がなくても主要フローは成立する。
- 同 3: Mobile は `apps/mobile` に閉じ、Route / Service / Repository の責務と既存 Backend 契約を変更しない。
- 同 4、5: personal ownership または active organization membership を既存 Route で検証し、Mobile query key も session / workspace で分離する。
- 同 6: scene は将来の Story AI / page plan の入力だが、今回の保存で生成 job を開始したり既存 job を書き換えたりしない。

## 影響レイヤー

- Mobile: API client、query key、Page screen、scene draft、i18n、tab navigation、tests。
- Backend / DB / Worker / Web / credit / billing / external API: 変更しない。

## UI と状態遷移

- Home に「ページ」tabを追加し、そこに作品、章、話の read-only 選択と Scene editor を置く。既存 Story と同じ session / organization scoped query key を共有し、同じデータを重複取得しない。
- 話未選択時は Scene API を呼ばない。0件は正常な empty stateとして表示し、error bannerを出さない。
- Scene は order 順に表示し、選択項目には `シーン N` と保存済み location を表示する。
- 新規追加は現在の最大 order + 1 で空 Scene を作る。上限 1000 は client でも拒否する。現行Backendはorder一意制約を422へ正規化するため、422後に一覧を再取得し、別Sceneによって最大orderが実際に増えていた場合だけ新しい最大 order + 1 で一度だけ再試行する。最大orderが変わらない一般validation errorは再試行しない。
- 編集対象は location / time / atmosphere のみ。各200文字以内、空白だけの入力は `null`、変更のない field は PUT body に含めない。`involved_entity_ids`、`entity_states`、`status` は受信して保持するが暗黙に更新しない。
- Scene 切替、作品・章・話切替、Page tabからの離脱では dirty draft を保存 / 破棄 / cancel で解決する。保存失敗時は入力と選択を保持する。
- Story と Page の tab 遷移は単一の transition promise で直列化し、二重 prompt / 二重保存を防ぐ。片方の画面の保存処理中に別tabへ移動しない。
- Scene 作成・保存は single-flight とし、成功後だけ cache と選択を更新する。失敗時に optimistic remove / overwrite をしない。

## API インターフェース

- `GET /api/episodes/:id/scenes?organization_id=...` -> `{ scenes: Scene[] }`
- `POST /api/episodes/:id/scenes?organization_id=...` body `{ order, location?, time?, atmosphere? }` -> Scene, 201
- `PUT /api/scenes/:id?organization_id=...` body changed fields only -> Scene, 200
- 既存の一回だけの 401 refresh、15秒 timeout、Zod response validation、sanitized `ApiError` を再利用する。

## セキュリティと破壊防止

- ID は URL encode し、organization ID は既存 query helper だけで渡す。認証・capability・ownership は既存 protected Route に任せる。
- raw Backend error、provider error、stack trace を表示しない。
- Scene response は既存 strict contract で検証し、未知・不正 payload を local state に入れない。
- Backend schema、request / response contract、Story / Page persisted fields、Entity、credit、job、prompt は変更しない。
- Scene 削除は Backend safety design と実DB競合テストが完了するまで fail closed のままにする。

## TDD と検証

先に以下の失敗テストを追加する。

- API が scene list / create / update の method、path、organization scope、response schemaを守る。
- Scene draft が200文字境界、空文字の null 化、changed-field-only update、dirty判定を守る。
- Page screen が階層選択、0件、作成、order競合の一回再試行、更新、失敗時draft保持、save / discard / cancel、single-flightを区別する。
- Home tab が Story / Page 双方の `prepareToLeave` を尊重し、遷移を重複起動しない。
- Scene削除UIが存在しないことを回帰確認する。

focused Mobile testsを red 確認後に実装し、Mobile typecheck / lint / full tests / contract drift / Expo dependency / doctor / Android・iOS export、Backend Vitest / Bun / build、Web lint / build / Playwright smoke、fresh DB migration / invariant / integration gateを最終確認する。

## Terra 委譲

Terra は Backend scene route / service / repository、Mobile API / screen、削除参照の read-only 監査だけを担当する。Sol が UI配置、scope分割、削除除外、統合可否を判断し、全差分と検証結果を最終レビューする。
