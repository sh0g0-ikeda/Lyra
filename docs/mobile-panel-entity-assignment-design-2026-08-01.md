# Mobile Panel登場要素割当編集 設計ブリーフ

## 目的と範囲

MobileのPage画面で、既存Panelに保存されている登場要素割当を追加・削除・編集する。
割当ごとの役割、表情、動作、位置、向き、効果メモ、任意のEntity stateを扱い、保存には
既存の`PUT /api/panels/:id/entities`の条件付き契約を使う。

このsliceはMobile client、Mobile domain、Mobile UI、tests、task listだけを変更する。
Backend Route / Service / Repository、DB schema / migration、Panel保存JSON、Prompt、SQS
message、generation job、credit / refund、Worker、Webは変更しない。Panelの作成・削除・
並べ替え、frame / balloon、Page画像生成もこのsliceへ混ぜない。

## Spec根拠

- `docs/Lyra_Unified_Spec_v4.md` 3 / 5: Mobileは既存API契約を利用し、personal ownership
  またはactive organization membershipのscopeをBackendの最終判断とする。
- 同 6: 画像生成は現在の保存済みPanel入力を使う。assignment編集から生成job、queue、
  credit、Workerの状態遷移を変更しない。
- 同 8: bounded inputとvalidated responseを使い、raw errorを表示しない。
- 同 10: Mobile対象テストに加えて統合前にrelease verification gateを通す。
- `docs/Lyra_StoryAI_SubSpec.md` 3 / 5 / 6: 1 Panel最大8 Entity、関連するEntityだけを
  割り当て、speaker identityとassignmentの整合性を維持する。
- `docs/panel-entity-assignment-safety-design-2026-08-01.md`: 任意の
  `expected_entities`を指定した条件付き保存と、成功後のauthoritative Panel再取得を使う。

## 影響レイヤーとインターフェース

- Mobile API client:
  - work単位の既存Entity paginationとEntity state一覧を再利用する。
  - `replacePanelEntityAssignments(panelId, { entities, expected_entities }, organizationId)`を
    追加する。成功responseは既存`panelAssignmentsResponseSchema`で検証する。
- Mobile domain:
  - 保存済みassignmentから独立draftを作る。
  - semantic比較、nullable化、custom field、最大8件、重複、speaker整合性を純粋関数で検証する。
- Mobile UI:
  - `PagesScreen`が現在のwork IDを`PanelEditingSection`へ渡す。
  - `PanelEditingSection`がsession / workspace / workで分離したEntity一覧をpagination取得する。
  - Panel内容draftとassignment draftは別責任・別保存ボタンにする。
  - assignmentごとのEntity stateはsession / workspace / Entityで分離した既存query keyで取得する。

## 保存データと後方互換

送信する各assignmentのshapeは既存どおり次の10 fieldに固定する。

- `entity_id`
- `role`
- `expression`
- `custom_expression`
- `action`
- `custom_action`
- `position`
- `facing_direction`
- `effect_note`
- `state_id`

新規assignmentの`state_id`は`null`とする。既存assignmentを別目的で編集する場合も、保存済み
`state_id`を保持する。state一覧取得失敗や未知の保存済みstateを暗黙に`null`へ変換しない。
既存のrequest `{ entities }`、response `{ entities }`、`panels.entities` JSONは変更しない。
Mobileだけが追加済みの任意field `expected_entities`を常に指定する。

## dirty stateと部分保存の防止

Panel内容の`PUT /api/panels/:id`とassignmentの
`PUT /api/panels/:id/entities`は別transactionであり、1つの「保存」で順番に呼ぶと途中成功が
起こり得る。このため自動連結しない。

- 内容draftがdirtyの間はassignment編集を開始できない。
- assignment draftがdirtyの間は内容編集と内容保存を開始できない。
- それぞれに独立した保存ボタンと成功・失敗表示を置く。
- Page / Panel / work / episode / tab切替、Story自動入力開始前の`prepareToLeave`は現在dirtyな
  一方だけを保存・破棄・取消で解決する。
- 防御上両方がdirtyになった場合は自動保存を連結せず、遷移を止めて個別解決を求める。

assignment draftのIDをPanel dialogueの話者候補に使う。ただしassignment dirty中は内容編集を
止めるため、未保存assignmentを含むdialogueを先に保存することはない。保存済みspeech /
thought / shout / whisperの話者を外す操作はMobileで拒否し、Backendの同じ検査も残す。

## 条件付き保存と競合処理

1. 保存開始時にsession、organization、work、Page、Panel、保存済みassignment snapshot、
   desired assignmentをcaptureする。
2. 最大8件、Entity重複、custom文字列、文字数、speakerを検証する。
3. `{ entities: desired, expected_entities: saved }`をsingle-flightでPUTする。
4. PUT responseはschema validationにだけ使い、Panel cacheをoptimistic更新しない。
5. 同じcapture scopeで`GET /api/pages/:pageId/panels`を直ちに実行する。
6. 対象Panelが存在し、assignmentがdesiredとsemantic一致した場合だけ一覧cache、saved Panel、
   saved assignment draftを更新する。
7. 遅延responseの完了時にsession / workspace / work / Page / Panelが変わっていればUIへ反映しない。
8. 409 / 422ではdraftを保持する。PUT成功後のGET失敗、invalid success response、network /
   5xxなど結果不明の失敗は自動再送せず、手動再取得で照合する。
9. 再取得結果がdesiredなら保存成功として採用し、元snapshotなら再試行可能にし、どちらとも
   異なればremote changeとしてdraftを保持したまま古いsnapshotでの保存を拒否する。

assignmentのremote change判定はPanel全体の`updated_at`ではなくassignmentのsemantic snapshotで
行う。別fieldだけの更新で不要な競合にせず、assignmentのsilent overwriteは防ぐ。

## 入力上限と表示

- assignment: 最大8件、Entity ID重複不可。
- `custom_expression`: custom選択時必須、最大100文字。
- `custom_action`: custom選択時必須、最大100文字。
- `effect_note`: 最大200文字。
- work Entity一覧は50件ずつ取得し、`next_cursor`がある場合だけ明示的に追加読込する。
- state選択肢は現在のEntityに属する既存stateだけを表示し、「指定なし」を常に選べる。
- Pageが`confirmed` / `generating`、episode planning jobがactive、必要queryが失敗中、または
  保存中は該当編集・保存をfail closedする。

## セキュリティ

- candidate Entityとstateは選択中のwork / organizationを付けた既存認証APIから取得する。
- Mobileの候補絞り込みを認可とはみなさず、Backendのownership / membership、同一work、
  Entity-state所属検査を残す。
- responseの別Page、別Panel、別Entity state混入を既存API wrapperまたは採用前照合で拒否する。
- raw server / provider error、token、organization外IDをUIやログへ出さない。

## TDDと検証方針

先に次の失敗テストを追加し、期待するredを確認してから実装する。

- domain: semantic比較、nullable/custom正規化、8件境界、重複、文字数、speaker、state保持。
- API: organization query、`entities`と`expected_entities`の正確なbody、response schema違反。
- component: Entity pagination、追加・削除・全field/state編集、内容との相互dirty blocking。
- save: single-flight、expected snapshot、PUT後GET成功だけcache採用、409 / 422 / GET失敗でdraft保持、
  結果不明時の手動照合、別Page / Panel / scopeの遅延結果非反映。
- navigation: assignmentの保存・破棄・取消、両draft同時dirty時のfail closed、read-only status。
- Pages統合: work ID引き渡しと既存Story自動入力・上位選択のdirty guard維持。

対象テスト成功後、Mobile full Vitest、typecheck、lint、contract drift、API inventory、Expo dependency
check、expo-doctor、Android / iOS exportを実行する。統合前はBackend Vitest / Bun、build、fresh
PostgreSQL migration / invariant / integration、Web lint / build、Playwrightも再確認する。

## Terra委譲

Terraはread-onlyで現行Mobile境界とPR #67を監査した。PR #67の内容保存後にassignmentを連結する
方式、20件上限、広範なPage editorは採用しない。実装、scope guard、最終統合判断はSolが担当する。
