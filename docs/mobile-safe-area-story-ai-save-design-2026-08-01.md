# Mobile 階層UI・StoryAI保存同期修正設計（2026-08-01）

## 目的と範囲

Mobileで次の3症状を解消する。

1. 作品・章・話の階層UIにある章操作メニューと話追加ダイアログがAndroidのホーム／ナビゲーション領域へ重なる。
2. 保存済みの話に対してStoryAIを実行すると、古い更新時刻を使った不要な再保存が走り、競合として失敗し得る。
3. 保存APIが成功しても一覧queryの保存済み基準が直ちに更新されず、未保存変更の確認が繰り返され得る。

変更対象はMobileの表示領域、episode/scene query cache同期、StoryAI実行前の保存判定、回帰テストに限定する。Route、Service、Repository、Worker、DB、LLM prompt、生成job、認証・認可、API payload schemaは変更しない。

## Spec根拠

- `docs/Lyra_Unified_Spec_v4.md` §2: 話を編集しStoryAIを利用する主要フロー。
- 同 §5: 保存済みデータとMobile clientの整合を維持すること。
- 同 §6: StoryAIを含むgeneration flowで重複処理や不整合を作らないこと。
- 同 §8: 失敗時も安全な入力と利用者向けエラーを維持すること。
- `docs/Lyra_StoryAI_SubSpec.md` §3–4: 現在の話draftを入力とし、失敗時に保存本文を暗黙に上書きしないこと。

## 原因

### 階層UI

`StoryHierarchySheet`のfull-screen root、章操作メニュー、話追加／名称変更ダイアログはSafe Area wrapperを持たない。nested modalは`justifyContent: 'flex-end'`で端末の物理下端へ配置されるため、Androidのgesture/navigation領域と最下部ボタンが重なる。

### 保存状態とStoryAI

episode保存成功後はquery invalidationだけに依存し、APIが返した最新recordをcacheへ即時反映していない。その間、dirty判定は古いepisode recordを保存済み基準として使い続ける。さらにStoryAI改善処理はdirtyでない場合もepisodeを再保存し、古い`expected_updated_at`で409競合を起こし得る。

## 設計

- `StoryHierarchySheet`のrootと2つのnested modalを`SafeAreaView`で囲み、top/bottom inset内へ配置する。dismiss、accessibility、keyboard、表示順は維持する。
- episode/sceneの保存APIが返す最新recordを、既存query responseの該当IDへ同じshapeのまま置換する。続いてinvalidateしてserverを再確認する。
- StoryAI改善前のepisode保存は、episodeがdirtyの場合だけ既存update mutationを通して行う。cleanなら再保存せずStoryAI requestへ進む。
- dirtyの場合の入力検証、stale resource表示、保存失敗時の中断は維持する。
- query key、payload、response schema、永続化構造を変更しない。

## 影響レイヤー

- Mobile UI: `StoryHierarchySheet`。
- Mobile state/query: `StoryScreen`と純粋なquery reconciliation helper。
- Mobile tests: Safe Area、cache同期、StoryAI保存判定。
- Backend / Web / DB / Worker / Infrastructure: 変更なし。

## セキュリティ

- API呼び出し、Bearer token、organization scope、ownershipを変更しない。
- `expected_updated_at`を外さず、dirtyな保存では競合防止を維持する。
- cache更新はAPIが認証・検証して返した同一IDのrecordだけを使う。
- raw provider errorや内部情報を新たに表示しない。

## TDDと検証

1. 階層root、章menu、話追加dialogがtop/bottom Safe Area内にあることを表すテストを先に追加し、現行実装で失敗確認する。
2. API成功recordがepisode/scene一覧の同一IDだけを置換する純粋テストを先に追加する。
3. cleanなepisodeではStoryAI前の保存を要求せず、dirtyなepisodeだけ保存するpolicyテストを先に追加する。
4. Mobile全test、typecheck、lint、contract、mojibake、Android/iOS exportを実行する。
5. PRのクリーンCI成功後だけmainへ統合し、そのmainと同一treeからEAS Android previewを作る。

## Sol / Terra分担

- Terra 1: Safe Area欠落箇所と既存patternをread-only調査。
- Terra 2: StoryAIとdirty/save lifecycleをread-only調査。
- Sol: 設計、TDD、実装、結果レビュー、統合、EAS buildを担当する。
