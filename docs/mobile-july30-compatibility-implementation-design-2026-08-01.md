# 7月30日版モバイルUI互換化 実装設計

## 目的と範囲

- 承認済みの `2da15864936771a897fbeb8da8c9df47496ac635` を不変のUI基準とする。
- Pages、Story、Characters、Account、ナビゲーションの配置と見た目を作り直さない。
- 現行本番バックエンド `16586686340cd4c1401c510e5302d10d8843b458` との通信契約差をモバイルクライアント内で吸収する。
- iOS/Android課金とアカウント削除は既定OFFの機能フラグで隠し、外部ストア設定と実機E2Eが完了するまで本番利用させない。
- バックエンド、DB、migration、生成ジョブ、クレジット台帳の実装は変更しない。

## Spec根拠

- `docs/Lyra_Unified_Spec_v4.md` §2 Product boundary: 既存の漫画制作フローを維持する。
- §3 Architecture: mobileはAPI契約とユーザー向けエラーを消費し、サーバーの業務判断を複製しない。
- §4 Authentication and authorization / §5 Persistence and tenancy: 購入と削除は本人のpersonal scopeに限定し、organization IDを送らない。
- §6 Generation jobs: 現在保存済み入力から生成し、既存のジョブ一意性と失敗処理を変更しない。
- §7 Credits and billing: クレジット付与の権威は検証済みサーバー処理とし、端末の購入成功だけでは確定しない。
- §8 Input and output safety: API応答をbounded Zod schemaで検証し、購入証明を画面やログへ出さない。
- §10 Verification gate: 対象テストから始め、リリース前に全体ゲートを確認する。

## 影響レイヤー

- Mobileのみ: `apps/mobile/src/domain`、`apps/mobile/src/lib`、`apps/mobile/src/screens/AccountScreen.tsx` と対応テスト。
- Contract tooling: 現行backend canonical schemaを生成物の先頭に保ち、旧UIだけが必要とするschema名を `mobileCompatibilitySchemas.ts` から限定再exportする。
- Backend / Repository / DB / Worker / Web / production runtimeは非変更。

## インターフェース

- ページ生成: 一括保存生成APIが404/405なら、保存後に既存生成APIへ限定フォールバックする。
- ページ編集: 現行バックエンドにないread-only補助APIは、既存APIと固定された現行テンプレート契約で補う。保存形式は変更しない。
- 課金: server catalogとnative productを照合し、Apple JWSまたはGoogle purchase tokenをサーバー検証後にだけfinishする。
- アカウント削除: `GET/POST /api/account/deletion` と現行acknowledgement/body/responseへ合わせる。
- 機能フラグ: 課金と削除は環境変数が明示的にtrueの場合だけ問い合わせ・表示する。既定false。
- Schema生成: `packages/api-contract/src/mobileApiSchemas.ts` は現行mainを変更せず、generatorが列挙した互換schemaだけを追加する。重複名は再exportせず、現行canonicalを常に優先する。

## セキュリティ

- 課金・削除APIにorganization IDを送らず、personal account bindingを維持する。
- native store、SKU、server catalog、account bindingの不一致をfail closedにする。
- 購入証明は一時メモリと検証API bodyだけに保持し、state・UI・ログへ残さない。
- Google subscription offer tokenをnative requestへ渡すが、サーバーのallowlistと検証を権威とする。
- 同一proofはstore + proofで重複排除し、最大50件の復元上限を維持する。
- feature flagはUX gateであり、サーバー側認証・認可・billing/deletion flagを置き換えない。

## テスト方針

先に失敗テストを追加し、次を確認してから実装する。

1. flag OFF時はcatalog/deletion previewを呼ばずUIを露出しない。
2. organization workspaceでは購入UIとcatalog queryを作らない。
3. catalog store不一致を拒否する。
4. Google subscription requestへoffer tokenを渡す。
5. transaction IDが違っても同一proofのrestoreを一度だけ送る。
6. Apple environment不明時は検証・finishしない。
7. 現行削除API、3 acknowledgement、200/202/409をstrictに解釈する。
8. 7月30日の主要画面配置とページ生成fallbackを維持する。

対象テスト合格後にmobile test/typecheck/lint/export、リポジトリ全体のrelease gateを順に実行する。

## Terra委譲

- 課金互換: 課金lib/config/APIと対応テストだけを所有する。
- 削除互換: 削除schema/type/copy/API/AccountScreenの削除区画と対応テストだけを所有する。
- ページ互換: ページ補助API差分と対応テストをread-only調査し、Solが統合判断する。
- SolはUI不変、重複変更、セキュリティ、最終diff、全検証、Git/PR/EASをレビュー・実行する。
