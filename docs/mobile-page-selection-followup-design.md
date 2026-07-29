# Mobile ページ切替・作品選択の追加修正設計

## 目的と範囲

Mobile のページ編集画面で、保存または破棄を完了した直後に同じ未保存確認が
再表示される問題を解消する。また、作品一覧で選択中の作品が確認できるにも
かかわらず、先行した作品詳細 query の 404 が残って「対象データが見つかりません」
と表示される競合を解消する。

変更対象は `apps/mobile` の dirty state と workspace 選択状態に限定する。
Backend の Route / Service / Repository / Domain / migration は変更しない。

## Spec 根拠

- `docs/Lyra_Unified_Spec_v4.md` 2: 作品、話、ページを選択して編集する主要フロー
- 同 3: Mobile はクライアント層に閉じ、Backend の責務境界を変更しない
- 同 5: 選択中 workspace の organization scope を既存 API 契約どおり維持する
- 同 8: provider error の詳細を露出せず、既存の安全なユーザー向け表示を維持する
- 同 10: Mobile unit test、typecheck、lint、export と既存 release gate を通す
- `docs/mobile_frontend_design.md` 8.1、8.8、10.4、16、30.1

## 原因と設計

### 保存確認の再表示

dirty editor は保存成功後に Provider から削除されるが、画面側の query 更新が
完了する前の再描画で、同じ editor id と同じ draft revision が再登録され得る。

Provider は保存または破棄に成功した revision を一時的に解決済みとして記録する。
同じ revision の再登録は無視し、異なる revision は新しい編集として登録する。
画面が clean になった時点で解決済み記録を解除する。保存中に新しい revision が
作られた場合は、その新しい編集を削除しない。

### 誤った「対象データなし」

保存済み作品 ID がある状態で、作品一覧 query と作品詳細 query が並行すると、
詳細側の 404 が先に残ることがある。その後、一覧に同じ作品が見つかっても、
古い詳細 error を selection 無効化と error 表示に使っていた。

作品一覧が成功し、読み込み済み一覧に対象作品がない場合だけ詳細 query を有効に
する。404 は一覧にも作品がなく、詳細 query が実際に 404 になった場合だけ
selection 無効化に使う。一覧で作品が確認できた場合、過去の詳細 error は表示にも
選択解除にも使わない。chapter query は有効な作品が確定してから開始する。

作品未選択時の retry は、disabled の作品詳細・章・話 query を手動実行しない。
また、ページ保存などの mutation error は React Query 上で次の操作まで残るため、
workspace・作品・話・ページの選択スコープが変わった時点で、過去スコープの
mutation error をリセットする。現在スコープで進行中の query error は隠さない。

## インターフェースとセキュリティ

- API path、request body、response schema、organization query は変更しない。
- 認証 token、organization membership、画像 URL、永続化契約は変更しない。
- dirty revision は端末メモリ内だけで管理し、保存やログ出力を行わない。
- 404 を無条件に無視せず、一覧と詳細の両方で対象が確認できない場合は既存どおり
  selection を解除して安全な再選択を促す。

## テスト方針

1. 保存成功後、同じ revision と新しい callback で再描画しても再確認されない。
2. 破棄成功後も同じ revision が再登録されない。
3. 保存中に別 revision が作られた場合、その新しい編集は残る。
4. 一覧に選択作品がある場合、過去の詳細 404 を selection/error に使わない。
5. 一覧に選択作品がなく詳細も 404 の場合は selection を解除する。
6. 作品未選択時の retry が空 ID の下位 query を実行しない。
7. ページ選択スコープの変更時に過去の mutation error をリセットする。
8. 対象 Mobile test、全 Mobile test、typecheck、lint、Android/iOS export を実行する。

## Terra 委譲

Terra は対象コードを read-only で独立レビューし、競合条件、最小修正、追加テストと
残余リスクを報告する。設計判断、実装、統合、最終レビューは Sol が担当する。
