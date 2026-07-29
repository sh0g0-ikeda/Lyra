# 作品・章・話ツリーナビゲーション設計

## 1. 目的

Story 画面の作品・章・話の管理を、VS Code のディレクトリツリーに近い階層型ナビゲーションへ置き換える。

この変更では次を実現する。

- 左側で `作品 > 章 > 話` の親子関係を一目で確認できる。
- 作品と章を折りたためる。
- 作品の直下に章を、章の直下に話を追加できる。
- 作品名、章名、話名を鉛筆アイコンから変更できる。
- 章と話を上下に並び替えられる。
- 話を章境界をまたいで移動できる。
- 話の削除前に確認を出す。

バックエンド、生成ジョブ、StoryAI、ページ骨格生成、話全体反映の契約は可能な限り変更しない。

## 2. 根拠と対象範囲

根拠は `docs/Lyra_Unified_Spec_v4.md` の次の契約とする。

- Section 2: Lyra は work、chapter、episode を階層管理する。
- Section 3: HTTP、業務処理、永続化の責務を Route / Service / Repository に分離する。
- Section 4-5: personal ownership または active organization membership で必ずスコープする。
- Section 10: backend、web、認可、DB invariant を含む検証を行う。

### 対象

- Web の左サイドバーにある作品選択 UI
- 既存の「章と話」管理 UI
- 作品・章・話の追加、名称変更、並び替え、話削除
- 話の章境界移動に必要な最小限の API 拡張

### 対象外

- StoryAI や prompt compiler の変更
- ページ、シーン、キャラクター、生成ジョブのデータ構造変更
- ドラッグアンドドロップ
- 作品を別ワークスペースへ移す機能
- 章を別作品へ移す機能
- DB migration

## 3. UI 構成

### 3.1 左ツリー

左サイドバーの作品一覧を、次の階層に変更する。

```text
作品                                             +
v 作品A                                      編集 章追加
  v 第1章 はじまり                         上 下 編集 +話
      第1話 出会い                         上 下 編集 削除
      第2話 対立                           上 下 編集 削除
  > 第2章 転換                             上 下 編集 +話
> 作品B                                      編集 章追加
```

- 作品行は work、章行は chapter、話行は episode を表す。
- 行全体を選択領域にし、選択中の行だけ背景色と左アクセントで示す。
- chevron は展開・折りたたみだけを行う。
- タイトル部分は対象を選択する。
- 長いタイトルは一行省略し、hover tooltip で全文を表示する。
- 操作アイコンは行の hover、focus、選択時に表示する。
- タッチ端末では secondary actions を `...` メニューにまとめ、タップ領域を 36px 以上にする。
- ネストしたカードにはせず、インデントとガイド線で階層を示す。

使用するアイコンは既存の Lucide 系に合わせる。

- 展開: `ChevronRight` / `ChevronDown`
- 作品: `BookOpen`
- 章: `Folder` / `FolderOpen`
- 話: `FileText`
- 追加: `Plus`
- 改名: `Pencil`
- 移動: `ArrowUp` / `ArrowDown`
- 削除: `Trash2`

### 3.2 初期展開と状態保持

- 選択中の作品と、その話を含む章は必ず展開する。
- その他の作品・章は前回の開閉状態を復元する。
- 開閉状態はブラウザの localStorage に保存し、DB には保存しない。
- storage key は `user/auth session + personal/organization workspace` で分ける。別ワークスペースの ID を流用しない。
- 削除済み ID は、データ再取得時に開閉状態から除去する。

### 3.3 既存中央 UI の整理

現在の大きな「章と話」管理フォームは削除し、階層操作を左ツリーへ集約する。

ただし、次の機能は中央の選択中エピソード領域に残す。

- ページ骨格生成・上書き再生成
- 話全体を反映
- 話本文、ページ数、登場人物など話固有の編集項目
- 実行中ジョブと進捗表示

作品概要も既存どおり中央に残す。ツリーの鉛筆は名称だけを更新し、概要の保存処理とは分離する。

これにより、UI の配置だけを変え、生成 pipeline に渡る保存済みデータと実行順序は変えない。

## 4. 操作仕様

### 4.1 追加

#### 章追加

1. 作品行の `+` を押す。
2. 作品直下に一行の入力欄を表示する。
3. Enter または check アイコンで作成し、Escape または cancel アイコンで中止する。
4. 作成後、その作品を展開し、新しい章を選択する。

#### 話追加

1. 章行の `+` を押す。
2. 章直下に一行の入力欄を表示する。
3. Enter または check アイコンで作成する。
4. 作成後、その章を展開し、新しい話を選択する。

既存 create API は `order` を必要とするため、展開時に取得した兄弟一覧の最大 order + 1 を送る。競合による 409 の場合だけ一覧を再取得し、最新の末尾 order で一度だけ再試行する。無制限 retry は行わない。

手動の order 入力欄は UI から削除する。

### 4.2 名称変更

- 作品、章、話の鉛筆アイコンを押すと、その行だけ inline input へ切り替える。
- Enter/check で保存、Escape/cancel で元に戻す。
- blur だけでは保存しない。意図しない更新を防ぐ。
- 1-200 文字に制限する。
- API には `{ title }` だけを送る。画面上の古い draft 全体を送らない。
- ID、選択状態、子要素は維持される。

既存の partial update API をそのまま使う。

- `PUT /works/:id`
- `PUT /chapters/:id`
- `PUT /episodes/:id`

### 4.3 章の並び替え

- 章行の上下アイコンで、同じ作品内の隣接章と入れ替える。
- 章を動かすと、その章に属する話も一緒に表示位置が変わる。
- 先頭章の上、末尾章の下は disabled にする。
- 既存の `POST /chapters/:id/move` を変更せず使う。

### 4.4 話の並び替え

話の並び順は、`章 order -> 話 order` の順に平坦化したものとして扱う。

#### 同じ章の中

- 隣の話と入れ替える。
- 既存の move 処理をそのまま使う。

#### 章境界をまたぐ場合

- 章の最後の話を下へ移動すると、直後の章の最初の話になる。
- 章の最初の話を上へ移動すると、直前の章の最後の話になる。
- 移動先の章が空なら order 1 になる。
- 移動元が空になっても章は削除しない。
- 次または前の章が存在しない場合はボタンを disabled にする。
- 移動後も episode ID は変えず、ページ、シーン、コマなど episode 配下のデータを維持する。
- 選択中の話を移動した場合、移動先の章を展開して選択を維持する。

### 4.5 話削除

- 話行の削除アイコンを押すと、既存の localized confirm helper で確認する。
- 日本語文言は次を基準とする。

```text
話「{title}」を本当に削除しますか？
この話に紐づく編集データも削除され、元に戻せません。
```

- cancel では API を呼ばない。
- 削除後は、次の話、前の話、話なしの順で安全な選択状態へ移る。
- 既存の `DELETE /episodes/:id` を使う。

既存の章削除機能は失わないよう、章行の `...` メニュー内に残し、同様に確認を必須にする。作品削除は今回追加しない。

## 5. データ取得設計

### 5.1 Query 構成

- works は現状どおり workspace 単位で取得する。
- chapters は展開された work だけ取得する。
- episodes は展開された chapter だけ取得する。
- 選択中の祖先は常に展開対象なので、現在の編集画面に必要な query は失われない。
- React hook の呼び出し順を壊さないため、work node と chapter node を小さな子 component に分離し、それぞれで query を持つ。

想定 component:

```text
StoryHierarchyTree
  StoryWorkNode
    StoryChapterNode
      StoryEpisodeRow
```

### 5.2 Cache 更新

- work 改名: works query を invalidate
- chapter 追加・改名・移動: 対象 work の chapters query を invalidate
- episode 追加・改名・削除・同一章移動: 対象 chapter の episodes query を invalidate
- episode の章境界移動: source と destination の episodes query、および対象 work の chapters query を invalidate

境界移動 API の戻り値は既存と同じ `EpisodeRecord` とし、更新後の `chapter_id` を destination として使う。呼び出し前の record から source を保持できるため、新しい response wrapper は不要である。

## 6. 最小バックエンド変更

章境界移動だけは frontend-only にしない。現在の episode update schema は `chapter_id` を受け付けず、既存 move は同一章内だけを対象にするためである。

frontend で episode を削除して移動先へ作り直す方法は、episode ID が変わり、配下の scene、page、panel、生成履歴を失うため禁止する。また、通常の update API に任意の `chapter_id` を追加する方法は、別 work や別 tenant を指定できる攻撃面を広げる。移動先を backend が隣接章として決定する専用動作が、変更範囲と認可リスクの両方を最小にする。

### 6.1 変更が不要な操作

次は既存 API だけで実現する。

- 折りたたみ
- 作品、章、話の選択
- 章、話の追加
- 作品、章、話の改名
- 章の上下移動
- 同一章内の話の上下移動
- 話削除と削除確認

### 6.2 必要な変更

章境界をまたぐ話移動だけ、既存 endpoint を後方互換で拡張する。

```http
POST /episodes/:id/move
Content-Type: application/json

{
  "direction": "down",
  "cross_chapter": true
}
```

- `cross_chapter` は optional boolean、既定値 false とする。
- 既存 caller の `{ "direction": "up|down" }` は今までどおり同一章内だけを移動する。
- 同一章に隣の話があれば、flag に関係なく既存 swap を使う。
- 同一章に隣がなく、flag が true の場合だけ隣接章へ移す。
- 隣接章がなければ、既存仕様と同じく現在の episode を変更せず返す。

### 6.3 Transaction

Repository は一つの transaction 内で次を行う。

1. 認可スコープ付きで current episode、current chapter、work を取得する。
2. work row を先に lock し、その work 内の hierarchy reorder を直列化する。
3. direction から同じ work 内の直前または直後の chapter を解決する。
4. source/destination chapter と両方の episode rows を安定した順序で lock する。
5. current episode を一時 order へ退避する。
6. source の order を 1 から連番へ詰め直す。
7. destination が次章なら既存話を一つ後ろへずらし、current を order 1 にする。
8. destination が前章なら current を末尾 order にする。
9. current episode の `chapter_id` と `order` を更新する。
10. 更新後の Episode を返す。

unique constraint と衝突しないよう、並べ直しは一度十分に離れた temporary order range へ退避してから確定値へ戻す。episode を delete/create してはならない。

### 6.4 認証・認可

- route は現在と同じ authenticated user と `edit_work` capability を要求する。
- destination chapter ID をブラウザから受け取らない。サーバーが同じ work の隣接章を解決し、IDOR を避ける。
- personal work から organization work、別 organization、別 work への移動を禁止する。
- organization 操作では source chapter、destination chapter、direction を audit metadata に残す。

## 7. 実装ファイル境界

想定変更先は次のとおり。

### Web

- `apps/web/src/App.tsx`: 既存選択状態との接続、重複した章・話フォームの撤去
- `apps/web/src/components/StoryHierarchyTree.tsx`: 新しいツリー本体
- `apps/web/src/lib/api.ts`: move の optional flag
- `apps/web/src/index.css`: compact tree、indent、active、mobile overflow
- `apps/web/src/lib/uiI18n.ts` または既存 translation map: 新規文言
- `apps/web/e2e/app.spec.ts`: 実操作 smoke

### Backend

- `src/lib/validators/story.schema.ts`: `cross_chapter` optional boolean
- `src/routes/story.ts`: flag の受け渡しと audit metadata
- `src/services/story/StoryService.ts`: optional flag の受け渡し
- `src/repositories/StoryRepository.ts`: 章境界 transaction
- 関連する port/type: method signature の optional argument

DB schema、migration、LLM infrastructure、worker、generation_jobs は変更しない。

## 8. 動作シミュレーション

### ケース A: 通常選択

1. works を取得する。
2. 保存済み selected work を展開する。
3. その work の chapters を取得する。
4. selected chapter を展開する。
5. その chapter の episodes を取得する。
6. episode を選ぶと、現在と同じ episode editor と生成操作を表示する。

生成 API へ渡す episode ID は変わらない。

### ケース B: 第1章末尾の話を下へ移動

1. UI は全体順で次に第2章が存在するため down を有効にする。
2. `{ direction: 'down', cross_chapter: true }` を送る。
3. backend が同じ work の第2章を解決する。
4. 一 transaction で第1章から外し、第2章 order 1 に移す。
5. response の `chapter_id` を使って第2章を展開する。
6. source/destination query を再取得する。
7. episode ID が同じため、本文、ページ、生成履歴は維持される。

### ケース C: 話の改名中に cancel

1. pencil で title input を表示する。
2. Escape/cancel を押す。
3. API は呼ばず、query cache 上の元タイトルへ戻す。

### ケース D: 話削除をキャンセル

1. trash を押す。
2. 確認で cancel する。
3. DELETE は呼ばず、選択状態も変えない。

## 9. テスト計画

### Backend unit/integration

- flag 省略時は章境界を越えない。
- 同一章内の move は従来どおり隣接 swap になる。
- 末尾話の down は次章 order 1 になる。
- 先頭話の up は前章末尾になる。
- 空の移動先でも order 1 になる。
- 移動元が空になっても章が残る。
- 隣接章がなければ no-op になる。
- episode ID と配下データが維持される。
- 別 work、別 organization、inactive member へ移動できない。
- order unique constraint が壊れない。
- organization audit に移動元・移動先が残る。

### Frontend

- work/chapter の展開と折りたたみ。
- 展開した node だけ children を取得する。
- 追加後に新規 node が選択される。
- rename が title-only payload を送る。
- delete cancel では API を呼ばない。
- delete confirm 後に安全な隣接話を選ぶ。
- 同一章 move と章境界 move で正しい cache を invalidate する。
- chapter move で子 episode の所属が変わらない。
- 日本語・英語の文言が正しく切り替わる。
- 1440px desktop と 390px mobile でタイトルや操作が重ならない。

### Verification gate

```text
npm test
npm run build
npm run web:lint
npm run web:build
npm run db:check-invariants
npm run web:e2e
```

## 10. Rollout と rollback

1. 後方互換な backend API 拡張を先に deploy する。
2. backend smoke で従来 move と cross-chapter move を確認する。
3. tree UI を deploy する。
4. personal と organization の両方で追加、改名、移動、削除を確認する。

frontend を rollback しても、optional flag を使わない旧 UI は従来どおり動く。DB migration がないため schema rollback は不要である。新 UI 導入後も episode ID を保存したまま移動するため、生成 pipeline のデータ互換性は維持される。

## 11. 受け入れ条件

- 左ツリーだけで作品・章・話の所在と順番が分かる。
- work と chapter を独立して折りたためる。
- manual order input を使わず追加と並び替えができる。
- work/chapter/episode を鉛筆から改名できる。
- 章末の話を下へ動かすと次章先頭へ移る。
- 話削除前に明示的な確認が出る。
- 話を章移動しても pages/scenes/panels/generation history が失われない。
- personal と organization の tenant boundary を越えない。
- StoryAI、ページ骨格、話全体反映、画像生成の request contract に差分がない。
- 展開していない全作品の children を一括取得せず、初期表示の API 負荷を増やさない。

## 12. Mobile integration

Mobile uses the same hierarchy and move contract in a full-screen modal sheet.
The selected episode appears in a compact Story header. Work and chapter nodes
own their child queries so collapsed nodes are not fetched. Node menus expose
rename/add/move/delete actions with 44-point targets; destructive actions use
the shared confirmation helper. The existing Story editor keeps hidden legacy
fields in state and payload while the tree becomes the only visible hierarchy
selector.

Mobile tests are written first for tree selection, collapsed-query behavior,
menu actions, title-only rename payloads, and cross-chapter move flags. Sol owns
the Mobile component and screen integration while Terra owns only the disjoint
Backend move transaction.
