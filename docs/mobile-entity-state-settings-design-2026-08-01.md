# Mobile Entity state（服装・状態）slice 設計（2026-08-01）

## 目的と範囲

PR-F の Characters に、保存済み Entity ごとの連続性状態を一覧表示し、新規作成・更新できる UI を追加する。編集対象は、任意の同一作品 Scene、服装、体調・負傷、髪、通常表情、補足である。これらは Story-to-page autofill と Panel entity assignment が参照する既存 `entity_states` を、既存 REST API だけで管理する。

この slice は Mobile の API client、query key、domain draft、Characters UI、i18n、tests だけを変更する。Backend Route / Service / Repository、DB / migration、Worker、Web、shared API contract、generation job、SQS、credit / refund、画像保存形式は変更しない。現行 API に存在しない Entity state 削除は公開しない。

## Spec 根拠

- `docs/Lyra_Unified_Spec_v4.md` 2章: Scene は任意の文脈であり、Entity と確定参照画像を含む制作データを編集できる。
- 同3〜5章: Mobile は既存 API を利用し、personal ownership / active organization membership と永続化境界を変更しない。
- 同6章: Scene の服装・負傷等の状態は episode 全体の continuity brief と生成入力へ渡される。状態編集では generation job、atomic planning persistence、credit を変更しない。
- 同8章: request は既存 bounded Zod schema と同じ上限で事前検証する。
- 同10章: Mobile に加えて Backend / PostgreSQL / Web の全 release gate を統合前に確認する。

## 現行契約と変更しないルール

利用する API は次だけとする。

- `GET /api/entities/:id/states`
- `POST /api/entities/:id/states`
- `PUT /api/entities/:id/states/:state_id`
- 同一作品の Scene 候補を解決する既存 `GET works/:id/chapters`、`GET chapters/:id/episodes`、`GET episodes/:id/scenes`

Entity state の request / response field、nullable 規則、最大長、Scene と Entity の同一 work 検証、organization capability、監査イベントは現行 Backend のまま使う。Mobile は `id`、`entity_id`、要求した変更 field、Scene catalog の work / chapter / episode chain を照合し、別 resource の success payload を採用しない。

`costume_ref_id` は DB foreign key ではなく、現行 create / update Service も Reference set 所属を transaction 内で検証しない。Mobile から選択・自由入力を公開すると、参照画像削除との競合で dangling value を新しく作り得る。この slice では保存済み値を読み取り専用で表示し、create payload では省略、update payloadでは常に省略して既存値を保持する。安全な選択 UI は Backend の reference existence / deletion race を同じ transaction で閉じる別 slice とする。

## UI と状態遷移

1. 保存済み Entity の基本保存操作の後に「服装・状態」sectionを表示する。新規 Entity draft では状態 API を呼ばない。
2. state 0件は正常な empty stateとし、読込失敗と区別する。
3. 保存済み state を作成時刻順で選択できる。新規状態は Scene 未指定、通常表情 `neutral`、他の note は空で開始する。
4. Scene 未指定は作品全体の共通状態として扱う。Scene 候補は明示操作で読み込み、同一作品の chapter → episode → scene を検証してから選択肢へ出す。候補読込に失敗しても Scene 未指定の作成と既存 scene linkage の保持は可能だが、新しい Scene ID は送らない。
5. 服装、体調・負傷、髪、補足は trim 後 `null` または1〜2,000文字、通常表情は trim 後1〜100文字とする。UIは上限+1文字まで入力でき、明示的な local error を表示する。
6. update は変更 fieldだけを送る。空白への変更は `null` として明示clearする。`costume_ref_id` と未変更 field は送らない。
7. state、Entity、作品、workspace、session、tab の切替前に dirty draft を保存 / 破棄 / 取消で解決する。保存失敗時はdraftと選択を保持する。
8. create / update / transition は single-flight とし、操作中は別 Entity、作品、tab、参照画像操作を開始しない。旧scopeの遅延応答を新scopeへ反映しない。
9. update直前に state一覧を再取得し、保存時snapshotから semantic fieldが変わった、対象が消えた、別Entity responseになった場合は PUT を送らずdraftを保持する。
10. create は idempotency keyを持たない。POSTが失敗または応答不明になった場合は自動再送せず、draftを保持して結果確認を促す。明示再読込で新規stateを確認してからユーザーが次の操作を選ぶ。
11. create / update 成功時だけ Entity state cacheを更新する。Scene responseは `entity_states` の関連IDを含むため、Sceneへの新規関連付けまたは付け替え・解除が成功した場合だけ、同一scopeのScene query prefixを非同期でinvalidateする。服装等だけの更新では無関係なScene queryを変更せず、invalidate失敗を保存失敗として扱わない。

## 競合保証の限界

Entity state response には `updated_at`、revision、ETag がない。そのため保存前 GET で観測できた遠隔変更は拒否できるが、GET と PUT の間の同一field更新を完全には防げない。Mobile は changed-field-only、single-flight、identity照合で影響を限定する。厳密な楽観ロックは Backend contract・migration・Web互換性を設計する別sliceとし、今回のMobile UIだけで存在しないversion保証を装わない。

## セキュリティとデータ境界

- query key は session、personal / organization、Entityで分離する。
- URL ID は既存 API clientでencodeし、全requestへ選択workspaceの `organization_id` を渡す。
- Scene catalog は responseの `work_id`、`chapter_id`、`episode_id` chainを検証し、別workのSceneを選択肢に出さない。
- raw server body、stack、provider error、credential、reference image tokenを表示・保存・query keyへ含めない。
- state mutation は生成、参照画像、credit、job APIを呼ばない。

## TDD と検証方針

先に次の失敗テストを追加する。

- domain: create / changed-field-only update、null clear、各境界値、通常表情必須、remote semantic comparison、`costume_ref_id`非送信。
- API: list / create / update のpersonal・organization URL、canonical schema、wrong Entity / state / requested field response拒否、空update拒否。
- query key: session / workspace / Entity ごとの state cache分離。
- component: empty / load error / retry、作成・更新、Scene未指定・同一work Scene選択、別work chain拒否、dirty保存・破棄・取消、保存前remote conflict、single-flight、POST失敗時非再送、scope遅延応答非反映、無関係なScene queryを変更しないこと。
- Characters: child state dirty / operationを作品・Entity・tab遷移へ統合し、参照画像操作と相互にblockする。

対象 RED を確認後に実装する。最終的に Mobile targeted / full test、typecheck、lint、contract drift、API inventory、Expo dependency check、expo-doctor、Android / iOS export、Backend Vitest / Bun / build、fresh PostgreSQL migrations / invariant / integration、Web lint / build、Playwright smoke、protected path diffを確認する。

## Terra 委譲

Terra は現行 Entity state Route / Service / Repository / schema、Mobile API / query / Characters、Scene・costume reference・競合・tenancy境界をread-only監査した。P0なし、Backend変更不要と判定し、version不在、POST非冪等、Scene同一work、`costume_ref_id`非FK、Scene cache invalidationをP1設計条件として提示した。設計、実装、統合判断、最終レビューはSolが担当する。
