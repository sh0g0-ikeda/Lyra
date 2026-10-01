# 機能要件と実本番互換の対応表

2026-10-01。対象は最終 validation 文書に記録するローカル候補 commit。
元セッションの原文は未確認。保存された機能台帳 F01–21、PR215 の設計01–04／共通契約、
PR216–220、実本番 source `2debe8c3c22633ed077e7b189ddcfa8b209a00dc` と実コードを照合した。
「実装あり」はローカルコードと fake adapter／使い捨て DB 試験を指し、公開・実課金・実機受入を意味しない。
UI の U01–32 は別の `release-ui-traceability-2026-10-01.md` で追跡する。

| ID | 要件 | 実装根拠・回帰 | 公開前の残条件 |
|---|---|---|---|
| F01 | 明示的な白黒／カラー、省略は従来カラー | render_style を job／quote／snapshot／prompt に固定。白黒は保存前 grayscale PNG。Web／Mobile の選択と adapter 回帰 | 実生成品質と旧ストア端末 |
| F02 | 同人物の default／負傷等の参照を同時保持 | PageReferenceIdentity、PageGenerationInputImageBuilder。旧 note-only の同じ base は重複課金しないが別の確定状態画像は保持 | 実生成での人物同一性 |
| F03 | 別人物に複製せず状態名＋自由入力 | entity state repository/service、EntityStateEditor、状態名・description 表示。暗黙 stack／画像合成なし | 状態受付 flag OFF、実機 |
| F04 | 確定 default → preview → 選択 → 確定 | EntityStateReferenceService、EntityStateReferenceRepository、quoted state preview。所有者／entity／revision／job／candidate を検証 | 状態 flag OFF。DB切断／遅延copyのローカル再現・未確定試行の停止ガードは追加済み。未確定試行の復旧設計と実S3受入は未了（2026-10-02追補） |
| F05 | 旧確定画像を保持、編集の未反映表示 | EntityStatePresentation、EntityStateEditor と候補失敗／再生成／revision 回帰。base gallery 不変 | 実画像・実機 |
| F06 | コマ default／状態別参照、同人物複数状態 | EntityStatePicker、pageEntityStateOptions、PageReferenceIdentity。未確定参照は受付／課金前に停止。旧注記状態も保持 | gate と実機 |
| F07 | 話開始状態の明示保存、空は default | migration041、EpisodeStartingStatesEditor、starting states API。省略保持／明示 [] 解除 | gate と実機 |
| F08 | 話中の状態遷移、退場後継続、明示 default 復帰 | EpisodeStateTransitionCompiler、AssignmentResolver、ApplicationPlan。StoryStateAutofillOptions／結果表示 | AI 意味推論の実品質。LLM だけで整合性を保証しない |
| F09 | 保存本文 quote、実在 ID／確定参照／freshness | bounded transition schema、compiler／plan／resolver、current work ownership 回帰 | 引用一致は意味の正しさの保証ではない |
| F10 | 未作成／未確定／曖昧時は原子的停止、戻って再入力 | EpisodeStateAutofillResult の blocker→状態作成導線、StartingStates／StateEditor。paid preview は自動連鎖しない | gate と native navigation の実機 |
| F11 | 手動状態を無断上書きしない | preserve／明示 overwrite policy、既存注記・手動割当の回帰、UI 確認 | 未分類の過去データを勝手に manual/auto 推測しない |
| F12 | page／panel／assignment／job を同 transaction | story autofill execution/cancellation repository、rollback／取消競合 integration | 混在 worker、実環境の drain・write freeze |
| F13 | 本文自動入力無料、preview は明示課金 | GenerationQuotePolicy と UI。現行 tariff は preview/import1、page3+max(0,distinct refs−3)、text0 | 設計の preview2 は採算仮案。値上げせず実原価・承認待ち |
| F14 | Hy4 Preview を無断代替しない | 生成モデル候補には入れず OFF。未知モデルや未対応契約へ fallback しない | 公式画像 API／参照編集／料金の確認 |
| F15 | Hy4 出力は Web のみ、Mobile の全表示・保存経路を遮断 | image provenance policy、専用 Web route、検証済み Cognito client allowlist、Mobile 共通画像・export guards。legacy metadata 欠落と未知値を区別 | Web client allowlist 設定・実ブラウザ。未知モデルは拒否。ローカル保存済み fixture が証明する gpt-image-1 のみ旧出力互換を追加 |
| F16 | model／quality を混同しない、無断 high 化しない | quote が実 configured model／quality を固定。既存 GPT/medium を維持、adapter が実 provenance を返す | 複数モデルの実測比較と Hy4 契約は未了 |
| F17 | server quote、immutable 入力、原子的受付と照合 | generation quotes repository/service、worker immutable snapshot、durable dispatch、quoted import、quote UI controller。PG16/18 の同時受付／失敗注入／応答喪失 | GENERATION_QUOTES_ENABLED は既定 OFF。新 Mobile 有料操作を公開する前に runtime gate を通す |
| F18 | Cognito を残す Google と旧アカウント保全 | GoogleIdentityLinkService／Gateway／PreSignUpGuard、capability、Mobile CTA。通常 login は全 provider で email-only subject 変更禁止、signup を user＋bonus 同 transaction | Cognito は IdP 未設定。実 subject audit、Web／Mobile 実認証、既存 group／購入の確認 |
| F19 | 通常 login と明示 link の分離、両本人・単回性・復旧 | dedicated Google client、nonce/PKCE、recent native proof、durable challenge＋provider reservation、曖昧結果は read-only reconcile、expiry receipt 保持 | 専用 OAuth／trigger／IAM／ログ秘匿設定、iOS Apple／例外判断、実 timeout/deletion 競合。Web の Account UI・独立 native 再認証 popup・固定戻り・receipt 回復も実装済み。実ブラウザ未検証 |
| F20 | 既存編集・構造・課金・通知・退会等の保全 | 下記の production API／runtime 一覧、CAS／cursor／billing／push／export／deletion 回帰。UI の全フィールド／alias／scene entity_ids の保持は UI 対応表 | 配布済み binary と全 nested response の完全同一性は未証明。旧実機受入・production 設定監査 |
| F21 | 画面外話者、心の声、narration、不明話者、台詞密度と独自枠 | PageGenerationLayoutControl、StoryEditorialPrompts、保存された layout map、numbered PNG guide、off-panel ID 保全、text_plan／density audit。legacy model profile が既定 | 実 LLM／画像の読み順・密度品質。32ページ上限は現行 StoryAI SubSpec の明示値を保持 |

## 実本番の 9 HTTP 契約

全て `/api` 配下。実本番の route と mount を基準に追加・保持した。
source の存在確認だけでなく該当 handler／schema／DB の回帰を置く。

| HTTP 契約 | 候補の根拠 | 注意 |
|---|---|---|
| POST /pages/:id/save-and-generate | PageAtomicGenerationService、pageAtomicGeneration route／PG integration | Idempotency-Key と full draft、202 job_id/page_revision。古い hash なし legacy receipt は409停止し再課金しない。CAS は production 同様 page row 単位 |
| GET /pages/:id/generation-readiness | PageGenerationReadiness、pageAtomicGeneration route | blocker/warning/price/revision。readiness だけで受付後まで保証しない |
| GET /pages/:id/thumbnail | PageThumbnailService、SharpPageThumbnailRenderer、page route | WebP／ETag／Vary、304 前にも再認証・provenance。private cache を保ちながら秘匿対象は no-store |
| GET /pages/:id | page route／canonical page schema | 所有権、provenance、詳細保存値 |
| GET /page-layout-templates | pageLayout route／template domain | 全19枠、geometry／reading direction／page size |
| GET /entities/reference-generation-availability | entity route | :id より先に literal route、正しい feature capability |
| GET /account/deletion-preview | account route／legacy preview schema | count の控えめな集計、実削除 consent を勝手に補完しない |
| POST /push-tokens | pushTokens route、PushTokenRegistryService | installation/platform/token/locale、no-store、default flag OFF、登録と削除の user lock 順序 |
| DELETE /push-tokens/:installationId | pushTokens route | 本人 scope、204/no-store、実 device token はテスト送信していない |

## 共通契約・runtime 保全

| 項目 | 実装／試験 |
|---|---|
| works/chapters/episodes/entities の expected_updated_at | strict optional request field、millisecond 単調 CAS、storyRevisionCompatibility と entity routes |
| jobs status/type/filter/cursor/error/progress | bounded filters、production canceled wire、旧 cursor 継続、新 cursor 保持、jobCompatibility と reporting integration。実 ledger なしは不明を明示 |
| balance と purchase/restore | subscription_store、scheduled_plan_code/effective_at。Apple sandbox fallback／verified grace、Google deferred/multiline、RTDN subscriptionId/malformed ACK を保全。test billing は許可 user＋期限の既存仕様のみ、実設定は変更なし |
| entity reference candidate organization query | strict organization_id 受理＋実 ownership/provenance 再検証 |
| account deletion acknowledgements | 新旧 strict union。矛盾した混在拒否、旧 blocker 名 adapter、現候補の credit／active-job／削除保護を弱めない |
| episode cross_chapter、旧 pagination | 明示 cross_chapter 保持、works/entities/pages の旧 cursor と現行 cursor の両方を境界検証 |
| layout truncation | 現候補の確認付き機能を保持。旧 false の呼出しを壊さない |
| export route と queue | 旧 route/status/download 保持、専用 queue または既存 shared generation queue、旧 payload と strict v1 の両方。lease／snapshot/provenance 再照合。実 queue が shared なら dedicated poller は起動拒否 |
| push delivery | 既存 encrypted-token／outbox と整合、bounded lease/retry、無効 token／取消／退会の再照合、API 内保守 loop、/me の実 runtime capability による Mobile 登録、logout の旧 token cleanup。秘密は bundle に入れず実 provider を呼ばない |
| deletion recovery | 既に確認された durable request のみ bounded/non-overlap 再開。legacy lifecycle 予約を削除済み扱いしないよう bridge が事前停止 |
| skeleton/editorial | applyStoryPlan=false、旧 client payload 互換、人物画面外・独自枠・immutable numbered guide、既存 text budget／retry／state compiler の保護 |
| schema lineage | productionLineageBridge 26 negative/positive fixtures、38 source SQL の SHA manifest、PG16/18。履歴を番号だけで skip せず正確な filename と schema を照合 |

全 literal route と重点 handler の差分を対象にした対応であり、配布済みストア binary、
外部 gateway、全 endpoint の全 nested response を網羅した形式証明ではない。
実本番の task digest／Cognito／RDS 情報と残ゲートは release-readiness 文書を参照する。
