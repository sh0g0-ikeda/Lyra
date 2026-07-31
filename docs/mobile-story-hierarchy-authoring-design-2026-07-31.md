# Mobile Story hierarchy authoring design

## 目的と範囲

PR #136で統合したStory閲覧・episode編集の上へ、personal workspaceで作品・章・話の階層を作成・整理する操作を追加する。対象は作品作成と名称変更、章作成・名称変更・上下移動、話作成・上下移動である。話タイトルの変更は既存episode editorの保存を正とし、同じfieldを別フォームから二重更新しない。

Backend / DB / migration / Worker / Webは変更しない。work削除は現行Backendにendpointがないため追加しない。chapter / episode削除もactive generation / export jobとcascade・refund・recoveryのBackend方針が未確定なため、UIを先行させず別PRへ分離する。Characters / Pages、scene、Story AI、page skeleton、organization picker、billing、push、work pagination UIはこのsliceへ含めない。

## Spec根拠

- `docs/Lyra_Unified_Spec_v4.md` §2 Product boundary: work / chapter / episodeを構成してStoryを作る
- 同 §4 Authentication and authorization: personal ownership / organization capabilityをRouteで強制する
- 同 §5 Persistence and tenancy: PostgreSQLをsystem of recordとする
- 同 §8 Input and output safety: bounded strict inputとschema-validated response
- 同 §10 Verification gate

## 現行契約と非互換監査

- `POST /api/works`は`title`必須、organization workだけbodyへ`organization_id`を含め、`create_work` capabilityを要求する。
- `PUT /api/works/:id`、chapter / episodeの全mutationは任意の`organization_id` queryを使い、`edit_work` capabilityを要求する。
- chapter / episode作成は1〜1000の`order`が必須で、同じ親のorder重複はconflictになる。append orderは件数ではなく現在の最大order + 1を使う。
- chapter / episode移動はBackend transactionが隣接orderをswapする。episodeは章端で`cross_chapter: true`を明示した場合だけ隣の章へ移る。
- chapter / episode削除は204だが、現Serviceはactive jobを確認せずcascade deleteする。安全方針確定前なので今回のMobile API / UIへ接続しない。
- work削除・work並べ替えendpointはない。
- PR #67の旧Mobileは現行にない`expected_updated_at`と巨大なAppState / storage / icon依存を含むため、componentを移植しない。旧Web hierarchyにもepisode削除の二重API callがあるため、処理本体をコピーせず削除自体を後続へ分離する。

## UIと状態遷移

- 既存の作品・章・話selectionの近くへ小さな「階層を編集」操作群を置く。タイトル入力は1〜200文字へtrim後に検証する。
- 作成成功後は作成対象を選択する。現在のepisode draftがdirtyなら、作成APIを呼ぶ前に保存 / 破棄 / cancelを解決する。cancelまたは保存失敗では作成しない。
- work / chapter名称変更と章移動はepisode draftを変更しないため、そのまま実行する。
- 話移動はdraft本文を再初期化しない。同じ章ではorderだけを更新し、章境界を越えた場合は選択chapterを移動先へ合わせ、旧章・新章双方のqueryを再取得する。
- mutation中は保存を含む操作をsingle-flightにし、二重作成・二重移動と保存応答による章の巻き戻りを防ぐ。失敗時は実際のmutation errorだけを表示し、空一覧をerrorにしない。

## API・cache設計

- Mobile APIへcreate / rename / move methodだけを追加し、既存401 refresh、timeout、安全なerror、generated response schemaを共用する。delete methodはactive job保護をBackendで設計した後の別PRとする。
- chapter / episode作成が409になった場合だけ一覧を再取得し、新しい最大order + 1で1回だけ再試行する。その他の4xxや5xxは無条件retryしない。
- 成功後はsessionとpersonal / organization scopeを含む既存query keyだけを更新またはinvalidateする。cross-chapter移動は旧・新chapter双方を対象にする。
- 作成可能なorderが1000を超える場合はclientで止め、APIを呼ばない。

## セキュリティと破壊影響

- IDはschema検証済みselectionからだけ使い、user / organization IDの自由入力を追加しない。
- UIはpersonal scope固定を維持する。APIは将来のPR-Gで使うorganization引数を同じ規則で扱う。
- Backend data contract、credit、generation job、page保存、story promptを変更しない。反映時間への追加はmutation後の対象query再取得1回で、通常は1 network round trip、order conflict時だけ最大2 round trips増える。

## TDDと検証

- domain: 最大order + 1、1000上限、title境界、章境界を含むepisode move可否
- API: personal / organization path・body、POST response schema、409 status保持、raw error非公開
- component: 作成・名称変更・移動、dirty save / discard / cancel、single-flight、cross-chapter cache更新
- regression: PR #136のempty/error分離、structured story保持、保存中切替を維持する
- 最終gate: Mobile contract / typecheck / lint / full test / Expo check / doctor / Android・iOS export、Backend Vitest / Bun / build、fresh DB migration / invariant、Web lint / build / Playwright

## Sol / Terra

Solがscope、削除UX、dirty整合、cache・統合判断、最終検証を所有する。Terraには現行mainとPR #67のRoute / validator / UI差分をread-only監査させ、実装・Git操作・統合判断は委譲しない。
