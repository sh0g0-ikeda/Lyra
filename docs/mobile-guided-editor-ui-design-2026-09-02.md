# Mobile 制作導線 UI 改善設計（2026-09-02）

## 目的と範囲

初めて使う利用者が、ストーリー入力、キャラクター保存、プレビュー生成・確定、ページ編集の順番を画面内の文言だけで理解できるようにする。

- Story / Characters / Pages の見出しと説明を、利用者の次の行動が分かる名称へ変更する。
- ストーリー保存後、キャラクター保存後、プレビュー生成後、プレビュー確定後に、ポップアップではない案内を表示する。
- Characters の進行に不要な集計カードを削除する。
- Guide を現行 UI と所要時間に合わせ、変更後の名称へ統一する。
- 共通 `Screen` 上部に既存の日英切替が全対象画面で表示される契約を維持する。
- ローカル検証、コミット、push、PR の後、ストア提出用ではない Android preview APK を EAS で作成し、レビュー用ビルドページを提示する。

この変更では、Backend API、DB、migration、認証・認可、organization scope、クレジット、画像 upload、生成 payload、ジョブ実行・取消、Web UI、iOS / Android のストアリリースを変更しない。ストアリリースは利用者が APK を承認した後の別工程とする。

## Spec 根拠

- `docs/Lyra_Unified_Spec_v4.md` 2章: Story -> confirmed character preview -> page planning という主要制作フローを、画面内の案内として明確にする。
- 同3章: 変更は `apps/mobile` の presentation / domain helper に限定し、Route / Service / Repository / Infrastructure の境界を変えない。
- 同6章: episode autofill の既存ジョブ状態と再試行契約を変えず、Guide には最大約20分の目安だけを表示する。
- 同8章: raw provider error や秘密情報を新たに表示しない。
- 同10章: Mobile の対象テスト、全テスト、typecheck、lint、contract、mojibake、Android export を通してから APK を作る。
- `docs/Lyra_StoryAI_SubSpec.md` 4・5章: AI 改善は明示適用、シーンは任意、ストーリーからページ・コマへ進む現行契約を名称変更後も正しく案内する。

## 影響レイヤーと表示契約

- Mobile Screen:
  - Story の入力欄見出しを「まずはストーリーを入力」、AI セクションを「AIでストーリーを改善」、任意シーン設定を「背景や時間帯の設定」にする。
  - Characters の参照画像セクションを「作成したキャラのプレビュー」にし、状態・メイン・画像数、および画像取り込み直下の必須・推奨入力・参照画像集計を削除する。
  - Pages の一覧説明、コマ設定の見出し・説明、「流れの概要」を指定文言へ変更する。
- Mobile Domain helper:
  - Story は、話が選択済み、本文が空でない、未保存差分がない場合に次のキャラクター設定を案内する。
  - Character は、保存済みキャラがない場合やプレビュー状態の初回読込中は案内しない。生成中は重複操作を促さない。候補画像があれば「確定」、確定済み画像があれば Pages、どちらもなければプレビュー生成を案内する。通常は未保存差分があると次工程を案内しないが、画像取り込みで候補と入力候補が同時反映された場合も確定直後の Pages 案内だけは表示し、既存の dirty-state 保存確認は維持する。
- i18n:
  - すべて日本語・英語の対で追加・変更する。画面内に language 分岐の直書きを追加しない。
- Guide:
  - Story の旧 step 2 と Characters の旧 step 4 を削除する。
  - ページ自動入力には「20分程度かかる場合がある」と明記する。
  - 非表示の複数ページ export を案内せず、現在使える個別画像保存を案内する。

## インターフェース

- 入力: 現在選択中の episode / entity、ローカル dirty 状態、active preview job、プレビュー状態の読込完了、未確定候補画像、直前の確定結果、確定済み画像数、UI language。
- 出力: 翻訳済みの見出し、補足説明、次工程の `Notice`。
- 永続化・外部 API・ジョブ: 変更なし。案内は既存 query / mutation の結果だけから算出する。
- エラー: 既存の安定した user-facing error を維持し、案内をエラー表示の代用にはしない。

## セキュリティと信頼性

- 認証 token、storage key、provider response、raw error を案内へ含めない。
- 既存の upload MIME / size 検証、organization scope、credit blocker、active-job blockerを変更しない。
- 案内は保存や生成を自動実行せず、既存ボタンによる明示操作を維持する。
- プレビュー生成中に再生成を促す案内を表示せず、二重実行防止を崩さない。

## TDD と検証方針

1. 先に domain test へ Story / Character の案内状態表を追加し、helper 未実装で RED を確認する。
2. 先に Mobile UI contract test へ指定見出し・説明、不要集計の不在、Guide の step 数と名称、共通言語切替の維持を追加し、RED を確認する。
3. 最小実装後、対象テスト、Mobile 全テスト、typecheck、lint、contracts、mojibake、Expo dependency check / doctor、Android export を実行する。
4. 変更差分と既存 API inventory を確認し、Backend / DB / Web に差分がないことを確認する。
5. PR 作成後に EAS `preview` profile で APK を作成する。成功した build ID / commit / artifact page を照合して提示し、ストア release / submit は行わない。

## Terra 委譲

- Terra explorer: 現行 Story / Characters / Pages / Guide の表示契約を read-only 監査し、指定変更の漏れと既存テスト影響を報告する。
- Terra worker: RED 確認後、Guide と日英 screen translation catalog の限定ファイルだけを更新する。
- Sol: domain state、3画面の統合、不要 UI 削除、Terra 差分レビュー、全検証、Git / PR / APK を担当する。
