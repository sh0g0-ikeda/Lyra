# Mobile Characters 基本編集 slice 設計（2026-08-01）

## 目的と範囲

PR-F の Characters を巨大な PR #67 からそのまま移植せず、現行 `main` の Mobile 基盤へ、作品ごとのキャラ一覧、新規作成、既存キャラの名前・自由説明の更新を追加する。未保存変更は作品・キャラ・タブを移動する前に保存・破棄・取消で解決し、失敗時は入力を保持する。

この slice では Backend、DB、migration、Worker、Web、credit、参照画像 import / preview / confirm、画像生成、服装・状態、キャラ削除、organization 切替 UI を変更しない。削除と参照画像は、それぞれの永続データ・storage・job 契約を安全化する後続 slice とする。

## Spec 根拠

- `docs/Lyra_Unified_Spec_v4.md` 2章: entity と確定参照画像は漫画制作の主要データである。
- 同3章: Mobile は既存 API 契約を利用し、Route / Service / Repository の責務境界を変えない。
- 同4章: personal ownership または active organization membership で必ず scope する。
- 同6章: entity generation の active uniqueness、recovery、refund を崩さない。
- 同7章: bounded request schema と structured output validation を維持する。

PR #67 は UI 要求と過去実装の参考に限る。現行契約に存在しない `expected_updated_at`、巨大な AppState、互換 fallback、参照画像・課金・release 機能は移植しない。

## 現行契約と危険境界

### 利用する API

- `GET /api/works/:work_id/entities?limit=50&cursor=...`
  - response は canonical `entitiesResponseSchema` で検証する。
  - `next_cursor` がある間は明示的に追加読込できる。
- `POST /api/works/:work_id/entities`
  - `entity_type`、trim 済み `name`、`free_description` だけを送る。
  - Backend が新規 entity の hidden fields を既定値へ設定する。
- `PUT /api/entities/:id`
  - 変更された `name` / `free_description` だけを送る。
  - `entity_type`、`structured_fields`、`prompt_supplement`、`speech_profile` は送らず、Backend の部分更新で既存値を保持する。

全 request は既存 API client の Bearer token、15秒 timeout、401時1回だけ refresh、raw response/error 非公開をそのまま使う。personal / organization は query key と `organization_id` query の両方で分離する。

### 既存種類の変更を公開しない理由

現行 `EntityService.updateEntity` は `entity_type` が変わると、未送信の `structured_fields` と `speech_profile` を新しい種類向けの空値へ初期化する。Mobile の基本編集画面が hidden fields を表示せずに種類変更を許すと既存データを失い得るため、新規作成時だけ人物・人外・物を選択でき、既存 entity の種類は読み取り専用とする。

### 削除を公開しない理由

- `balloons.speaker_entity_id` は `entities` を参照するが `ON DELETE` 方針がなく、使用中 entity の直接削除は外部キー違反になり得る。
- `reference_sets` は DB 上 cascade される一方、確定参照画像の storage object を durable に削除する処理は entity 削除に接続されていない。
- active entity generation、panel / dialogue / state 参照、生成候補、refund / recovery と削除の排他が明文化・検証されていない。

このため trash UI は Backend の削除 preview / blocker / durable cleanup / transaction 方針を設計・実装・実DB検証してから追加する。

## UI と状態遷移

1. `FoundationHomeScreen` の Story と Pages の間に `キャラ / Characters` tab を追加する。
2. 作品を選択すると、その作品に scope された entity を新しい順で取得する。0件は正常 empty state とし、error bannerを出さない。
3. キャラを選ぶと種類、名前、自由説明を表示する。既存種類は読み取り専用とする。
4. `下書きを戻す` と `新規キャラ` を同じ操作列に置く。新規作成時は種類を選べる。
5. `保存` または `作成` は local validation 後だけ API を1回呼ぶ。名前1〜100文字、説明0〜2,000文字を境界値まで検証する。
6. 作品・キャラ・タブ移動時に dirty なら保存・破棄・取消を提示する。
   - 保存成功: 遷移する。
   - 保存失敗: 入力を保持し、遷移しない。
   - 破棄: 最後に保存・取得した値へ戻して遷移する。
   - 取消: 現在位置と入力を維持する。
7. mutation と transition は各1本の single-flight とし、連打で重複 POST / PUT や競合遷移を起こさない。
8. create / update 成功時だけ一覧を再取得し、返却 entity を選択・保存済み状態にする。optimistic 永続化は行わない。
9. 404、422、network、5xx、契約外 success payload は保存成功として扱わない。入力と既存 cache を保持し、安定したユーザー文言だけを表示する。
10. 追加ページだけの取得失敗では表示済み一覧を隠さず、同じ cursor から再試行できる。

現行 PUT には version / `updated_at` 条件がないため、同じ表示項目を複数端末で同時編集した場合は最後の保存が勝つ。この slice は hidden fieldsを送らないことで影響を名前・自由説明へ限定する。共同編集向けの楽観ロックは Backend 契約を追加する別sliceで扱う。

## インターフェース

- 入力: work ID、entity ID、entity type、新規/保存済み draft、name、free description、organization ID。
- 出力: canonical `EntityRecord`、paginated entity list、保存成否、安定した UI message。
- 永続化: 既存 REST API のみ。新しい端末内永続化、DB column、migration は追加しない。
- 外部 API / job / credit: この slice では呼ばない。

## セキュリティ

- work / entity ID は URL encode し、organization scope を query へ付ける。
- list / create response の `work_id`、update response の `id` を client 側でも照合し、別 resource の success payload を採用しない。
- request 最大長は UI/domain と既存 bounded Zod schema の二重で守る。
- hidden fields を update payload に含めず、型変更も行わない。
- server/provider の body、stack、credential は表示しない。

## TDD と検証方針

先に次の失敗テストを追加する。

- domain: 新規/更新 payload、changed-field-only、null正規化、100/101文字、2,000/2,001文字。
- API: pagination / cursor / organization query、canonical response、cross-work / wrong-id response拒否、最小 POST / PUT payload。
- screen: 正常empty、pagination、作成、更新、hidden fields非送信、既存種類変更不可、dirty の保存/破棄/取消、保存失敗時draft保持、連打single-flight、query errorとの区別。
- home: Characters tabへの出入りで `prepareToLeave` を1回だけ呼ぶ。
- query key: session / personal / organization / workごとの entity cache 分離。

対象テストの RED を確認してから実装する。実装後は Mobile 全 test / typecheck / lint / Expo dependency check / doctor / Android・iOS export、contract drift / API inventory、Backend Vitest / Bun / build、Web lint / build、Playwright smoke、fresh PostgreSQL migrations / invariants /関連実DB testsを実行する。

## Terra 委譲

既存 Terra エージェントへ現行 API、hidden field保持、種類変更、削除、pagination / cache / dirty / single-flight の read-only 監査を委譲する。設計判断、実装、統合判断、最終レビューは Sol が行う。
