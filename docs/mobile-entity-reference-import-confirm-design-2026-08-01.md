# Mobile Entity reference import / confirm slice 設計

## 目的と範囲

保存済み Entity に端末の画像を1枚取り込み、AI解析後の一時候補を認証付きでプレビューし、ユーザーが明示確認した場合だけ確定済み reference set へ追加して primary にする。

この slice は `import / candidate preview / confirm` だけを扱う。新規 Entity の保存前取り込み、複数画像の同時選択、参照画像生成、確定画像削除、suggested fields の自動上書き、服装・状態、Page生成、Backend / DB / Worker / Web変更は含めない。

## Spec根拠

- `docs/Lyra_Unified_Spec_v4.md` sections 3–8
- protected API は認証と personal ownership / active organization membership で scope する。
- uploadはMIMEとsizeを制限し、LLM出力は既存schema validation後だけ利用する。
- production image delivery はauthenticated exportまたは短命URLを使い、S3 keyをclientへ公開しない。

## 影響レイヤー

- Mobile: Characters UI、画像picker adapter、API client、candidate画像表示、i18n、tests
- dependency: Expo SDK 57と互換な`expo-image-picker`
- 変更しない: Backend Route / Service / Repository、DB / migration、Worker、Web、shared API contract、generation job

## 既存Backend契約

1. `POST /api/entities/import-image`
   - `generate`権限。
   - 保存済みEntityの`entity_id`、既存`entity_type`、PNG / JPEG / WebP data URLを送る。
   - 実画像は5 MiB以下、JSON bodyは8 MiB以下。
   - 画像解析に1 creditを消費し、既存Backendが解析・保存失敗時のrefundを担当する。
   - responseは既存`entityImportResponseSchema`で検証し、`tmp_image_token`だけを候補識別に使う。
2. `GET /api/entities/:id/reference-candidate-image`
   - `view_work`権限。user / Entityに束縛された24時間tokenでbinary画像を返す。
3. `POST /api/entities/:id/reference/confirm`
   - `edit_work`権限。候補tokenをselectedとprimaryに指定し、解析済み`prompt_supplement`を保存する。
   - 既存画像を残して新しい画像を追加し、新しい画像をprimaryにする。
   - confirm自体は追加creditとgeneration jobを作らない。

`POST /api/uploads/entity-reference/presign`は実装済みでも`ENTITY_REFERENCE_DIRECT_UPLOAD_ENABLED=false`が既定で、本番IAM / CORS / lifecycle readbackが未完了である。このsliceでは利用せず、flagも変更しない。

## Mobileのデータ境界

- system image pickerから画像1枚だけを選択し、base64とEXIFを永続化しない。
- Expo SDK 57のImagePickerは`base64: true`時に選択画像のJPEG dataを返す契約である。実機差でもBackendの既存受理範囲を狭めないよう、JPEG / PNG / WebPの実signatureからMIMEを決め、decode後が1 byte以上5 MiB以下の場合だけrequest中のローカル変数として保持する。asset filenameや自己申告MIMEは信用しない。
- 根拠: <https://docs.expo.dev/versions/v57.0.0/sdk/imagepicker/#imagepickerasset>
- data URL、candidate token、Authorization、S3 keyをReact Query key、image cache key、AsyncStorage、ログへ含めない。
- candidate image URLにはtokenが必要だが、custom memory cache identityはsession / workspace / Entity / component内revisionだけで作る。
- candidate、prompt supplement、開始時reference fingerprintはcomponent memoryだけに置き、session / workspace / Entity切替、confirm成功、明示破棄、logoutで破棄する。
- `suggested_fields`はMobileの非表示fieldを暗黙上書きせず、このsliceでは保存しない。解析済み`prompt_supplement`だけを確認前に表示し、confirm成功時に既存Backendへ渡す。

## 状態遷移と競合

```text
保存済みEntity + reference set取得成功
  -> pick / byte validation
  -> importing (single-flight、1 creditを事前表示)
  -> candidateReady(token + prompt supplement + reference fingerprint)
  -> previewLoaded
  -> explicit confirm
  -> reference set再取得・fingerprint照合
  -> confirming (single-flight)
  -> response schema / entity照合
  -> query cache採用・再取得・candidate破棄
```

- 新規draftはEntity IDがなくtokenを正しいEntityへ束縛できないため、保存前importを表示しない。
- import / confirm中はEntity・workspace・tab移動、Entity保存、重複操作を止める。開始scope / operation epochと完了時scopeが違う結果は採用しない。
- reference setが未取得または取得失敗中はimportしない。開始後にreference fingerprintが変わった場合、1回目のconfirmは送信せず最新状態を表示し、ユーザーに再確認させる。
- Backendの3枚制限は1回のconfirmで選択できる候補数であり、確定済み画像の総数制限ではない。このsliceは1回につき候補1枚だけを送信し、Mobile独自の総数上限を追加しない。
- candidate previewが正常に表示されるまでconfirmを許可しない。

## 応答消失時の安全方針

importとconfirmにはidempotency keyやcandidate status lookupがない。

- import responseが失われた場合、二重解析・二重creditを避けるため自動retryしない。安定した警告を表示し、再実行はユーザーの新しい明示操作だけにする。
- confirm responseが失われた場合、自動retryしない。reference setを再取得するが、成功を断定できないため候補をambiguous状態にしてconfirmを無効化する。ユーザーは最新確定画像を確認し、候補を明示破棄してから必要なら再取り込みする。

このP1制約を完全に解消するには別Backend契約としてidempotency keyとcandidate session / status lookupが必要であり、このMobile-only sliceへ混ぜない。

## セキュリティと可用性

- picker cancellationはerrorにしない。
- 不正base64、空画像、5 MiB超をAPI送信前に拒否する。
- API responseは生成済みstrict schemaで検証し、reference setの`entity_id`不一致をfail closedにする。
- candidate binaryはBearer header付き、memory cache限定で取得し、401時の認証更新と再試行を各1回に制限する。
- 413 / 422 / 429、network / timeout、ambiguous resultを区別した安定文言にする。raw provider errorは表示しない。

## TDDと検証

先に次の失敗テストを追加する。

1. picker adapter: cancel、JPEG data、空・不正base64、5 MiB境界、5 MiB超、base64非永続。
2. API client: personal / organization URL、strict response、Entity不一致、60秒import timeout、confirm payload、401 refresh、失敗応答。
3. candidate source: token URL encode、Authorization、scope分離、token非cache-key。
4. UI flow: 保存前非表示、reference load失敗、既存3枚以上でも総数制限を追加しないこと、費用表示、single-flight、preview成功前confirm禁止、remote変更再確認、confirm成功cache反映、ambiguous response非再送、scope切替のstale result破棄。
5. navigation: import / confirm中のEntity・workspace・tab移動と保存を止める。

対象Mobile test / typecheck / lint / dependency check / expo-doctor / Android・iOS export後、PR-ready時はBackend Vitest / Bun、fresh PostgreSQL migration / invariant / integration、Backend build、Web lint / build、Playwright smokeを再実行する。

## Terra委譲

Terraは`origin/main a2f53be`を基準にread-only監査し、既存endpoint、token、credit、direct upload flag、candidate preview、confirm、Web参考実装、Mobile境界を確認した。設計・TDD・実装・統合判断はSolが担当する。
