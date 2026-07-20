# 作品・章・話ツリーナビゲーション設計

## 目的と範囲

Story 画面の作品・章・話管理を、左サイドバーの階層ツリーへ集約する。作品と章は折りたため、各行から追加、改名、並び替え、話の削除を行えるようにする。

`docs/Lyra_Unified_Spec_v4.md` の work > chapter > episode 契約、Route / Service / Repository の責務分離、personal ownership / organization membership の認可境界を維持する。StoryAI、prompt compiler、生成ジョブ、ページ・シーン・キャラクターのデータ構造は変更しない。DB migration も追加しない。

## UI 契約

- 左側を `作品 > 章 > 話` のツリーにする。
- 作品と章の開閉状態は、認証セッションとワークスペースごとに localStorage へ保存する。
- 選択中の作品と章は常に展開する。
- 作品行から章を、章行から話を末尾へ追加する。order の手入力は廃止する。
- 作品、章、話は鉛筆アイコンから名称だけを inline 編集する。Enter で保存、Escape で中止する。
- 章は同一作品内で上下移動する。
- 話は全体順 `章 order > 話 order` に従って上下移動する。章末の話を下へ動かすと次章先頭、章先頭の話を上へ動かすと前章末尾へ移る。
- 話の削除は確認後に実行し、配下データも削除されることを明示する。
- 既存の章削除機能は確認付きでツリー上に残す。
- 中央の大きな章・話管理フォームは外し、ページ骨格生成、話全体反映、話本文など生成パイプラインに必要な編集 UI は維持する。

## データ取得

- works は従来どおりワークスペース単位で取得する。
- chapters は展開中または選択中の work だけ取得する。
- episodes は展開中または選択中の chapter だけ取得する。
- React Query の既存 query key を共有し、選択中エディタとツリーで重複リクエストを発生させない。
- 改名は title-only の partial PUT を使い、古い draft 全体を送らない。

## 最小バックエンド変更

既存 `POST /episodes/:id/move` を後方互換で拡張する。

```json
{
  "direction": "down",
  "cross_chapter": true
}
```

- `cross_chapter` は optional で既定値 false。既存 caller の挙動は変えない。
- 同一章内に移動先があれば従来どおり隣接 swap を行う。
- 同一章内に移動先がなく、flag が true のときだけ、サーバーが同一 work 内の隣接章を解決する。
- destination chapter ID はクライアントから受け取らず、IDOR と tenant 越境を防ぐ。
- episode ID は変更せず `chapter_id` と order だけを transaction 内で更新し、pages、scenes、panels、生成履歴を維持する。
- personal ownership または active organization の `edit_work` capability を従来どおり要求する。

## キャッシュ更新

- work 改名: works query
- chapter 追加・改名・移動・削除: 対象 work の chapters query
- episode 追加・改名・削除・同一章移動: 対象 chapter の episodes query
- episode 章境界移動: source / destination の episodes query。章自体の metadata は変わらないため chapters query は再取得しない。

## テスト

### Backend

- flag 省略時は章境界を越えない。
- 同一章内の従来 move が維持される。
- 章末 down、章先頭 up、空章への移動、端での no-op が正しい。
- episode ID と配下データが維持され、order invariant が壊れない。
- 別 work / organization へ越境できない。

### Web

- ツリーの開閉、追加、title-only 改名、並び替え、削除確認を確認する。
- 章境界移動後も選択中の話が維持され、移動先章が展開される。
- 日本語・英語、desktop、390px mobile で表示が破綻しない。

### Verification gate

```text
npm test
npm run build
npm run web:lint
npm run web:build
npm run db:check-invariants
npm run web:e2e
```

## Rollout / rollback

optional flag の backend 拡張は旧 UI と互換性がある。新 UI を rollback しても旧 caller は `{ direction }` のまま動作する。DB migration がなく、episode ID も変えないため、schema rollback と生成データ移行は不要である。
