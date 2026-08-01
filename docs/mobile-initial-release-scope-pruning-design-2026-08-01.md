# Mobile初回リリース範囲整理 設計

## 目的と範囲

初回リリースのタスクリストを、現在Mobile UIから利用できる機能の出荷と、追加が必要な購入UI・アカウント削除UIに限定する。現在UIに存在しない将来機能のBackend、Mobile UI、外部設定、実機E2Eは初回リリース条件から外す。

Balloon編集は初回リリースへ追加しない。現在Pagesに露出している`balloon_only` / `mixed`を含む台詞表示モード選択全体を除去する。`image_baked`だけの選択UIは意味を持たないため残さない。ただし既存Web、保存済みPage、API responseとの後方互換性を守るため、Backend、DB、shared API contract、Mobile response schemaの`dialogue_mode`は変更しない。

既存の大規模タスクリストは履歴文書として保存し、同じパスには初回リリースのactive checklistだけを置く。

## 作るもの

- 現在UI、購入、アカウント削除、署名build、store提出、必要最小限の課金E2Eだけを含むactive checklist。
- 初回リリースから外した機能と「既存Backendを削除せず既定OFF / 未接続で維持する」境界。
- PagesからBalloon専用・混在表示モードを選択するUIを除く回帰テストと実装。

## 作らないもの

- Balloon / Frame編集UIとその新規Backend。
- Mobileに存在しない作品削除・作品並べ替え・Scene削除・Character削除。
- entity referenceのpresigned direct-upload client、`costume_ref_id`選択、Push通知、organization管理 / organization課金UI。現行UIにある端末画像importは維持する。
- 上記に対応するproduction設定、実機E2E、監視を初回リリース条件へ含めない。
- 既にmainへ加算的に入ったmigration、Backend Route / Service / Repository、Web機能の削除や契約変更。

## Spec根拠

- `docs/Lyra_Unified_Spec_v4.md` section 2: 現在の漫画制作フロー。
- section 5: 保存済みデータ、画像、削除安全境界、加算的Backendの後方互換性。
- section 7: Mobile store billingはverifier、allowlist、credential、明示flagが揃うまで無効。
- section 10: release verification gate。

旧フェーズ名ではなく、上記の現行実装契約と現在Mobile UIを初回リリース範囲の根拠とする。

## 影響レイヤー

- Mobile: `PageSettingsSection`のBalloon関連選択UIとそのcomponent / screen test。
- Documentation: active task listと履歴archive。
- Backend / DB / Migration / Worker / Web / shared API contract: 変更しない。

## インターフェースとデータ境界

- `PageRecord.dialogue_mode`、`PUT /api/pages/:id`、DB保存値は維持する。
- Mobileは既存値が`balloon_only` / `mixed`でも読み込みを拒否せず、Balloon選択UIだけを表示しない。
- style、story context、page dialogue toggleなど残るPage設定を保存するとき、ユーザーが変更していない`dialogue_mode`を送信しない。
- タスクリストの件数はactive document内のMarkdown checkboxだけを数える。履歴archiveは残件へ算入しない。

## セキュリティ

- 認証、認可、tenancy、credit、store verifier、secret、S3 key、job、refundを変更しない。
- production、AWS、EAS、Apple / Google Consoleを変更しない。
- dormant Backendを削除してWebや既存データを壊さない。

## テスト方針

1. 先に、PagesでBalloon専用 / 混在選択が表示されないことを要求する失敗テストを追加する。
2. `PageSettingsSection`から該当UIを除去し、既存のBalloon値を含むPageでも他設定を安全に扱えることを確認する。
3. task checkboxの総数、完了数、未完了数、AI / 共同 / 人間区分の算術一致を機械検証する。
4. Mobile focused tests、typecheck、lint、contract drift、両OS exportを実行する。
5. Backend / DB contractを変更していないことをdiff監査し、PR required CIを通す。

## Terra委譲

- Terra 1: 現在Mobile UIの可視機能とAPI利用をread-onlyで棚卸しする。
- Terra 2: 旧タスクリストを「初回release必須 / 後回し」にread-only分類する。
- Sol: scope判断、Balloon UI除去、active checklist再構成、テスト、統合を担当する。
