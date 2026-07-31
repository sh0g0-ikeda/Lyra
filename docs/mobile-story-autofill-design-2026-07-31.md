# Mobile Story 自動入力 slice 設計

## 目的と範囲

Mobile の Page 画面に「ストーリーから設定を自動入力」を追加する。保存済みの話と任意の Scene を、既存の編集可能な Page / Panel 設定へ反映する既存の非同期ジョブだけを接続する。

この slice では Backend、Worker、DB、credit、Page / Panel 個別編集、画像生成、job cancel、骨格の上書き再生成を変更しない。ページ骨格生成からの自動連鎖も行わない。

## Spec 根拠

- `docs/Lyra_Unified_Spec_v4.md` section 2: 骨格生成後に story を編集可能な panel field へ明示的に反映する。
- section 6: skeleton / story autofill の active uniqueness、正確な job 監視、atomic persistence、fingerprint 再検証、部分反映禁止。
- sections 7–8: text AI は 0 credit、bounded schema、raw provider error 非表示。
- section 10: Mobile の近接テストに加え、共有 release gate を通す。
- `docs/Lyra_StoryAI_SubSpec.md` sections 5–8: story-to-pages 品質境界、Scene は任意、失敗時に actionable な安定文言を表示する。

## 影響レイヤーとインターフェース

- Mobile API: `POST /api/episodes/:episodeId/autofill-pages-from-story`、body `{ language: 'ja' | 'en' }`、organization query を維持、成功は strict な `{ job_id }`。
- Mobile UI: `PagePlanningSection` に骨格生成とは別の明示操作を置く。
- Mobile state: PR #141 の single-flight、dirty Scene 解決、job history 復元、exact job polling、foreground 復帰を共有する。
- 永続化・外部 API・queue: 変更なし。Mobile は optimistic update を行わず、terminal 後に Page / Episode / job history を再取得する。

## 安全な開始条件

次の条件をすべて満たす場合だけ開始できる。

- episode が選択済みで Page 取得が成功し、1件以上ある。
- 全 Page に frame があり、panel count と一致する。
- `confirmed` または `generating` の Page がない。
- 同じ episode の `episode_page_skeleton` / `episode_story_autofill` active job がない。
- job history が loading、fetching、error でない。
- dirty Scene は既存の保存 / 破棄 / 中止で解決済み。保存失敗なら送信しない。

既存の編集可能な Page / Panel 設定が更新されることを操作の直前に説明する。骨格と Page 数、identity、order、panel count は Mobile から変更しない。

## job とエラー

- POST が返した正確な job ID を追跡し、別 ID や別 episode / job type の response を拒否する。
- `queued` / `processing` 中は Scene の追加・保存、骨格生成、自動入力の重複開始を止める。
- completed / failed / cancelled の文言は job type ごとに分ける。`error_message`、compiler detail、progress message は表示しない。
- exact job の一時通信失敗では同じ ID と lock を維持する。404 は tracking を解除して関連 query を再取得する。
- POST の失敗時は job history を再取得する。受付後に response だけ失われた可能性があるため、復元した active job があれば監視へ移り、なければ安定した再試行案内を出す。
- cancel UI は server capability の明示契約がないため、この slice では追加しない。

## セキュリティ確認

- episode ID と organization ID は既存の authenticated API scope を通す。
- language は UI enum のみを送信し、success response は生成済み Zod schema で検証する。
- provider / worker の raw error、stack、prompt、credential を表示しない。
- credit path、billing state、migration、queue payload を変更しない。

## TDD と検証

先に以下の失敗テストを追加する。

- API path / body / organization scope / strict `{ job_id }`。
- Page なし、load error、frame 不足、panel mismatch、confirmed、generating、active job、history 不健康時の開始拒否。
- dirty Scene の保存 / 破棄 / 中止 / 保存失敗。
- single-flight、正確な job ID、history 復元、terminal / 404 / network、raw error 非表示。
- 既存 skeleton request の `overwrite_existing:false` / `apply_story_plan:false` と既存 Page 保護の回帰。

実装後は Mobile test / typecheck / lint / dependency check / doctor / Android・iOS export を通し、共有契約に触れるため Unified Spec section 10 の full gate も exact commit で確認する。

## Terra 監査

既存 read-only 監査は、この境界で Backend変更なしに接続可能と判定した。追加推奨として `generating` Page と frame / panel 不整合を事前に止め、POST後の通信失敗では history を照合する。設計・統合判断と最終検証は Sol が担当する。
