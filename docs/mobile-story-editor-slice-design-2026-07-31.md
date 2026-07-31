# Mobile Story editor slice design

## 目的と範囲

PR-Fを一括移植せず、現行Mobile基盤へStory閲覧とepisode本文編集・保存を最初の縦sliceとして追加する。UIはpersonal workspaceから開始するが、APIとquery cacheはpersonal / organizationを分離できる契約にする。作品、章、話の階層を選び、話タイトル、ストーリー本文、想定ページ数を編集し、明示的な「保存」で既存Backendへ反映できることを完了条件とする。

このsliceではCharacters / Pages、作品・章・話の作成削除並べ替え、scene編集、Story AI、page skeleton、organization workspace切替、billing、push、外部設定を追加しない。PR #67の巨大なAppState、互換fallback、release機能をまとめて移植しない。

## Spec根拠

- `docs/Lyra_Unified_Spec_v4.md` §2 Product boundary: 作品・章・話を選び、話を書く基本導線
- `docs/Lyra_Unified_Spec_v4.md` §4 Authentication and authorization: personal ownership / organization membership scope
- `docs/Lyra_Unified_Spec_v4.md` §5 Persistence and tenancy: PostgreSQLをsystem of recordとする
- `docs/Lyra_Unified_Spec_v4.md` §8 Input and output safety: bounded inputとschema-validated response
- `docs/Lyra_Unified_Spec_v4.md` §10 Verification gate
- `docs/Lyra_StoryAI_SubSpec.md` §3: current draftの境界。ただし現行episode Routeの8,000文字上限をclient validationの正とする

## 現行監査

- mainのMobileはCognito sessionと`GET /api/me`だけを接続しており、Story UIは存在しない。
- canonical generated contractにはwork / chapter / episode response schemaが既にあるが、`LyraMobileApiClient`はまだそれらを公開していない。
- Backendは`GET /api/works`、`GET /api/works/:id/chapters`、`GET /api/chapters/:id/episodes`、`PUT /api/episodes/:id`を認証・ownership / membership scope・Zod validation付きで提供する。
- PR #67のStoryScreenはorganization、scene、Story AI、dirty editor registry、pagination、全AppStateへ同時依存するため、そのまま移植するとPR-F以外の責任が混ざる。

## UIと状態設計

- 認証後画面にStory / Accountの小さなMobile navigationを置き、既存Account表示とlogoutを保持する。
- Storyはwork、chapter、episodeの順にユーザーが明示選択する。親選択が変わったら子選択をresetする。
- 0件は正常なempty stateとして表示し、error bannerを出さない。通信・認証・invalid responseだけをerrorとして再試行可能にする。
- episodeを選ぶと保存済み値からdraftを初期化する。server queryの再取得だけでdirty draftを上書きしない。
- 編集対象はtitle、表示用に結合したstory本文、`estimated_pages`。structured episodeでは本文を編集しないtitle / page数だけの保存にstory fieldを含めず、非表示のintroduction / middle / climax / ending_hookとmodeを保持する。本文を変更したときだけ`story_input_mode: full`と`story_full_draft`を送り、未編集のpurpose / entities / status等を暗黙に消さない。
- titleは200文字、storyは8,000文字、estimated pagesは1〜32をclientでも検証する。空title / storyはBackend契約どおり`null`へ変換する。
- 「保存」はStory AI予定領域より前に置く。Story AIは今回未接続であることを説明するだけで、動かない生成buttonを置かない。
- work / chapter / episode切替、StoryからAccountへの移動、logoutでdirtyなら「保存して移動 / 保存せず移動 / キャンセル」を解決する。保存失敗時は現在のdraftと選択を保持する。

## APIインターフェース

- `GET /api/works?limit=50`: `worksResponseSchema`で検証し、next cursorは将来のload-moreに保持する。
- `GET /api/works/{workId}/chapters`: `chaptersResponseSchema`で検証する。
- `GET /api/chapters/{chapterId}/episodes`: `episodesResponseSchema`で検証する。
- `PUT /api/episodes/{episodeId}`: bounded payloadを送り、`episodeSchema`で検証する。
- すべて既存ID token、401時1回refresh、15秒timeout、安全な`ApiError`変換を共通request helperで使う。raw response bodyやserver detailをユーザーへ返さない。
- UIはpersonal scopeだけを渡す。API clientは将来のorganization UIで別実装を増やさないよう、任意の`organization_id` queryを4 endpointで一貫して扱う。
- React Query keyはsession、personal / organization scope、親resource IDを含め、logout時のclearに加えて利用者・tenant間のcache混在を構造的に防ぐ。

## 影響レイヤーと安全性

- Mobile domain: episode draft変換・validation・dirty比較の純粋関数。
- Mobile API:既存clientへread/update methodを追加する。generated schemaは編集しない。
- Mobile UI: Story screenと認証後navigation。Backend / Worker / Web / migration / credit / queueは変更しない。
- IDは選択済みserver responseだけから使い、任意のuser / organization ID入力欄を作らない。
- PUT成功後だけquery cacheと保存済みsnapshotを更新する。失敗時に楽観的な保存済み扱いをしない。

## TDDと検証

実装前に次の失敗テストを追加する。

- API clientが正しいpath / method / bodyを使い、canonical schema外の成功payloadを拒否する。
- draft変換が空文字をnullへし、200 / 8,000 / 1〜32境界を守り、未変更判定を安定させる。
- Story user flowが正常empty stateとerrorを区別し、episode選択・編集・保存を実行する。
- 保存buttonがStory AI案内より前にあり、dirty切替でsave / discard / cancelを区別する。
- 保存失敗ではdraftと選択を保持し、再試行できる。

focused Mobile testsをred確認後に実装し、Mobile contract check / dependency check / doctor / typecheck / lint / full tests / Android・iOS export、Backend Vitest / Bun / build、Web lint / build / Playwrightを最終gateとする。

## Sol / Terra

SolがAPI境界、dirty UX、統合判断、最終検証を所有する。TerraにはPR #67 Story依存グラフと現行contractとの差分をread-onlyで監査させ、ファイル移植、dependency追加、Git操作、設計判断は委譲しない。
