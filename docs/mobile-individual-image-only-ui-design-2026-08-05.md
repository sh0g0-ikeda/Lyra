# Mobile 個別画像保存のみ表示する設計

## 目的と範囲

モバイル版のページ画面では、個別ページの「画像を保存」だけを表示する。
PDF と画像 ZIP の作成・保存 UI は審査候補から隠すが、既存の API、非同期
export job、ダウンロード実装、型、永続化契約は削除も変更もしない。

## Spec 根拠

`docs/Lyra_Unified_Spec_v4.md` の Product boundary は画像/PDF export を製品機能
として定義している。今回は契約を削除せず、モバイル画面の公開 UI だけを無効化する
可逆な変更として扱う。

## 影響レイヤーとインターフェース

- 変更対象: `apps/mobile` の PagesScreen 表示とその UI 回帰テスト。
- 変更対象外: Route、Service、Repository、Domain、Infrastructure、Worker、Web、
  export API、job payload、DB、クレジット、ファイル形式。
- 入出力、永続化、認証・認可、外部 API の契約は変わらない。

## セキュリティ

個別画像保存は従来どおり認証済み image export API と端末の写真ライブラリを使う。
PDF/ZIP のコードと短命 URL の扱いは変更せず、画面から起動できなくするだけとする。

## テスト方針

1. PagesScreen のソース回帰テストに、PDF/ZIP export UI が無効であることと、
   個別画像保存 UI が残ることを追加し、先に失敗を確認する。
2. 実装後に対象 Vitest、mobile 全テスト、型検査、lint、契約監査、文字化け監査、
   iOS/Android の Expo export を実行する。
3. 審査候補ビルドは検証通過後に iOS production と Android production AAB を
   それぞれ一度だけ作成する。

## Terra 委譲

委譲なし。単一画面の可逆な UI 表示制御と単一回帰テストに限定され、分割による
調整コストが実装コストを上回るため、Sol が設計・実装・検証を一貫して担当する。
