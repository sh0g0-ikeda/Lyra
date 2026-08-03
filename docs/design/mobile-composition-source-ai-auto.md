# モバイル構図ソースを AI 自動に固定する設計

## 目的と範囲

モバイルのページ編集画面から「構図ソース」選択とギャラリー構図選択を取り除く。モバイルで意図的にコマを保存する場合は、既存の `PanelRecord` 契約の `composition.source` を常に `ai_auto`、`gallery_item_id` を常に `null` として送る。

既存レコードの移行、API・DB・worker・Web UI の変更は行わない。過去に `gallery` または `custom` で保存されたコマを閲覧しただけでは保存確認を発生させず、既存レコードも変更しない。

## 仕様根拠と影響範囲

- Spec: `docs/Lyra_Unified_Spec_v4.md` §2 の編集可能な構図・カメラの確認フロー、および §6 の現在保存済み入力からの生成契約。
- 影響範囲: `apps/mobile` の画面 UI と既存の更新ペイロードのみ。
- 非影響: Route / Service / Repository / Domain / Infrastructure / Worker / 永続データ構造 / クレジット / ジョブ契約。

## インターフェースと安全性

既存の `PanelRecord['composition']` 型と更新 API をそのまま使う。モバイルから廃止するのは UI 入力のみであり、他クライアントと既存データが利用する source の値は受け入れ続ける。ユーザーが表示中のコマを変更していない時は source の差だけで dirty 状態にしないため、未保存確認の誤表示を避ける。

## 検証

構図ソース選択・ギャラリー選択が画面に残らず、保存ペイロードが `ai_auto` / `null` に固定される契約テストを先に追加する。続けて mobile の unit test、typecheck、lint、API 契約、文字化け検査、Android export を実行する。リリース用には既存の release gate も確認する。

## Sol/Terra 方針

委譲なし。`PagesScreen` の状態・dirty 判定・保存ペイロードは一体であり、分割した変更は未保存確認や既存データ保持を壊しやすい。Terra task packet はこの設計に対するローカルチェックリストとして Sol が実施する。
