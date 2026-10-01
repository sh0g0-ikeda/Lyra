# UI 要件 U01–U32 実装対応表（2026-10-01）

## 判定範囲と根拠

- これは **リリース候補の現行コードと実在するテストの対応表**であり、全項目完了、配布可、本番公開済みを宣言するものではない。
- 初回照合時刻: 2026-10-01 15:04 UTC。基準 HEAD は `f89ac1dd95002937c2fbe89481afe54ed937d690`。この HEAD に後続の未コミット変更を加えた共有 worktree を読んだ。HEAD 単体の検収結果ではない。最終成果物の SHA と本表を、統合時に再対応付けする必要がある。
- 要件の一次索引は提供された **UI 要件台帳 U01–U32**。台帳内の PR220 評価は旧基準 `2bb4e2dabd24c3116c5dae86a177754b367e245d` に対するものであり、以下では現行実装に置き換えて再判定した。
- **原セッション `非公開の元セッション` の原文は未確認**。M1 は台帳の要約であり、逐語的なユーザー指示とは扱わない。特に原文未確定の preset 採用範囲、exact copy の優先順位は推測しない。
- 設計根拠は `origin/codex/uiux-backend-expansion` の `01c1bf6dc1057f1731770d4118e7508eee884433` にある以下の文書。現在の枝へ文書やコード全体を一括移植したわけではない。
  - D: `docs/uiux-backend-expansion-2026-09-30/design/05-フロント.md`
  - O/P/W: 同 `references/manga-app-feedback-overall.md` / `manga-app-feedback-screens.md` / `manga-app-improvement-proposal.md`
  - E: `docs/mobile-editor-ui-refresh-2026-09-06.md`
  - J: `docs/mobile-panel-settings-dialogs-2026-09-06.md`
- **この候補のアプリ画面を browser / native で開いて実見する検証は未実施**。React Native component の mock render、static contract、unit / API / PostgreSQL テストは画面実見の代替ではない。以前の別 checkpoint の portable preview や export を、現行候補の実見済み証拠に転用しない。

### 状態ラベル

- **実装済み（コード）**: 対応するコードと局所テストを確認した範囲。全端末での UX 合格を意味しない。
- **部分実装**: 要件の一部はあるが、明示要件の残差がある。
- **機能フラグ OFF**: 実装があっても既定値が false、または capability 不明時に閉じる。稼働環境の実際の設定値は本表で推定しない。
- **外部設定／決定待ち**: 認証・ストア・公開判断や未確定仕様に依存する。
- **実見未検証**: 全 U 項目に共通。各行には特に重要な残検証を記す。

パス略記: `M=` `apps/mobile/src/`、`MT=` `apps/mobile/tests/`、`BT=` `tests/`。テスト名は実ファイル内のケース名であり、似た名称から期待結果を補完していない。

## 対応表

| ID / 根拠 | 現行の対応・コード根拠 | 実在する検証根拠 | 判定と残り |
|---|---|---|---|
| **U01** 4 タブ / O4.5 W2.1 D1 | `M/navigation/tabs.tsx` は漫画・アセット・マイページ・ガイド。Story / Characters / Pages は消さず Manga 内に接続。内部 route key と表示名を分離 | `MT/MainTabsDirtyGuard.test.tsx`「閲覧権限がある場合は漫画・アセット・マイページ・ガイドの4タブを表示する」「英語ではManga・Assets・My Page・Guideを表示する」 | **実装済み（コード）**。閲覧権限なしでもマイページ・ガイドを残す。実端末のタブ幅／長い翻訳は未検証 |
| **U02** 制作 step / O4.1–4.2 P2.1 D1 | `M/screens/MangaScreen.tsx`、`domain/mangaWorkflow.ts`、`components/PageCreationWorkflow.tsx`、`domain/pageCreationWorkflow.ts`。外側3工程とページ内3工程。保存済み本文／ページ／設定から途中再開。非表示 Story/Pages draft を保持し accessibility から除外 | `MT/MangaScreen.test.tsx`「保存済み本文があればキャラクター、保存済みページがあればページから再開する」「漫画内キャラクターとアセットは同時に同じdirty editorを登録しない」、`MT/PagesScreenWorkflow.test.tsx`「ステップ変更で保存やAIを呼ばずページ入力を保持し実コマ設定をpreviewに使う」 | **実装済み（コード）**。工程移動自体は有料実行を起こさない。native Back / 復帰の実見は未検証 |
| **U03** tutorial / W3.1–3.3 D2 | `M/components/MangaTutorial.tsx`、`lib/mangaTutorialHistory.ts`。一覧に初回説明・skip・replay、Guide に replay。端末内 version 付き履歴、focus / dirty gate | `MT/MangaTutorial.test.tsx`「初回はsafe areaの案内を出し、skipで保存して即座に閉じ、再表示できる」「遅い履歴読取は他tabやdirty dialogに割り込まない」、`MT/mangaTutorialHistory.test.ts` | **実装済み（コード）**。説明の切替は生成処理を実行しない。実見未検証 |
| **U04** 空状態 CTA / P3.1 D2 | `M/components/MangaLibrary.tsx` に空／既存共通の作成・選択 CTA、既存話の再開。`StoryHierarchySheet` / `WorkspaceHierarchyNavigator` を再利用。Pages の話未選択表示と階層選択経路も保持 | `MT/MangaLibrary.test.tsx`「作品変更のdirty確認キャンセル時には一覧と元選択を維持する」「同じ作品を開く場合に選択中の章や話を初期化しない」、`MT/StoryHierarchySheet.test.tsx` | **実装済み（コード）**。ページ上の未選択 Notice 自体はリンクではなく、近接する共通階層 UI で選択／作成する。空／長編での発見しやすさは実見未検証 |
| **U05** safe area / keyboard / P3.2 J5 | `M/components/Screen.tsx`、`PanelEditorSections.tsx`、`PanelOrderList.tsx`、`MangaTutorial.tsx`、`PageGenerationResultModal.tsx`。panel設定と操作sheetは Modal-local provider / 全edge SafeAreaView、固定header、scroll本文。操作sheetは下部paddingも確保 | `MT/sharedAccessibilityControls.test.tsx`「keeps screen content in safe areas and resizes for the Android keyboard」、`MT/PanelOrderList.test.tsx`「Modal内providerと全edgeを持ち固定headerとscroll操作で下部の削除へ到達できる」、`MT/PanelEditorSections.test.tsx` | **実装済み（対象部品のコード）／実見未検証**。全既存 popup の実端末受入を示すものではない。小画面、iPad、大字、Android gesture/3-button、nested picker は検証待ち |
| **U06** 記入例・目的・分量 / P3.3 D2 | `M/screens/StoryScreen.tsx` のタイトル・本文・想定枚数・scene順序・場所・時間・雰囲気に短いplaceholder。`FormField.tsx` の optional `helpDisclosureLabel` は必要時だけhelpを開く。4は作成枚数の例、順1はscene位置。入力値は変更しない | `MT/FormFieldHelp.test.tsx`（8ケース）、`MT/StoryStartingStatesIntegration.test.tsx`「例と開閉helpは保存値へ入れず既存ページ数と本文を保持する」 | **実装済み（コード）**。常時長い導入文を復活させない。保存済み7ページ・本文が例で置換されないケースあり。日英／大字の実見は未検証 |
| **U07** 次キャラ CTA / P3.5 4.3 D2 | `M/screens/MangaScreen.tsx` の次工程 CTA と `StoryScreen` の `onOpenCharacters`。dirty resolution 後に制作内 Characters を開く。Assets へ強制離脱しない | `MT/MangaScreen.test.tsx`「StoryのキャラクターCTAはアセットへ離脱せず制作内の工程を開く」「未保存確認をキャンセルすると元の工程とキャラクター編集を維持する」 | **実装済み（コード）**。遷移だけで AI／有料生成しない。実見未検証 |
| **U08** primary・preview / O4.4 P5.2 D2 | `M/components/PageCreationWorkflow.tsx`、`StoryGenerationControls.tsx`、`PageSettingsPreview.tsx`。MangaのStory/Charactersではshellの次へがprimary、本文AI・保存・再作成・import・状態操作はsecondary。Assets単独は作成／base previewの主要操作を残す。実枠／実draft preview、設定を変えず次へ | `MT/editorActionHierarchy.test.ts`「本文AIの改善と相談は補助操作として両方残す」「漫画のキャラ工程はshellの次へをprimaryにしimportと状態操作はsecondaryにする」「ページの保存はsecondaryで画像生成と既存設定の次へをprimaryとして維持する」、`MT/PagesScreenWorkflow.test.tsx` | **実装済み（対象工程のコード）／実見未検証**。主要／補助のvariantと機能存続をstatic/componentで確認。画面内の実際の視線誘導・密度・各disabled状態は実見gateで確認する |
| **U09** defaults / preset / 詳細折畳み / P4.1 W4.4–4.5 | `M/screens/CharactersScreen.tsx` は既存空欄を空のままhydrate。顔／髪／服装の詳細は折畳み。`entityMutationPayload` は未変更structured fieldsを再送しない。新規も空draftで始まり男性／20代presetを適用しない | `MT/CharacterHiddenFieldsIntegration.test.tsx`「表示中の別項目を編集しても非表示alias・構造化field・保存済み空欄へpresetを上書きしない」、`MT/entityMutationPayload.test.ts` | **部分実装＋決定待ち**。**保存済み空欄へのpreset上書きは禁止**。保全と詳細折畳みは実装済みだが、新規preset採用値・範囲は原文未確定。未設定の `-` を架空の値で埋めて完了にしない |
| **U10** 服装候補の検索・説明 / P4.2 D6 | `M/components/CharacterChoiceField.tsx` にopt-in検索を追加し、Charactersの服装大分類へ接続。日英label／内部値で絞り込み、検索解除で既存全候補と元順序へ戻る。`CharacterOutfitField.tsx` の自由文詳細も維持 | `MT/CharacterChoiceField.test.tsx`「検索前後で元の全候補順を保持し頻度やpresetを捏造しない」「検索が0件でも保存値や選択肢を消さず検索だけでdirtyにしない」、`MT/CharacterOutfitField.test.tsx` | **実装済み（検索案）＋頻度順保留**。追加確認に従い根拠のない分類・並べ替えはしていない。**頻度データは未計測なので頻度順は未実装**。検索／言語切替のnative実見は未検証 |
| **U11** 言語設定の集約 / P2.4 D6 | `M/components/Screen.tsx` はログイン後の言語ボタンを出さず、`screens/AccountScreen.tsx` に集約。未ログイン時は切替可。日英 catalog を保持 | `MT/sharedAccessibilityControls.test.tsx`「ログイン後は言語をマイページへ集約し残高をscroll外に固定する」「shows the pre-login language switch even when the screen header is hidden」、`MT/i18nCatalogContract.test.ts` | **実装済み（コード）**。全画面の翻訳表示／大字実見は未検証 |
| **U12** 実残高・server quote・補充 / P5.1 D3 | `M/components/CreditBalanceBadge.tsx` は実 scope の query と読込／失敗／更新状態。page/entity/state/import は `GenerationQuoteController`、各 quote dialog で明示受付。`BillingHandoffNotice` は権限別導線 | `MT/CreditBalanceBadge.test.tsx`「読込失敗は0ではなく安全なerrorと再試行を出す」、`MT/pageGenerationQuoteController.test.ts`「保存と見積取得だけでは課金せず表示した対象・価格を明示受付する」、`MT/EntityStateEditor.test.tsx`「server見積の7クレジットを確認してからのみ受付し旧previewAPIを呼ばない」、`MT/QuotedEntityImport.test.tsx` | **実装済み（コード）＋機能フラグ OFF**。`GENERATION_QUOTES_ENABLED` は既定 false。新 Mobile 有料入口は capability absent/off で利用不可。旧固定3へ fallback しない。公開には quote backend の有効化・受入が必要。実購入／復元は未実施 |
| **U13** 安全な error と精算 / P3.4 D3 | `M/components/ActionableErrorNotice.tsx`、`PageErrorRecoveryNotice.tsx`、`JobStatusCard.tsx`、`JobCreditSettlement.tsx`、`domain/generationQuoteController.ts`。処理復旧、stale、scope、確認済み精算、受付不明の照合を分離 | `MT/ActionableErrorNotice.test.tsx`「keeps an unknown error generic and does not invent a navigation action」、`MT/JobCreditSettlement.test.tsx`「server status %s を推測せず表示する」、`MT/JobStatusForeground.test.tsx`「status読取失敗は生成失敗や未課金と区別し、raw errorを出さない」 | **部分実装**。主要生成経路は検証あり。全 API error に処理名・保存範囲・精算・次操作が揃う網羅証明はない。通信断を未課金と断言しない。実見未検証 |
| **U14** dirty / 最新読込 / P3.6 D3 | `M/lib/confirmStaleDraftReload.ts` は Story のタイトル・本文・ページ数・開始状態・AI案、Character / Page の置換範囲を明示。dirty provider は保存／破棄／戻る。通常 dialog close と置換確認を分離 | `MT/confirmStaleDraftReload.test.ts`「%sの%s再読込で置き換える項目を明記して確認前には実行しない」、`MT/StoryStartingStatesIntegration.test.tsx`「staleの最新読込は明示確認されるまで全draftを保持する」「最新読込中の追加編集を古い応答で上書きしない」、`MT/UnsavedChangesResolutionDialog.test.tsx` | **実装済み（コード）**。保存不可／Cancel／scope race を局所検証。全旧画面との実見は未検証 |
| **U15** stage / progress / 時間 / P5.3 E6.1 | `M/components/JobStatusCard.tsx`、`StoryGenerationControls.tsx`、quote dialog。既存の画像約5分／自動入力最大約20分説明、server stage/progress、遅延、取消可否を保持。推定残秒を新設していない | `MT/JobStatusForeground.test.tsx`「ストーリー自動入力中は20分程度かかる可能性を表示する」「処理中の停止依頼後は依頼済み状態を表示する」、`MT/StoryGenerationControls.test.tsx`「enqueue直後は開始だけを表示しauthoritative完了前に完了と表示しない」 | **実装済み（既存説明・状態表示）**。実測 ETA はない。所要時間を保証しない。実時間／foreground 実見は未検証 |
| **U16** 完了 dialog / W4.10 D5 | `M/hooks/usePageCompletion.ts`、`components/PageGenerationResultModal.tsx`、`domain/pageCompletionPolicy.ts`。job ID 単位、foreground/current scope/page/create step、dirty・他 dialog を gate。閉じた後の手動再表示、最終ページは一覧へ | `MT/usePageCompletion.test.tsx`「同じjobのpoll再受信で閉じた結果を開き直さず手動再表示は可能」「dirty・購入/確認dialog・別target・別step中は割り込まない」、`MT/PageGenerationDialogs.test.tsx`「結果を開いただけでは有料処理せず最終ページは一覧確認に置き換える」 | **実装済み（コード）**。実 background/foreground、画像読込、focus 復帰は実見未検証 |
| **U17** 次ページ／再生成の受付安全 / D5 | `M/screens/PagesScreen.tsx` は dirty解決→保存→最新 target/readiness→server quote→明示受付。次ページは既存順序から選び自動追加なし。`src/services/generation/GenerationQuoteService.ts` と atomic service が scope/revision/残高/active job を検証。前画像を暗黙参照にしない | `MT/pageGenerationQuoteController.test.ts`「能力OFF・別scope・期限切れ・blockerでは受付しない」「受付通信断は照合し同じtoken/request_keyでのみ再試行する」、`MT/pageCreationWorkflow.test.ts`「次ページは並び順から決め、最後のページで勝手に追加しない」、`BT/integration/generationQuotes.test.ts`、`BT/integration/pageAtomicGeneration.test.ts` | **実装済み（コード）＋機能フラグ OFF**。quote 公開前は新 Mobile 有料操作が使えない。実 provider 実行／支払を伴う検収は未実施 |
| **U18** 長編移動 / W4.9 D2 | `M/components/PageThumbnailPicker.tsx` の横 FlatList を保持し、`PagesScreen.tsx` にページ番号 `RecordPicker` を追加。grid は追加していない | `MT/PagesScreenWorkflow.test.tsx`「工程別CTAを分離しpage number選択とcolor/monochrome入口を維持する」、`MT/PageThumbnailPicker.test.tsx`、`MT/pageCreationWorkflow.test.ts` | **実装済み（番号 jump 案）**。grid は未採用。任意の閾値を必須仕様として捏造しない。長編性能／選択の視認性は実見未検証 |
| **U19** dark / brand / 差別化 / D1 W前提 | `M/constants/theme.ts`、`PrimaryButton.tsx`、`PanelOrderList.tsx` は dark、gold primary、secondary/disabled/selected token を保持。白背景や☆30を固定しない | `MT/sharedAccessibilityControls.test.tsx`「gives text inputs a visible border and stronger focused state」、`MT/PanelOrderList.test.tsx` の selected 背景・文字・icon assert | **部分実装／実見未検証**。contrast比、大字、端末 safe area の実測はしていない。token の存在を WCAG 合格と読み替えない |
| **U20** 番号title / 黄色section / 導入なし / M1 E3 | `M/lib/editorUiMessages.ts` のE明示copyを3 screenへ適用。`1 ストーリー / 2 キャラクター / 3 ページ` と対応英語、Screen導入subtitle削除、通常Section titleをyellow、borderを明るく。状態・安全noticeは保持 | `MT/editorRefreshContract.test.ts`「3画面を番号付きタイトルとし導入subtitleを置かずsectionを黄色にする」、`MT/characterLatestUiContract.test.ts`、`MT/sharedAccessibilityControls.test.tsx` | **実装済み（明示設計のコード）**。M1原文は依然未確認。原文未確定の追加copyを推定せずEの明示範囲を適用。実見未検証 |
| **U21** Story prose / scene chips削減 / M1 E4 | `M/screens/StoryScreen.tsx` から単一本文の定常説明、scene人物chips／追加読込UIを削除。タイトル／AI／背景時間の見出しをEに合わせた。`sceneEntityIds` stateのhydrate・create/update payloadは保持 | `MT/StoryStartingStatesIntegration.test.tsx`「sceneキャラchipsを表示せず場所だけ保存しても既存関連IDを全て保持する」、`MT/editorRefreshContract.test.ts`「Storyのscene人物chipsを隠してもhydrateと保存対象のIDを保持する」 | **実装済み（コード）**。未読込人物IDも落とさず保存する。本文AI・dirty・stale・開始状態回帰も継続。実見未検証 |
| **U22** Character UI簡略化 / M1 E5 | `M/screens/CharactersScreen.tsx` のalias入力・不要定常説明・重複集計・候補画像download専用ボタンを削減し、自由入力と唯一の保存を作成Section内へ移動。import・候補選択・confirm API・状態・errorは保持。hidden alias配列はCSV再分割せず保存 | `MT/CharacterHiddenFieldsIntegration.test.tsx`「alias入力を表示せず名前だけ保存した時は構造化値を送信しない」「自由入力保存は既存の1つのdirty guardを使いimportとconfirm入口を保持する」、同fileの `Ace, Jr.` 配列保全ケース、`MT/editorRefreshContract.test.ts` | **実装済み（コード）**。alias UI非表示とデータ削除を区別。新presetは未導入。候補download削減はサーバー確定処理の削除ではない。実見未検証 |
| **U23** 選択1件編集 / M1 E6 | `M/screens/PagesScreen.tsx` 内 `AssignmentEditor` と `components/PanelDialogueEditor.tsx` は全件へ到達する一覧＋選択1件の詳細。同workの画面外話者対応は末尾F21追記を参照。親の全draftを保持、選択だけではonChangeなし。page:panel keyでscopeを分離。通常の画像内台詞説明を削減し、例外の画像外警告・Web導線は保持 | `MT/PagesScreenWorkflow.test.tsx`「人物選択だけではdirtyにせず全人物の未保存値を保持する」「read-onlyでも全人物を選択して閲覧でき入力はdisabledのまま」、`MT/PanelDialogueSelection.test.tsx`、`MT/PanelDialoguePlacementNotice.test.ts` | **実装済み（コード）**。台詞の既存add/delete/undo・空行・配列順を維持。現HEAD／参照枝には台詞reorder操作が存在しないため新規には追加していない。保存時のtrim/filter契約は維持。実見未検証 |
| **U24** 直後に空コマ1つ / M1 E6.3 | `M/hooks/usePanelInsertion.ts`、`domain/panelInsertion.ts`、backend `PagePanelStructureService` / `PagePanelStructureRepository`。`insert_after` 原子命令で空コマを直後に作り、選択枠だけ二分。現payload／assignmentsを複製しない。旧設計の複数逐次APIより強い transaction 境界 | `MT/panelInsertion.test.ts`「選択したコマの後ろに空のコマを作る命令だけを送る」、`MT/usePanelInsertion.test.tsx`「書込み成功後の読込失敗は追加済みとして保持しreloadで書込みを繰り返さない」、`BT/integration/pagePanelStructure.test.ts` | **実装済み（コード）**。読み込み失敗／受付不明で再追加を抑制。実際の枠 geometry・空欄操作は実見未検証 |
| **U25** 選択コマ yellow / J1・3 | `M/components/PanelOrderList.tsx` の selected 行は solid `colors.primary`、文字／overflow icon は `primaryText`、order badge反転。`accessibilityState.selected` が色以外の意味を提供 | `MT/PanelOrderList.test.tsx`「各コマの順序・役割・選択と三点メニューだけを短い行に表示する」内で選択／非選択色、選択切替、icon色を assert | **実装済み（コード）**。選択行にはcheck iconと選択中accessibility labelも付ける。contrast実測なし |
| **U26** 5設定 popup / J3–6 | `M/components/PanelEditorSections.tsx` の状況背景・構図カメラ・人物・台詞・効果メモ。単一 active modal、親draft直結。closeで保存せず、page/panel scope変更でreset | `MT/PanelEditorSections.test.tsx`「5つの設定triggerを固定順で表示し、押した内容だけを1つのModalで開く」「親draftの入力はclose、reopen、language切替後も同じ値を使う」 | **実装済み（コード）**。native nested picker 実見は未検証 |
| **U27** dialog close / focus / 44pt / J4–6 | 同 component に ×、`onRequestClose`、accessibility escape、元trigger focus、44pt、固定header、scroll body、safe area。backdropによる誤閉じなし | `MT/PanelEditorSections.test.tsx`「header close、back、accessibility escapeで閉じてtriggerへfocusを戻す」「iOSで閉じる途中に別設定を開いた場合に古いfocus復元が新画面を妨げない」 | **実装済み（コード）＋実見未検証**。mockで native present/focus の保証はできない。VoiceOver/TalkBack・Android Back・親子modalを検証待ち |
| **U28** Google能力gate / D4 | `M/screens/AuthScreen.tsx`、`components/GoogleIdentityLinkPanel.tsx`、`domain/googleIdentityLink.ts`、Web `apps/web/src/components/GoogleAuthControls.tsx` / `lib/googleIdentityLink.ts` / `lib/googleAuthPopup.ts`、backend explicit challenge。既存メールlogin保持、同emailだけで自動linkしない。認証済statusで完了確認 | `MT/AuthScreenGoogle.test.tsx`「Google disabledでも既存メールログインを保持する」、`MT/GoogleIdentityLinkPanel.test.tsx`「未知POSTのretryは同じrequest keyを使い、不明resultを成功扱いしない」、`MT/googleIdentityLink.test.ts`「browser cancel後も未連携を断言せずserver statusを確認する」、`BT/unit/web/googleIdentityLink.test.ts`「cancelled popup still checks the receipt; callback is not success evidence」、`BT/unit/web/googleAuthPopup.test.ts`「Google callback sends only challenge id and never reaches Cognito exchange」 | **実装済み（コード）＋機能フラグ OFF＋外部設定待ち**。`GOOGLE_SIGN_IN_ENABLED` / `GOOGLE_IDENTITY_LINK_ENABLED` 既定 false、iOS capability false。Cognito/Google、ログredaction、実アカウント／callback、iOS公開判断は別ゲート |
| **U29** 状態・開始状態・境界 / D4 | `M/components/EntityStateEditor.tsx`、`EntityStatePicker.tsx`、`EpisodeStartingStatesEditor.tsx`、`StoryStateAutofillOptions.tsx`、`EpisodeStateAutofillResult.tsx`。default／状態名／説明／元参照、confirmed thumbnail、開始状態、明示 overwrite、blockerから状態作成・手動return。旧 global visibility flag は一括解除せず server capability で新経路を限定 | `MT/EntityStatePicker.test.tsx`「未知の保存済み選択を勝手にdefaultへ戻さず欠落として表示する」、`MT/StoryStartingStatesIntegration.test.tsx`「開始状態だけを明示クリアしても既存dirty保存を通り空配列を送信する」、`MT/StoryStateAutofillOptions.test.tsx`「明示enableは必ず保護設定で始まり上書きは別の明示操作になる」、`MT/EpisodeStateAutofillResult.test.tsx` | **実装済み（コード）＋機能フラグ OFF**。`ENTITY_STATE_REFERENCE_GENERATION_ENABLED` / `EPISODE_STATE_AUTOFILL_V1_ENABLED` 既定 false、preview は quote も必要。未確定stateを勝手に採用／有料連鎖しない。生成品質とnative実見は未検証 |
| **U30** Web / PC境界 / D冒頭 PR218 | Mobile構成は `apps/mobile` に限定。`apps/web/src/App.tsx` は既存Webコンソール構成を保持し color/monochrome入口・provenance配信制御等を追加。Mobile wireframeへ全置換しない | `BT/unit/web/imageDelivery.test.ts`、`BT/unit/web/jobCompatibility.test.ts`、`MT/PagesScreenWorkflow.test.tsx`。これらは機能境界の部分証拠でありPC状態editorの検収ではない | **実装済み（境界保持）／段階公開**。新状態editorのMobile側を実装。PC状態editor、Web Google公開UI、Webの実表示は本表で完了扱いにしない |
| **U31** brand認証domain・メール / P2.2–2.3 | Google UIとは独立した Cognito/メール設定事項。現在のコード追加や `docs/google-identity-link-readiness-2026-10-01.md` は custom auth domain や認証メール文面／配信を有効化した証拠ではない | この要件の custom domain 実疎通・日英メール受信を確認するテスト結果はなし。Google capability test を代替根拠にしない | **外部設定／決定待ち（有効化・実検証の証拠なし）**。ドメイン証明／DNS・認証設定・メール送信設定・理由／用途／期限／心当たりなし／UI言語一致を検討・適用・実受信する必要。旧メールlogin削除で解決しない |
| **U32** コマ割り強弱・視線誘導 / P5.4 | `src/services/page/PageGenerationLayoutControl.ts`、`LayoutGuideImageRenderer.ts`、`PromptBuilder.ts`、`src/domain/constants/panelFrameTemplates.ts` の保存枠・番号・RTLガイドとeditorial情報。Story側のprofile/plannerとの整合は別検証。状態反映で既存構造を変更しない | `BT/unit/services/page/PageGenerationLayoutControl.test.ts`「custom の場合に入力配列の順序に依存せず保存済み番号と枠を保持する」、`BT/unit/services/page/LayoutGuideNumberedRenderer.test.ts`「全テンプレートの有効な枠に番号付きガイドを描ける」、`BT/unit/services/story/PageSkeletonService.test.ts` | **部分実装・生成品質評価待ち**。prompt/geometry契約のテストは『均等4枠・bust-upの連続が改善した』という画像評価ではない。実画像の比較評価・山場／カメラ差／RTL読み順の人手検収は未実施 |

## 実行済み検証と未実施の境界

- 表のコード対応は追加修正後の 2026-10-01 15:26 UTC に更新。以下の最終集約結果は別記する。

- この表を作る前の Mobile 集約は **175 files / 843 tests**、typecheck、lint が成功（2026-10-01 14:36–14:39 UTC の worktree）。本表の初回作成では同じ集約を再実行していない。後続の U20–23 等を追加修正したため、この数字をそのまま最終 SHA の結果にしない。
- Backend の担当範囲では PG16 / PG18 それぞれ **54 tests / 5 suites**（atomic、quotes、story revision、story deletion、state confirmation）成功。UIの実見や外部provider受付を証明しない。
- `.maestro/NAVIGATION_MIGRATION.md` および selector contract は4タブ／制作stepへ更新した。**Maestro native 実行は未実施**。
- 最終共通schema変更後の exact-source Android/iOS offline export は統合側で進行中（本表作成担当は未実行）。以前の export を最新版扱いしない。EAS／store build、OTA、store提出、本番deploy、実購入、paid image call はこの検収では実施していない。
- 新clientで有料page/entity/state/importを使うには、quote backendの有効化と外部稼働検証が必要。フラグOFFのままコードがあることと、利用者が機能を使えることを区別する。

## 優先して閉じる項目

1. U05 / U06 / U08 / U10 / U20–23 の追加修正を最終SHAへ固定し、集約gate結果と対応付ける。hidden alias / scene関連の保全回帰を含む。
2. U09 の新規presetは決定待ち、U10 の頻度順は未計測で保留。検索は実装済みであり、この保留と混同しない。
3. browser/native 実見: 空／既存／長編、日英、大字、小画面、iPad、safe area、keyboard、VoiceOver/TalkBack、native picker nesting、offline復帰、dirty、個人／法人、viewer/editor/billing。
4. U28/U31 の認証設定・実受入、quote/state公開ゲート、ストア購入／復元は外部設定・公開判断を伴う。ローカルgreenだけで有効化しない。
5. U32 の実生成画像の品質評価。状態適用の成功とコマ演出の改善を同一の完了条件にしない。

## F20 通知保全の追加照合

- UI台帳とは別の機能台帳 F20 にある通知の保全も照合した。`M/App.tsx` は `M/domain/pushCapability.ts` の `canRegisterPushNotifications` を介して `/me.capabilities.push_notifications` が true のときだけ既存 `PushNotificationCoordinator` を起動する。クライアント定数 false による一律閉鎖は除去済み。
- `src/routes/me.ts` / `src/app.ts` は実際に登録serviceがmountされるruntimeに能力を対応付ける。不明・falseでは新しい通知許可promptを出さない。`M/state/appState.tsx` のlogoutは能力が後からfalseでも旧登録を `unregisterPushNotifications` へ渡す。
- 根拠: `MT/pushCapability.test.ts`「旧レスポンスや無効能力では通知許可を新たに要求しない」「登録runtimeが有効な時は既存の通知と端末許可フローを利用できる」、`MT/mobileFeatureVisibility.test.ts` のlogout経路assert、`MT/pushNotifications.test.ts` のnative unregister回帰。
- **コードの保全を実装済み**。APNs/FCM・実token登録・OS許可・実通知到達・通知から制作対象へのnative復帰はこの作業では実受入していない。F20全操作の本番受入完了という意味ではない。

## 追加修正の checkpoint

2026-10-01 15:28 UTC の worktree（push runtime能力修正込み）で Mobile **182 files / 888 tests、typecheck、全lint、contract同期、mojibake が成功**。その後に F21 画面外話者のMobile入力境界を追加修正するため、888件は中間checkpointであり最終値ではない。

## F21 画面外話者の追加保全

- `M/screens/PagesScreen.tsx` は API で取得した人物を `entity.work_id === activeWorkId` で絞り、同workの話者候補と `visibleEntityIds` を別々に `PanelDialogueEditor` へ渡す。候補の追加読込は明示操作のみ。話者選択でassignmentや参照画像を追加しない。
- `M/domain/panelDialoguePolicy.ts` は同workの既知IDなら画面外 speech / thought / shout / whisper を許可し、それらの null 話者は未解決として保存を止める。narration / sfx の null は許可するが、どのtypeでも未知・他workのnon-null IDを有効にはしない。
- `M/components/PanelDialogueEditor.tsx` はコマ外label、保存済み未知IDの「未解決の話者」、必須話者がnullの「話者を選択」をそれぞれ表示する。未読込のIDを一覧の先頭人物へ表示上もデータ上も置換しない。候補が後から読み込まれてもdraftを変更しない。read-onlyでも明示的な候補追加読込は可能だが、話者・type・本文編集は不可。
- 追加時の既定話者は最初のvisible人物。visible人物がいない場合は従来どおり話者なしnarrationで始める。画面外の人物を勝手に画面内化しない。
- 根拠: `MT/PagesScreenWorkflow.test.tsx`「同workの画面外話者を許可しforeign候補を除外してassignmentは増やさない」「未読込・未知や他workの保存済み話者を他人へ置換せず保存を止める」、`MT/PanelDialogueSpeakers.test.tsx`「コマ外の話者を選んだ場合にセリフだけを変更し参照と登場人物を変えない」、`MT/panelDialoguePolicy.test.ts` のtype別境界、`MT/PanelDialogueSelection.test.tsx` の全draft保全。
- **Mobile入力側とbackendの同work / off-panel契約を整合済み（コード）**。局所67 testsが成功。実画像で声の描き分けが正しいことや、実端末の話者picker表示が合格したことは意味しない。

## 最終 Mobile 検証・凍結記録

2026-10-01 **15:40 UTC**、F21およびpush runtime能力の保全を含む現行worktreeで次が成功した。

- Mobile Vitest: **183 files / 926 tests**
- Mobile TypeScript: `tsc --noEmit` 成功
- Mobile 全体 ESLint: `eslint . --max-warnings=0` 成功
- canonical API contract 生成同期check、mojibake check、`git diff --check` 成功
- 本表: **U01–U32が各1行、計32 ID**。明示した `M/`、`MT/`、`BT/` パスの実在を機械確認

この時点のHEADは `f89ac1dd95002937c2fbe89481afe54ed937d690`、共有worktree全体は431変更／新規path。これは全担当の変更を含む数であり、このUI作業だけの件数ではない。検証対象はHEAD単体ではなくその未コミット変更込み。**最終配布物のexact commit / offline export / native実見の記録は統合リリース側で別途対応付ける**。本担当はcommit、push、deploy、paid生成、store操作を実施していない。

### この対応表の検収で追加修正した範囲

- U05: コマ操作sheetのModal内safe area、固定header、scroll body
- U06: placeholder＋必要時だけ開く入力help。保存済み本文／枚数を例で置換しない
- U08: 制作工程の主要CTAと保存・AI補助・再作成・import・状態操作のsecondary化。既存の実行経路は維持
- U10: 服装候補の検索。全候補・元順序・保存値を保持し、頻度順は作らない
- U20–22: 明示された日英title、導入prose削減、黄色sectionと境界、Story chips非表示、Character alias非表示と自由入力統合、candidate download専用ボタン削減。scene関連、hidden alias、構造化値、import/confirm/errorを保全
- U23: 人物割当と台詞の選択1件編集、全draftの保持、選択だけではdirtyにしない、scope切替で局所selection/undoを分離
- F21: same-work off-panel話者とvisible castを分離し、未知／未読込／null必須話者を自動置換しない

見つけた明白な上記ローカル差分は修正し、コードを凍結した。**新規presetの採用範囲、未計測頻度順、外部認証設定／公開、実生成品質、browser/native実見は未完了のまま明示**している。U13の全error経路網羅やF20全機能の本番受入も、この局所検証で完了とは扱わない。
