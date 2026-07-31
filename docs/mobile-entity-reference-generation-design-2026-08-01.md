# Mobile Entity reference generation slice 設計

## 目的と範囲

保存済みEntityの現在の保存内容から全身参照画像を生成し、既存の生成jobを正確に監視し、返された候補を認証付きで表示する。ユーザーが候補とprimaryを明示して確定した場合だけ、既存reference setへ追加する。

端末画像のimport候補が残っている場合は、その候補を明示的なsourceとして生成できる。sourceを指定しない生成では、過去の生成画像や確定済み画像を暗黙のsourceにしない。

このsliceはMobile UI / API client / job監視 / candidate preview / confirmだけを扱う。Backend、DB、migration、Worker、Web、shared API contract、credit / refund、job state、direct upload、参照画像削除、Entity削除、生成cancelは変更しない。

## Spec根拠

- `docs/Lyra_Unified_Spec_v4.md` sections 2–8, 10
- Entity generationは`generation_jobs`の`entity_generate`として実行し、active uniqueness、queue、recovery、credit refundを既存Backendへ委ねる。
- generation / regenerationは現在保存済みinputから新規生成し、過去の生成画像を暗黙のsourceにしない。
- confirmed referenceだけがPage生成時の明示的なcharacter consistency inputである。
- protected APIはpersonal ownershipまたはactive organization membershipでscopeする。
- candidate token、raw S3 key、provider errorを永続化または表示しない。

## 影響レイヤー

- Mobile: Characters UI、Entity reference components、API client、job polling / recovery、candidate selection、i18n、tests
- 変更しない: Backend Route / Service / Repository、DB / migration、Worker、Web、canonical contract、SQS message、credit ledger

## 既存Backend契約

1. `POST /api/entities/:id/generate-reference`
   - `generate`権限。
   - bodyなし、または`{ source_candidate_token }`。
   - 既存Backendがsource tokenをuser / Entityへ束縛して検証する。
   - 1 creditをtransactionalに消費し、enqueue失敗・failed jobのrefundを既存処理が担当する。
   - responseは既存`entityReferenceGenerationResponseSchema`の`{ job_id }`。
2. `GET /api/jobs/:id`、`GET /api/jobs?limit=100`
   - `view_work`権限。
   - `job_type === entity_generate`かつ`params.entity_id === 選択中Entity`をMobileでも照合する。
   - completed resultのcandidateはraw S3 keyではなく、既存routeが発行する`candidate_token`だけを使う。
3. `GET /api/entities/:id/reference-candidate-image`
   - candidate tokenをBearer認証付きでpreviewする。
4. `POST /api/entities/:id/reference/confirm`
   - 1〜3候補、primaryはselected内、prompt supplementは既存上限内。
   - 既存reference imagesを残し、選択候補を追加する。

## 保存内容とsource候補

- 生成開始前にCharactersのdirty draftを既存保存フローで解決し、保存失敗時は生成POSTを送らない。
- sourceなし生成は保存済みEntityの`prompt_supplement`をconfirm時に再利用する。
- import候補をsourceにする場合、解析済み`prompt_supplement`だけを既存Entity PUTでchanged-field-only保存してからenqueueする。`suggested_fields`やMobile非表示fieldは上書きしない。
- source token、generated candidate token、jobに対応するconfirm用prompt supplementはcomponent memoryだけに置き、session / workspace / Entity切替、confirm成功、明示破棄、logoutで破棄する。

## job開始、復元、poll

```text
保存済みEntity
  -> dirty draft保存
  -> job履歴を再取得して同Entityのactive jobを確認
  -> activeあり: そのexact job IDへ接続
  -> activeなし: generate POSTを1回だけ送信
  -> GET exact jobでid / type / entityを照合
  -> foreground中だけsingle-flight poll
  -> completed: 1〜3 candidate tokenをcomponent memoryへ採用
  -> failed / cancelled: terminal文言、job監視停止
  -> preview成功 + 明示選択 + primary指定
  -> reference fingerprint再確認
  -> explicit confirm
```

- job historyはcandidate tokenをReact Query cacheへ残さない直接API readで取得し、organization scopeを付けたうえで同Entityの`queued` / `processing`だけを復元する。terminal到達時は既存のjob一覧queryだけをinvalidateする。
- generate POSTの応答が失われた場合は自動再送しない。履歴を再取得し、同Entityのactive jobまたは開始時刻以後の一意な新規jobを復元できた場合だけexact jobへ接続する。履歴自体を確認できなければ生成ボタンをロックし、手動照合が成功するまで新しいPOSTを送らない。
- source付きPOSTの応答が失われた場合、復元jobがそのsourceを使ったことは証明できないため、import候補を自動破棄しない。明示的な202 responseを受信した場合だけsource候補を消費済みとして画面から除く。
- exact job応答が404、別ID、別job type、別Entityならfail closedにして候補を採用せず、新しい生成も開始可能にしない。
- pollはforeground時だけ、同じrequestを重ねず、terminal到達またはscope切替で停止する。
- terminal candidate tokenは自動永続化しない。期限切れpreviewはexact job再取得で新しいtokenを受け取り、選択とpreview-loaded状態を安全に作り直す。

## candidate選択とconfirm

- completed jobが返した1〜3候補を初期選択し、先頭をprimaryにするが、confirm自体はユーザーの明示操作を必須にする。
- preview成功していない選択候補はconfirmできない。
- primaryは必ずselectedへ含め、重複tokenを送らない。
- confirm直前にreference setを再取得し、生成開始後にremote変更があれば送信せず最新状態を表示して再確認させる。
- confirm response lossは自動再送しない。reference setを再取得して候補をambiguousにし、重複確定を防ぐ。

## セキュリティと可用性

- candidate token、Authorization、raw data URL、raw S3 key、signed URLをReact Query key、image cache identity、AsyncStorage、ログへ含めない。
- candidate preview identityはsession / workspace / Entity / job ID / candidate index / local revisionだけで作る。
- user向けには安定したqueue / processing / completed / failed / cancelled / status error / insufficient credit文言だけを表示する。
- 402 / 409 / 429とnetwork / timeout / response-lossを区別し、client errorを自動retryしない。
- generation中はEntity / workspace / tab移動、保存、import / confirmの競合操作を止める。旧scopeの遅延完了は新scopeのoperation stateや候補を変更しない。

## TDDと検証

先に次の失敗テストを追加する。

1. API client: sourceなし / sourceありbody、organization query、strict 202 response、exact job ID照合、prompt supplement changed-field-only更新。
2. job state: active history復元、response-loss復元、別Entity / type拒否、poll single-flight、foreground復帰、terminal停止、404 / 一時通信失敗。
3. candidate: token非cache-key、1〜3候補、preview前confirm禁止、selection / primary、token refresh、remote reference変更、confirm成功、ambiguous response非再送。
4. Characters: dirty保存成功後だけ生成、保存失敗時非送信、source promptだけ保存、操作中のEntity / workspace / tab移動block、旧scope遅延完了の隔離。

対象Mobile test / typecheck / lint / contract drift / dependency check / expo-doctor / Android・iOS exportを通す。PR-ready前にBackend Vitest / Bun、fresh PostgreSQL migrations / invariants / integration、Backend build、Web lint / build、Playwright smokeを再実行する。

## Terra委譲

Terraは`origin/main be5ea40`を基準に、Entity削除、direct upload、Entity reference generationの既存契約と危険箇所をread-only比較した。direct uploadは本番IAM / CORS / lifecycle readback前、Entity削除はJSON / array参照とS3確定処理を含む直列化設計前のため、このsliceでは変更しない。設計、TDD、実装、統合判断はSolが担当する。
