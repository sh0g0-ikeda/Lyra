# Mobile既存コマ内容編集 設計ブリーフ

## 目的と範囲

MobileのPage画面で、選択済みの既存Pageに属する既存Panelを一覧・選択し、保存済みのコマ内容を編集できるようにする。

このsliceで扱う項目は、Panel role / size、状況、既存compositionの編集可能な記述項目、コマ内会話、効果音、背景、メモである。保存は既存の`GET /api/pages/:id/panels`と`PUT /api/panels/:id`だけを使う。

次はこのsliceへ含めない。

- Panelの作成、削除、並べ替え
- Panel entity assignmentの追加・削除・変更
- Page frame、layout、balloonの変更
- Page設定、画像生成、再生成、確認、export
- Backend、DB migration、Worker、Web、shared API contractの変更

## Spec根拠

- `docs/Lyra_Unified_Spec_v4.md` 2: Page planとPanelのeditable fieldを確認してから画像生成する。
- 同 4 / 5: personal ownershipまたはactive organization membershipでscopeする。
- 同 6: 生成は保存済みの現在入力を使い、生成job・recovery・creditの状態遷移を崩さない。
- 同 8: bounded input、validated response、raw provider error非表示を維持する。
- 同 10: Mobile対象検証に加え、統合前にrelease verification gateを通す。
- `docs/Lyra_StoryAI_SubSpec.md` 5 / 6: situation、composition、dialogue、background等を個別編集可能なfieldとして維持し、speaker mismatchを保存前に拒否する。

## 影響レイヤー

- Mobile API client: 既存2 endpointのvalidated wrapperのみ追加する。
- Mobile domain: 保存済みPanelからdraftを作り、文字数・speaker・変更項目だけを検証する純粋ロジックを追加する。
- Mobile UI: Page / Panel選択、dirty解決、single-flight保存、安定したerror表示を追加する。
- Backend / Repository / Domain / Infrastructure / Worker / Web / DB: 変更しない。

## インターフェースとデータフロー

1. 選択中のsession、personal / organization scope、Page IDを含むReact Query keyでPanel一覧を取得する。
2. Responseは既存`panelsResponseSchema`で検証し、全Panelの`page_id`が要求Page IDと一致しない場合はfail closedする。
3. 保存時はtrim・nullable化と上限検証を行い、保存済み値から変わったfieldだけをsnake_caseの既存request bodyへ入れる。
4. `order`、`entities`、frame、page status、生成情報はrequestへ入れない。
5. speaker必須のdialogueは現在のPanel assignmentに存在するEntity IDだけを許可する。narration / sfxはspeakerを`null`へ正規化する。
6. 成功responseは`panelSchema`で検証し、要求Panel IDと現在Page IDが一致した場合だけcacheとsaved draftを更新する。
7. 422 / 409 / network failureではdraftを保持する。raw server / provider detailは表示しない。

## 競合・dirty・生成中の扱い

- Page / Panel / work / chapter / episode / tab切替とStory自動入力開始の前に、保存・破棄・取消を解決する。
- 取消または保存失敗では選択変更や生成を開始しない。
- 保存mutationはsingle-flightとし、連打で重複PUTしない。
- Page statusが`confirmed`または`generating`、もしくはepisode planning jobがactiveの間は編集・保存しない。
- job完了後はPanel query prefixを再取得する。dirty draftが残る場合は自動で上書きしない。
- dirty draftの編集中に再取得したPanelの`updated_at`が変化、またはPanelが消失した場合はstale PUTを拒否する。draftは保持し、破棄・再選択で最新保存値へ戻せるようにする。
- dirty draftの元Pageが再取得後に消失した場合、「保存」を成功扱いにしない。PUTせずdraftと遷移を保持し、明示的な破棄だけを許可する。
- optimistic updateは行わず、Backend成功responseを受け取った後だけcacheを更新する。

## セキュリティ

- organization IDは既存のactive membership選択から渡し、personal / organization cacheを分離する。
- Mobileは権限を信用せず、Backendの`view_work` / `edit_work`認可を最終判断とする。
- Responseの別Page / 別Panel混入を拒否する。
- 文字列上限、dialogue最大20件、speaker条件を送信前に検証する。
- error本文、stack、provider detail、認証tokenをUIやログへ出さない。

## TDDと検証方針

先に次の失敗テストを追加する。

- domain: changed-field-only、nullable化、各文字数境界、20件上限、speaker mismatch、narration / sfxのspeaker除去。
- API: organization scope、response schema、別Page / 別Panel拒否、空payload拒否。
- query key: session / workspace / Pageの分離。
- UI: 正常保存、失敗時draft保持、retry、single-flight、dirtyの保存・破棄・取消、remote更新との競合拒否、read-only status、実errorとemptyの区別。
- Pages統合: dirty Panelを解決できない場合にStory自動入力・上位選択・tab離脱を止める。

対象テスト成功後、Mobile typecheck / lint / full Vitest / contract drift / Expo check・doctor / Android・iOS exportを実行する。Backend等は無変更だが統合前にはUnified Spec 10の全gate、fresh PostgreSQL migration / invariant、実DB integrationを再確認する。

## Terra委譲

Terraはread-onlyでPR #67と現行mainを比較し、このsliceが既存endpointだけで閉じること、Backendの隠れた不足がないことを監査した。実装と統合判断はSolが担当する。PR #67のPage画面はframe、assignment、generation等を同時に含むためcherry-pickせず、現行mainの小さな境界へ再実装する。
