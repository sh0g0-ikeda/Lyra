# Mobile コマ設定ダイアログ設計（2026-09-06）

## 1. 目的と範囲

Pages のコマ選択と設定編集を、スマートフォンで対象を見失いにくい操作へ更新する。選択中のコマ行は背景を solid yellow にし、文字・アイコンは黄色上で十分なコントラストを持つ色へ切り替える。現在縦に展開する5つの設定群は、同じ入力内容をそれぞれポップアップで開いて編集する方式へ置き換える。

対象は `apps/mobile` の表示、選択状態、アクセシビリティ、i18n、既存 draft の配線とテストに限る。panel/page payload、API、backend、DB、AWS、認証、クレジット、生成ジョブの契約は変更しない。AAB、APK、iOS submission は実装後の release gate とし、本設計ではビルド・提出・設定変更を行わない。

開始 HEAD は `8e2a635`、作業ブランチは `feature/mobile-panel-settings-dialogs`。既存 dirty の `docs/cloud-cost-cuts-2-3-7-2026-06-22.md`、`docs/cloud-current-state-2026-06-21.md`、`scripts/createDockerLearningDocx.py`、untracked の `HANDOFF.md`、root `app.json`、mockups、`store-assets/google-play/` は今回と無関係であり、変更・復元・削除しない。

## 2. Spec 根拠

- Spec §2 Product boundary: Mobile は既存 Lyra workspace と backend contract を使う client であり、今回の変更は Mobile editor の操作表現に限定する。
- Spec §3 Architecture: `apps/mobile` 内の component と screen の責任を保ち、Route / Service / Repository / Worker へ表示都合を持ち込まない。
- Spec §4 Authentication and authorization: 現行 capability と read-only 制御をそのまま各 trigger、dialog input、保存操作へ渡す。
- Spec §5 Persistence and tenancy: personal / organization scope、page / panel ID、既存の保存 payload と optimistic concurrency を変更しない。
- Spec §6 Generation jobs: dialog 化によって active generation、single-flight、retry、進捗表示を迂回させない。
- Spec §8 Input and output safety: 文字数、enum、dialogue speaker、frame/panel 対応など現行 validation を維持し、dialog を閉じても不正値を暗黙補正しない。
- Spec §10 Verification gate: Mobile test、typecheck、lint、Expo doctor/config、Android/iOS export、実機 smoke、署名成果物と store submission の確認を release 条件にする。

既存の `docs/mobile-editor-ui-refresh-2026-09-06.md` に定めた、選択中の1コマだけを編集する方針、draft/stale guard、EN/JA、Android safe area、生成・復旧中の操作ロックも継承する。

## 3. 現行構造と変更後の責任

`PanelOrderList` は選択行と overflow action sheet を所有する。選択行の `rowSelected` を solid `colors.primary` にし、その行だけ order badge、title、role、overflow icon を `colors.primaryText` 系へ切り替える。非選択行、danger action、disabled opacity は既存 theme token を維持する。色だけで選択を伝えず、現行 `accessibilityState.selected`、枠、必要なら check 表示も維持する。

`PanelEditorSections` は5つの定義と dialog lifecycle を所有する。画面上には次の5 trigger を並べ、押した項目を1つだけ Modal で開く。

1. 状況・背景
2. 構図・カメラ
3. キャラクター
4. セリフ
5. 効果・メモ

trigger は44pt以上、現在のラベルをそのまま EN/JA catalog から取得し、button role、dialog open state、disabled state を公開する。既存 guidance は必要性を再確認し、残す場合も固定の短文だけとする。

`PagesScreen` は現在と同じ5つの ReactNode を渡す。入力 state、`panelPayload()`、dirty registration、`saveAllPageDrafts` は移動しない。dialog component 内へ draft を複製しないため、開閉しても未保存入力は同じ screen state に残る。

## 4. Dialog インターフェース

`PanelEditorSections` の既存 `language` と `sections` は維持し、次を追加する。

- `panelId: string | null`: dialog が属する選択 panel。親の `PagesScreen` は `panelId=null` が別ページ間で同じ値になっても区別できるよう、`pageId:panelId` を component `key` に使う。component内はpanelId変更をreset判定に使う。scope変更時はkey remountにより同じrenderで旧dialogを描画せず、開いている dialog と内部一時状態を破棄する。
- `disabled?: boolean`: page design、page generation、panel insertion/recovery など競合操作中の dialog起動を止める。read-onlyは閲覧のためtriggerとdialogを開けるようにし、内容側の既存 `canEdit` / disabled controlsだけを操作不能に保つ。
内部 state は `activeDialog: { key: PanelEditorSectionKey; panelId: string | null } | null` の一つだけとする。scope一致時だけ表示し、active dialog がある状態でoperation lockまたはpanelId変更を検出したrenderでは条件付きstate調整で直ちにclearする。複数 settings dialog の同時表示、accordion stateとの併存は作らない。

開く時は押された trigger ref を記録する。閉じる経路は header close、Android back、iOS accessibility escape とし、backdrop tap は入力中の誤操作を避けるため採用しない。閉じた後は `AccessibilityInfo.setAccessibilityFocus` で元 trigger へ戻す。panelId が変わった場合は focus を旧 panel の trigger へ戻さず、dialog を閉じて新 panel の trigger 群を表示する。

## 5. Safe area、キーボード、スクロール

Modal は `presentationStyle="fullScreen"` を基本とする。React Native Modalは親viewと別windowになるため、Modal直下へlocal `SafeAreaProvider` を置き、その中を `SafeAreaView edges={['top','right','bottom','left']}` で覆ってModal window自身のinsetを測る。Android gesture navigation と3-button navigationの双方で、close、入力、末尾の操作が system bar に隠れない構成にする。

SafeAreaView 内を `KeyboardAvoidingView` で包み、iOS は `padding`、Android は `height` を使う。iOSの `automaticallyAdjustKeyboardInsets` は同時に有効化せず、keyboard offsetを二重適用しない。dialog header は上部に固定し、本文だけを `ScrollView` にする。本文の `contentContainerStyle` の下余白は safe areaとは別の `spacing.lg` だけとし、`keyboardShouldPersistTaps="handled"` を使う。SafeAreaViewがbottom insetを一度だけ処理する。長いキャラクター割当、セリフ、複数行メモで最後の field まで縦スクロールでき、キーボード表示中も close と入力対象が到達可能であることを確認する。

dialog sheet に固定高を与えない。端末高へ追随する `flex: 1` とし、内部 ScrollView の `minHeight: 0` を確保する。Android下端は親 Screen の safe area に依存せず、Modal 自身で inset を処理する。

## 6. Draft と lifecycle

- trigger を開く、別の設定dialogへ移る、dialogを閉じる操作では保存しない。現在の PagesScreen state をそのまま表示する。
- close は apply/cancel の意味を持たない。入力は即時に既存 draft state へ反映され、画面の既存「保存」、生成前保存、dirty navigation guardが唯一の永続化経路となる。
- panel 切替は現在の `switchPanel` と dirty resolution を必ず通す。未保存 draft の保存・破棄・キャンセルが決まる前に別 panel の内容を hydrate しない。
- `pageId:panelId` scope が変わったら active dialog、dialog固有 undo、選択indexをresetする。親から同じscope keyでremountし、component内も現在scope以外のactive dialogを描画しない。`AssignmentEditor` と `PanelDialogueEditor` の既存 panel key remountを維持し、旧 panel の undo itemを新 panelへ混入させない。
- stale、read-only、generating、confirmed、panel insertion/recovery 中は既存 guardを維持する。処理中Modalの上に設定Modalを重ねない。
- language変更では dialog を閉じず、同じ active key と draft を保ったまま labelだけ再描画する。

## 7. 永続化、エラー、セキュリティ

永続化入力と出力は現行の `updatePanel`、`saveAllPageDrafts`、generation payload のままにする。dialog open state と focus ref は端末内にもserverにも保存しない。panel ID、organization ID、revision、assignment、dialogue、composition、notesを変換・省略しない。

認証 token、organization capability、ownership は既存 API client に委ねる。新しい network request、外部 URL、upload、secret、ログを追加しない。read-only利用者は内容を閲覧できるが編集controlは disabled のままとする。provider error や raw payloadをdialogへ表示しない。

## 8. TDD 方針

実装前に次のテストを追加・更新し、accordion前提または未実装のため期待したREDになることを確認する。

1. 選択 panel 行だけが solid yellow と contrasting title / role / icon tokenを使い、非選択行へ漏れない。
2. 5 trigger が EN/JA で表示され、押すと対応する既存 content だけが1つの Modalに出る。
3. close、Android `onRequestClose`、accessibility escapeで閉じ、元 triggerへfocusが戻る。
4. pageIdまたはpanelId変更でdialogが同じrenderから閉じ、`panelId=null` のページ切替を含め旧content/undo状態を新scopeへ持ち越さない。
5. dialog開閉と言語切替で入力中 draft と `onChange` payloadが失われない。closeだけではsave APIを呼ばない。
6. read-onlyではtriggerから内容を閲覧でき、既存inputだけが操作不能になる。generation、panel insertion/recovery中はtriggerも操作不能となり、Modal重複が起きない。
7. 小型Android viewport、gesture/3-button inset、キーボード表示をmockし、Modal-local SafeAreaProvider、全edge SafeAreaView、KAV、header固定、本文末尾scrollを確認する。
8. 既存のassignment/dialogue single-selection、panel insertion、dirty navigation、generation contract testsが継続してGREENになる。

対象検証はまず `PanelEditorSections.test.tsx`、`PanelOrderList.test.tsx`、関連するPages interaction contractを実行し、その後 Mobile全Vitest、`npm run typecheck`、`npm run lint`、`npm run check:mojibake`、`npm run contracts:check` へ広げる。

## 9. Terra 委譲パケット

### Terra A: 設定dialog component

- Objective: 5 accordionを単一active Modalの5 triggerへ置換し、safe area、keyboard、scroll、focus restore、panel change resetを実装する。
- Owned files: `apps/mobile/src/components/PanelEditorSections.tsx`、`apps/mobile/tests/PanelEditorSections.test.tsx`。
- Do not touch: `PagesScreen.tsx`、`PanelOrderList.tsx`、i18n catalog、backend、release metadata、他agent/user dirty files。
- Spec basis: §§2、3、4、5、8、本設計 §§4–6。
- Expected output: RED→GREEN evidence、component API、accessibility/focus/safe-areaの検証結果。

### Terra B: 選択panel visual

- Objective: selected panel buttonをsolid yellowへ変更し、文字・badge・overflow iconのコントラストとselected semanticsを維持する。
- Owned files: `apps/mobile/src/components/PanelOrderList.tsx`、`apps/mobile/tests/PanelOrderList.test.tsx`。
- Do not touch: `PagesScreen.tsx`、`PanelEditorSections.tsx`、i18n catalog、backend、release metadata、他agent/user dirty files。
- Spec basis: §§2、3、8、本設計 §3。
- Expected output: RED→GREEN evidence、selected/nonselected/disabled/accessibility stateの確認。

### Sol/root integration

Sol/root は `PagesScreen.tsx` の `panelId`、disabled、dirty lifecycle配線、EN/JA catalog、共有contract更新、統合レビュー、release gateを所有する。Terraの結果を統合前に読み、Modal nesting、保存payload、scope切替、既存1.0.3機能への回帰を確認する。

## 10. Release gate

コード検証後に `npx expo-doctor`、`npx expo config --type public`、Android/iOS production exportを実行する。versionは、直前のlive 1.0.3（Android 94 / iOS 35）の次となる1.0.4を使い、native build numberはEAS auto-incrementに従う。iPhone 375×812 / 390×844、iPad、Android 360×800 のgesture navigationと3-button navigationで、キーボード表示、縦スクロール、VoiceOver/TalkBack focus、EN/JA切替、dirty panel切替をsmokeする。

現環境は `adb` device一覧が空で、physical device / AVDによるnative smokeを実行できない。この制約はrelease記録へ明示し、実行済みと扱わない。一方、ユーザーが許可したreleaseを一律停止する理由にはせず、component mock tests、safe-area/keyboard contract、Android/iOS exports、署名artifact検査、store processingをbounded evidenceとして判断する。deviceが利用可能になれば提出前または最短の追跡確認でnative smokeを追加する。

リリース成果物は現行 production backend contractを向く signed AAB と installable APK、およびiOS archiveとする。version/build numberは既存EAS auto-increment規約に従い、AAB/APKのpackage、version、signature、API base URLを検査する。iOSはbundle ID、version/build、processing完了を確認してApp Store Connectへ提出する。提出前に全gate結果、artifact ID/URL、commit SHA、backend互換、未実行項目を記録する。

## 11. 主なリスクと判断

- ReactNodeをModalへ移すだけなら draft stateは保持できるが、dialog側にcopy stateを作るとclose時に入力を失う。contentはPagesScreen stateへ直接接続する。
- Modal内の `SegmentedControl`、`RecordPicker` は現在どちらもnative `Modal` を開く。React Nativeは同一rootでnative Modalを入れ子にしたときplatform差があり、親設定dialogの上へ確実にpresentできる保証をmock testだけでは得られない。第一案は既存picker APIを維持してnested open/close、Android back、focus復帰をcomponent testとexportで確認する。native確認で表示不能・親dialog閉鎖・focus喪失が出た場合は、設定dialog側の `renderInModal={false}` / inline option listのような明示propを別設計で追加し、選択payloadは変えずnested native Modalだけを避ける。今回の実装中に根拠なく全pickerを作り替えない。
- backdrop closeはキーボード操作中の誤閉じにつながるため採用しない。明示closeとsystem/accessibility closeだけにする。
- panel切替中に旧dialogが残ると別panelへ編集が混入する。panelId change resetと既存dirty guardを両方testする。
- safe areaは親Screenから継承されないため、設定Modal自身が全edgeを処理する。
