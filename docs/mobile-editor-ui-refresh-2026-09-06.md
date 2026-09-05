# Mobile 編集画面 UI 更新設計（2026-09-06）

## 1. 目的と範囲

Story、Characters、Pages のモバイル編集画面を、説明文を読まなくても選択と編集の対象が分かる構成へ整理する。特に Pages では、一覧から選択したページとコマだけを編集し、選択中コマの直後へコマを1つ追加できるようにする。

変更範囲は `apps/mobile` の表示、端末内 draft state、既存 API の呼び出し順に限定する。Route / Service / Repository / Domain / Infrastructure / Worker / Web / migration / production configuration は変更しない。既存データの別名、シーンのキャラクター関連、キャラクター詳細、セリフ、構図、生成ジョブ情報は、表示を減らしても削除・初期化しない。

対象ブランチは `feature/mobile-editor-ui-refresh`、基準 SHA は `a0b612d`。開始時に worktree が dirty だったため、main の checkout / pull は行わず、安全な現在 HEAD から作成済みのブランチを継続する。

### 1.1 公開済み Mobile 1.0.2 との差分を先に統合する

調査時点の EAS では、最新の完了済み store build は iOS 1.0.2 (34) と Android 1.0.2 (92) で、どちらも `519c82d` から作られている。一方、今回の基準 `a0b612d` は Mobile metadata が 1.0.1 で、両 branch の merge base は `9e9b0d4` である。したがって、`a0b612d` だけを編集して 1.0.3 を作ると、1.0.2 で公開済みの日英切替、制作導線、Expo SDK 57 patch を退行させる。

実装の最初に、1.0.2 の Mobile 差分を現在の 24ページ制限・StoryAI・ページ生成契約へ移植する。ただし branch 全体を `519c82d` の snapshot へ戻す方式は採用しない。

- `6caa5bb` には今回と重なる copy 改善がある。`6caa5bb^..6caa5bb` の正確な commit patch には `MAX_ESTIMATED_PAGES` と `apply_story_plan` の変更は含まれない。24 から 32、および `false` から `true` の差は、分岐後に現行側へ追加された変更を含む `a0b612d..519c82d` の branch snapshot 差分であり、`6caa5bb` 自体への帰属ではない。
- `d423af2` は version 1.0.2 とその release note であり、今回の 1.0.3 metadata としてそのまま使えない。
- `519c82d` の dependency patch は必要だが、lockfile を現行 branch へ適用した後に `expo install --check` と全検証で再確認する必要がある。

統合方針は次のとおりとする。

1. `d213f4a` と `18f49e6` の共通言語切替・永続接続を current code に再適用し、1.0.2 の公開済み動作を保つ。
2. `6caa5bb^..6caa5bb` の正確な patch を、tests の RED 確認後に適用する。適用時の競合は current `a0b612d` を土台として解消し、24ページ上限、skeleton と autofill の分離、最新 blocker を維持する。branch snapshot 同士の diff を commit patch として使わない。
3. `519c82d` の Expo SDK 57 patch versions を package と lockfile に統合する。
4. metadata は 1.0.2 を経由した次版 1.0.3 とし、iOS build number と Android versionCode は remote current より大きい値を EAS auto increment で確定する。
5. その統合を GREEN にした基準から、本設計の UI 簡略化と insert-after を TDD で実装する。

既存 1.0.2 の次工程 `Notice` は操作状態を伝える案内として保持してよいが、今回指定された「導入文なし」と競合する定常 paragraph、集計、重複説明は削除する。最終 copy contract は本設計を優先する。

開始時から存在する変更は次のとおりで、今回の実装・コミットへ混ぜない。

- `docs/cloud-cost-cuts-2-3-7-2026-06-22.md`
- `docs/cloud-current-state-2026-06-21.md`
- `scripts/createDockerLearningDocx.py`
- `HANDOFF.md`（untracked）
- `app.json`（root、untracked）
- `docs/mockups/lyra-launcher-icon-v2-concept.png`（untracked）
- `docs/mockups/mobile-page-editor-ui-refresh-2026-08-15.png`（untracked）
- `store-assets/google-play/`（untracked）

この設計メモはコード変更前に残す。今回は設計文書のみの変更なので RED テストは作らない。実装開始時に後述の契約テストを先に追加し、期待した理由で失敗することを確認する。

## 2. Spec 根拠と影響レイヤー

- `docs/Lyra_Unified_Spec_v4.md` 2章: ストーリー、キャラクター、ページ計画、コマ、セリフ、生成画像を順に編集する主要フロー。
- 同 3章: 今回の責任は Mobile app 層に置き、バックエンドの層境界を変えない。
- 同 4・5章: 認証済みユーザーと personal / active organization の既存 scope をすべての API 呼び出しで維持する。
- 同 6章: ページ生成は現在保存済みの入力を使う。生成前保存、active job の単一実行、failed / cancelled 後の再試行を維持する。
- 同 7章: ページ生成のクレジット処理を変更せず、既存 readiness と確認画面を通す。
- 同 8章: bounded payload、画像 upload 制限、安全なエラー表示を既存 API client 経由で維持する。
- 同 10章: Mobile の対象テストから開始し、配布前に repository 全体の release gate と実機確認を行う。
- `docs/mobile_frontend_design.md` 3.1、7、8、10、13、16: Mobile は既存 API と保存データを再利用し、選択 state と server state を分離し、生成前に dirty draft を解決する。

影響レイヤーは Mobile の screen / component / i18n / theme / UI contract test のみ。API request / response schema と永続化形式には変更がない。

## 3. 共通表示契約

画面最上部のタイトルは `1 ストーリー` / `1 Story`、`2 キャラクター` / `2 Characters`、`3 ページ` / `3 Pages` とし、画面タイトル直下の導入文は表示しない。Section title は黄色の既存 primary token を使い、カード境界と入力欄境界は現状より明るい token に統一する。色だけに依存せず、border、面の明度差、選択アイコン、`accessibilityState.selected` を併用する。

日本語と英語は同じ情報構造にする。英語文言は次の対応を基準とする。

| 日本語 | 英語 |
|---|---|
| まずはストーリーを入力 | Start by entering your story |
| AIでストーリーを改善 | Improve your story with AI |
| 背景や時間帯の設定 | Background and time settings |
| キャラ一覧 | Character list |
| キャラ新規作成 | Create a character |
| ページ一覧 | Page list |
| 画風の参考 | Art style reference |
| 流れの概要 | Story flow overview |
| 背景や時間帯の設定をページに反映 | Apply background and time settings to the page |
| コマの設定 | Panel settings |
| 自由入力欄 | Additional details |
| 作成したキャラの画像生成 | Generate the character image |
| ページ生成 | Generate page |
| ページ確定 | Confirm page |

既存の progress、error、disabled reason、retry、cancel、read-only role、validation notice は操作に必要な状態なので残す。「説明文をなくす」は定常時の補足 prose を対象とし、処理中・失敗・安全確認の情報を隠す意味ではない。

## 4. Story 画面

Section は次の3つとする。

1. `まずはストーリーを入力` / `Start by entering your story`
2. `AIでストーリーを改善` / `Improve your story with AI`
3. `背景や時間帯の設定` / `Background and time settings`

画面導入文と `ストーリー本文は全体入力だけを使います` を削除する。AI 改善の subtitle は `あなたの指示に従ってストーリーを改善したり、話を広げたりします！` / `Improve or expand your story by following your instructions!` とする。シーン編集から `関係するキャラクター` の chips、追加読込 UI を隠すが、取得済み・保存済み `entity_ids` は保持し、location / time / atmosphere の保存で空配列へ上書きしない。新規シーンでは従来の既定値を使う。

StoryAI の入力、結果適用、Story collaboration、episode 保存、dirty-state 登録、stale revision 回復は現行ロジックを維持する。見出し変更や説明削除によって保存・改善 API の順序を変えない。

## 5. Characters 画面

### 5.1 一覧と新規作成

Section title は `キャラ一覧` / `Character list` と `キャラ新規作成` / `Create a character` にする。`新しいキャラを作成中です。既存キャラは上書きしません` を削除し、`わかっている項目だけ入力し、生成前に保存してください` は `すべての項目を埋める必要はありません` / `You do not need to fill in every field.` に置き換える。

画像取り込みの冒頭文は `アップロードした画像のキャラクターを漫画に登場させられます！` / `You can feature the character from an uploaded image in your manga!` にする。その下の2つの定常説明文は削除する。upload の MIME / size validation、進行状況、失敗、再試行、分析結果の確認は残す。

別名・ニックネーム入力は UI から外す。選択した既存キャラの alias は hydrate したまま payload に保持し、別項目の保存で `null` や空文字へ変えない。

### 5.2 詳細入力

既存の独立した `自由入力と保存` ブロックを character creation 内へ移し、title を `自由入力欄` / `Additional details`、helper を `選択肢にない特徴などを記入出来ます` / `Add traits or details that are not available in the choices.` とする。`選択肢にない特徴や、特別に守りたい条件を書いてください` は削除する。保存ボタンと dirty-state は統合後も一つだけとし、表示の移動で保存 payload を分割しない。

`物体・人外の特徴` / `Object or non-human traits` は選択リストを持たず自由入力だけにする。既存の保存値は自由入力へ hydrate し、未変更の項目を落とさない。

### 5.3 画像生成と確定

`作成したキャラのプレビュー` は `作成したキャラの画像生成` / `Generate the character image` に変え、subtitle は `プレビュー画像を作り、気に入ったら「確定」してください` / `Generate a preview image, then select “Confirm” when you are happy with it.` とする。

`取り込んだ画像、生成したプレビュー、確定済み参照画像がここに並びます`、`候補画像を保存` ボタン、確定操作の下にある `現在の…` 説明を削除する。候補画像の取得・選択・確定 API と、生成 job の progress / error / retry は残す。候補保存ボタンにしか到達不能な永続化がある場合は削除前に処理を確定フローへ統合し、API 呼び出し自体を黙って失わない。

## 6. Pages 画面

### 6.1 ページ設計と一覧

ページ設計 component 内の番号付き `1～`、`2～` の操作説明は残す。autofill の説明へ `ページ数しだいで完了まで20分程度かかる場合があります` / `Depending on the number of pages, completion may take up to about 20 minutes.` を加える。それ以外の定常 prose は削除するが、overwrite 確認、所要時間を含む確認 dialog、active job、cancel、failure、retry は残す。

Section title は `ページ一覧`、`画風の参考`、`流れの概要`、`背景や時間帯の設定をページに反映`、`コマの設定` と対応英語へ変更する。ページ一覧 subtitle は `タップで選択したページを編集` / `Tap a page to select and edit it.` とする。

### 6.2 選択式編集

ページ一覧は水平 thumbnail picker を維持する。コマ一覧も一行を低くし、番号・役割・選択状態だけを表示して situation description を省く。コマ Section subtitle は `コマを選択して編集してください` / `Select a panel to edit.` とする。

キャラクター割当は、全員分の高い詳細フォームを同時表示せず、割当キャラ一覧から1人を選び、その1人分の role / position / direction / expression / pose / effect / continuity を編集する。選択切替だけでは dirty にしない。未保存値はキャラごとの local draft に保持し、保存時に全 assignments を既存 `replacePanelAssignments` payload へまとめる。

セリフも行一覧から1行を選び、その1行だけ speaker / text / type / position を編集する。`Mobile版ではセリフは画像内に含めます` を含む重複説明領域は削除する。行の追加・削除・並び替えと `dialogue_in_panel`、既存 dialogue payload は保持する。選択切替で入力を失わず、空行の扱いは現行 `panelPayload` の trim/filter 契約を維持する。

### 6.3 選択中コマの直後へ1コマ追加

既存 production backend の API 契約だけを使う。クライアント処理は次の順序にする。

1. page / panel / frame に未保存変更があれば、既存 `saveAllPageDrafts` と同じ validation・保存順で解決する。無効な draft があれば追加しない。
2. 最新 panels を order 順に確定し、選択中 panel ID が現在一覧に存在することを確認する。未選択または stale の場合は安全な案内を表示する。
3. `POST /api/pages/:id/panels` で、新規 panel を一旦 `order = current panel count + 1` として作る。payload は空の action / standard / `ai_auto` panel とし、選択中 panel の本文、キャラ、セリフ、構図を複製しない。
4. 作成成功後、new panel ID を選択中 panel ID の直後へ挿入した全 panel ID 配列を作り、`PUT /api/pages/:id/panels/order` を呼ぶ。
5. 選択中 panel に結び付く四角形 frame を、外接幅と高さの長い軸で二分する。元 frame ID と全体領域を保持し、片側を元 panel、もう片側を new panel に割り当てる。他 frame は形状と ID を保持し、reading order を1つ後ろへずらす。
6. 既存 `PUT /api/pages/:id/frames` へ全 frame を送り、panel と frame を再び1対1にする。
7. 成功後に panels/pages/frames を invalidate し、新規 panel を選択してその1件の editor を表示する。

作成時に直接 `selected.order + 1` を送らない。現行 repository は既存 order を先にずらさずその値を insert するため、重複 order または不安定な中間状態を生み得る。末尾作成後の既存 reorder API は、personal / organization scope、編集権限、全 panel ID の一致をサーバーで検証するため、現行 AWS backend と互換である。

POST 成功後に reorder または frame 保存が失敗した場合、新規 panel は残り得る。自動 delete で取り消さず、作成済み panel ID・元の選択 panel ID・予約済み frame ID を保持し、「追加を完了する」操作で create を繰り返さず reorder / frame 保存だけを再開する。画面を開き直した場合も、ちょうど1 panel だけ frame が不足し、その他が有効な1対1対応である場合に限って修復操作を出す。この場合は現在順の直前 panel を二分し、順番を推測して他の custom frame を触らない。復旧用の分割結果も reorder より前に検証する。二重タップは同期 ref と mutation pending の両方で防ぎ、処理中は閉じられない native Modal でページ切替・編集・生成を止める。完了時の選択更新は開始時の page ID と現在の page ID が一致する場合だけ行う。confirmed / generating page、read-only role、stale selection、payload invalid、20 panel 上限、既存 panel/frame が1対1でない場合は disabled reason を表示する。

現行 `PanelService.reconcileFramesAfterReorder` は、frame 数と panel 数が等しく、全 frame が panel ID に紐づいている場合だけ reading order を同期し、不足 frame を生成しない。また `pageLayoutEditingUiEnabled=false` のため、利用者が通常 UI から mismatch を直す経路もない。そこで Mobile が明示された「1コマ追加」操作の一部として選択枠だけを決定的に二分する。ページ全体のテンプレート再適用や、他の custom frame の再生成は行わない。frame 保存まで成功した場合は既存 generation invariant を満たし、新規の空コマを編集して生成へ進める。

### 6.4 削除、安全領域、生成操作

削除コマ操作を含む bottom sheet は `useSafeAreaInsets().bottom` を使い、action list の bottom padding を `spacing.sm + inset.bottom` 以上にする。Android の gesture navigation / 3-button navigation と iOS home indicator の上に、44pt 以上の削除タップ領域を置く。

ページ生成 component の定常説明は削除し、主ボタンを `ページ生成` / `Generate page`、確定ボタンを `ページ確定` / `Confirm page` とする。confirmed page の再編集操作、生成 progress、job ID に依存する cancel/retry、error、credit/readiness disabled reason、生成前の全 draft 保存は残す。

## 7. インターフェース、永続化、セキュリティ

- 入力: 既存の bounded FormField / option state、選択中 work / chapter / episode / entity / page / panel、safe-area inset。
- 出力: 既存 episode / scene / entity / panel / assignment / frames API payload。新しい backend field はない。
- 永続化: server state は PostgreSQL の既存契約、UI の現在選択・開閉は端末 state。非表示 field は hydrate した既存値を保存 payload に残す。
- 外部 API: 既存 authenticated API client のみ。OpenAI / AWS / storage を Mobile から直接呼ばない。
- ジョブ: 既存 generation job ID、active 判定、cancel、failed / cancelled retry、credit settlement を維持する。
- 認証・認可: Cognito token、personal ownership、active organization membership と capability query を維持する。ID を知っているだけのアクセスは追加しない。
- ファイル: 既存 direct upload の MIME / size / signed URL 契約を維持する。秘密情報や provider error を表示・ログへ追加しない。
- 競合: dirty revision、selection switch guard、stale resource recovery を通し、保存中に作られた新しい revision を消さない。

## 8. TDD と検証

実装前に対象契約テストを追加・更新し、現行実装で次が期待どおり失敗することを確認する。

1. 3画面の番号付き title、導入文なし、指定 Section title と日英 copy。
2. hidden alias / scene entity IDs / character fields が別項目保存 payload に保持される。
3. character creation 内の自由入力、物体・人外の自由入力だけの表示、候補保存 UI 削除後も確定導線が成立する。
4. page / panel / character assignment / dialogue picker が選択した1件だけを編集し、選択変更では dirty にならず、未保存 draft を失わない。
5. insert-after が POST を末尾 order で行い、その後に全 ID の reorder を選択直後順で送る。
6. insert-after の POST 失敗、reorder 失敗、stale selection、二重タップ、read-only、confirmed / generating、invalid draft の回復と disabled reason。
7. panel/frame count mismatch の間はページ生成できない。
8. コマ picker に description がなくコンパクトで、選択状態と44pt以上の操作領域を持つ。
9. bottom sheet の削除操作に zero / Android gesture / Android 3-button / iOS 相当 inset が加算される。
10. ページ生成・確定 button label と、progress / error / retry の存続。
11. brighter theme の contrast、Section title の色、focus / selected / disabled の非色覚依存表示。

対象テストを GREEN にした後、少なくとも次を実行する。

```text
npm --prefix apps/mobile test -- <target test files>
npm --prefix apps/mobile run typecheck
npm --prefix apps/mobile run lint
npm --prefix apps/mobile run contracts:check
npm --prefix apps/mobile run check:mojibake
npm --prefix apps/mobile test
npm --prefix apps/mobile run export:android
npm --prefix apps/mobile run export:ios
git diff --check
```

配布候補では Spec 10章に従い、root の Vitest / Bun entrypoints、migration・invariant、backend build、web lint/build、Playwright auth と authenticated-console smoke も通す。AWS の現行 backend route / response と mobile production API base URL は配布前に live contract として別途照合する。

実機 acceptance は iPhone 375×812 / 390×844、iPad、Android 360×800 の gesture / 3-button navigation で行い、文字切れ、キーボード時スクロール、選択の見分け、delete の安全領域、insert-after の順序、生成前保存を確認する。

検証・Sol review 完了後に Mobile 1.0.3 として、同一 reviewed commit から署名済み Android AAB と APK を作り、package、versionCode、SHA、署名、ABI、artifact hash を記録する。同じ reviewed commit の iOS build を App Store Connect へ upload し、bundle ID、build number、processing 状態を確認する。これらの外部操作は root 担当とし、Terra へ秘密情報・署名・production 操作を委譲しない。

## 9. 所有範囲と Terra task packets

Sol/root は設計、統合判断、`StoryScreen.tsx`、`PagesScreen.tsx` の insert-after と draft orchestration、全 i18n catalog、`theme.ts`、共有 Section、最終テスト調整、release 判定を所有する。文言 key と theme は複数画面を横断するため、競合を避けて一担当で統合する。

### Terra packet A: Character editor structure

- Objective: character creation へ自由入力・保存を統合し、alias UI と指定説明を隠し、物体・人外を自由入力だけにし、画像生成・確定導線を簡潔化する。
- Owned files: `apps/mobile/src/screens/CharactersScreen.tsx` と character 専用の新規/既存 test file。i18n catalog は編集せず、root が用意する key を使うか必要 key を報告する。
- Spec: Unified Spec 2、3、5、6、8章と本設計 5章。
- Constraints: 非表示の alias・詳細値を payload から落とさない。upload validation、job、candidate confirm、dirty/stale recovery を維持する。他 path、backend、secret、production を触らない。
- Expected output: changed paths、RED/GREEN の対象テスト、保持した payload fields、候補保存削除後の確定経路、リスク、最終 `git status --short`。

### Terra packet B: Compact panel/page leaf components

- Objective: page thumbnail helper、compact panel picker、single-selection assignment/dialogue editor、safe-area action sheet、page generation button 表示を本設計へ合わせる。
- Owned files: `apps/mobile/src/components/PageThumbnailPicker.tsx`、`PanelOrderList.tsx`、`PanelCharacterAssignmentCard.tsx`、`PanelDialogueEditor.tsx`、`PageGenerationActions.tsx` と各 component test。`PagesScreen.tsx`、i18n、theme は触らない。
- Spec: Unified Spec 2、3、6、8、10章と本設計 6章。
- Constraints: props の追加は型付きで最小限とし、既存 API payload を変えない。safe area、accessibility、draft preservation を test する。他 path、backend、secret、production を触らない。
- Expected output: changed paths、RED/GREEN test、必要な PagesScreen integration props、safe-area evidence、リスク、最終 `git status --short`。

### Terra packet C: Read-only final validation

- Objective: 統合後 diff を read-only で調べ、指定 copy、hidden-data preservation、insert-after の partial failure、generation safeguards、scope逸脱を確認する。
- Read-only scope: 今回変更した `apps/mobile` と test、当設計メモ。
- Spec: Unified Spec 2〜8、10章。
- Constraints: edit、production、secret、destructive Git を行わない。
- Expected output: severity 順 findings、test gaps、既存 dirty path が diff に混入していないこと、残余リスク。

Sol は各結果を Spec、設計、テスト、diff に照らして review し、広い refactor、担当外変更、hidden-data loss、生成安全策の後退を取り込まない。

## 10. 残存リスクと判断点

- production API task definition と repository HEAD の mobile-relevant route / schema は read-only 照合済みで、panel create / reorder / frame replace 契約は一致した。リリース直前にも readiness と task definition を再確認する。
- POST / reorder / frame replace は単一 transaction ではない。後段失敗時は作成済み panel を削除せず、再取得と冪等な明示修復でデータ損失と重複作成を避ける。原子的な insert endpoint は今回の Mobile-only scope 外。
- 枠の二分は四頂点が左上、右上、右下、左下の現行契約に従う。横分割は右から左の読順に合わせて元 panel を右、新規 panel を左に置き、縦分割は元 panel を上、新規 panel を下に置く。全 frame の座標、正の最小面積、線、z-index、reading order、ID、panel 対応と、分割後双方が API 制約内であることを POST 前に検証する。他の既存 frame は vertices、ID、border、z-index を保持し、reading order と選択枠の分割だけを変更する。対象 frame がない、既に panel/frame が不一致、20 panel 上限の場合も作成前に止める。
- 説明削除で操作不能にならないよう、validation、disabled reason、progress、error、retry、destructive confirmation は削除対象から除外する。
- centralized generated i18n catalog は key 変更時に mojibake・未使用・英訳漏れが起きやすい。専用 contract と catalog check を必須にする。

## 11. 配布候補のレビュー・検証結果

2026-09-06、Sol の最終レビューで指摘された復旧前検証、既存枠の重なり順保持、追加処理の二重実行・画面操作防止を修正し、再レビューで承認した。

- Mobile: 134 files / 661 tests passed。TypeScript、ESLint、API contract、双方向 API inventory、Web parity inventory、文字化けチェックを通過。
- Expo: SDK 推奨パッチへ整合し、dependency check と Expo Doctor 21/21 を通過。`.env` を無効にして `eas.json` production の環境変数から Android / iOS の Hermes bundle export を通過。
- Backend: Vitest 236 files / 1636 tests、Bun 26 tests、TypeScript build を通過。専用のローカル PostgreSQL DB に migration を適用し、50 deployment invariants を確認。AWS DB は操作していない。
- Web: lint、production build、Playwright 21 tests を通過。
- AWS: read-only で API task definition `lyra-prod-api:129`、2 desired / 2 running、`/readyz` 200 を確認。稼働 API image の commit `dda4fda` と現 HEAD の routes / migrations / API contract に差分なし。backend のデプロイは不要。
- 配布済み 1.0.2 の画面案内・言語切替・依存パッチを該当コミット単位で取り込み、現行の 24 ページ上限と `apply_story_plan: false` を保持した。
- Android 実機・emulator と Apple 実機は接続されていないため、実機でのタップ・スクロール・キーボード・safe-area の目視確認は未実施。署名付き成果物は実機確認にも利用する。
- EAS の既存 App Store Connect API key は Apple REST API から 401、保存済み Apple ログインも期限切れだった。認証を解決できるまで、ビルド作成と Apple 側での提出完了を区別して報告する。

署名付き成果物は既存の dirty path を含まない、この変更の reviewed commit から作成する。元作業ツリーの未コミット資料・スクリプト・ストア素材は保持する。
