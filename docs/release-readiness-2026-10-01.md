# Lyra 本番反映前チェック（2026-10-01）

## 判定と対象

**実機確認だけを残した状態とはまだ判定しない。この文書は反映・ストア提出の許可ではない。**

候補は main `e5973a7450c951520236353df0a108ba753d065f` を祖先に持つ
PR216 → 217 → 219 → 220（統合元 `2bb4e2dabd24c3116c5dae86a177754b367e245d`）に、
今回の UI・機能・安全性・実本番互換の変更を加えたもの。
前回調査時に実稼働 API のタグが指していたコードは `2debe8c3c22633ed077e7b189ddcfa8b209a00dc`。
2026-10-02のローカル統合では実環境へ再照会していないため、現在の反映先SHAとは断定しない。
前回観測の main と実本番は別系統なので、反映前に実SHA・DB履歴を再確認し、mainとの差分だけでは互換性を判定しない。
PR215 は設計と機能単位の参照元であり、そのイメージや migration を直接反映しない。

過去候補の commit と検証結果は `release-validation-2026-10-01.md` で記録している。
今回のローカル統合結果は `uiux-backend-expansion-2026-09-30/実装記録.md` と
同フォルダの `統合検証manifest-2026-10-02.json` を参照する。
文書に残る途中 checkpoint は最終 SHA の CI 成功を意味しない。
GitHub の Git data write は初回 403 で停止した。その後、対象 repository の installation と
push 権限を確認し、同じ connector の書き込み再試行に成功した。
PR の正確な remote SHA と CI は公開時点の結果で判定し、ローカル検証から成功を推定しない。

## 実装と公開を分ける

- 白黒／カラー、状態 preview・確定・コマ参照・話開始状態・状態反映、4 タブと制作工程、
  選択直後の空コマ挿入、黄色の選択コマ、5 設定ダイアログをローカル候補で統合する
- server 見積もり、原子的な job／credit／dispatch 受付、応答不明時の receipt 照合を全有料操作へ接続する
- Google の通常ログインと明示連携を分離し、native/Google 両本人確認、単回 challenge、
  曖昧な外部処理結果の読み取り専用復旧を実装する。通常ログインで email 一致だけの subject 付替えはしない
- 実本番 API 契約・課金・export・push・退会復旧・編集 AI の挙動を、候補の安全対策を保持して移植する
- Hy4 画像生成は公式契約・参照編集・料金が未確定のため OFF。別モデルへ代替しない。
  既知 Hy4 画像の Web 限定配信と Mobile 遮断、未知 provenance の拒否を実装する

具体的な要件別状態は機能・UI 対応表、領域別設計文書に記録する。
元セッションの原文は確認できておらず、保管された設計・要約台帳・実コードを根拠にする。
デザイナー wireframe は構造の参考で、後の明示ラベル・操作・色指定を上書きしない。

新規受付は `ENTITY_STATE_REFERENCE_GENERATION_ENABLED=false`、
`EPISODE_STATE_AUTOFILL_V1_ENABLED=false`、`GENERATION_QUOTES_ENABLED=false`、
`GOOGLE_SIGN_IN_ENABLED=false`、`GOOGLE_IDENTITY_LINK_ENABLED=false` が既定値。
**新 Mobile の有料操作は quote 必須なので、quote OFF のまま完成版として公開してはいけない。**
実環境の既存課金・退会・export・push flags は未確認のまま OFF に変更しない。
現行ストア版は退会や通知等の既存 API を使うため、旧機能の runtime を含めて有効性を確認する。

## 実本番 migration 系統の必須確認

旧 001–039 だけを前提にした単純な 040/041 適用手順は、実本番の手順に使わない。
実本番と候補は filename 単位で異なる migration 履歴と schema を持つ。
歴史的な候補 001–041 は編集せず、042–046 と明示的な production-lineage bridge で調整する。
詳細は `production-lineage-bridge-design-2026-10-01.md`。

- 読み取り専用 `bun run db:check-lineage:prod` で正確な履歴、型・制約・index・既存行の不変条件を検査
- unknown／partial hybrid、重複 active email、欠けた削除本人識別、旧 pending deletion、
  `scheduled_asset_keys` に lifecycle 予約が残る行、未 scrub の旧 completed receipt、
  現 job と一致しない未送信 push は停止。予定を実削除済みへ書き換えない
- bridge は明示的な `--production-lineage-bridge-quiesced` を要し、通常自動 migration では進まない
- bridge の table write lock は取得制限 5 秒。互換 prepass は 1 transaction、後続は既存の file 単位。
  途中失敗後も全 writer を止めたまま、receipt を残して原因を直し、同じ手順で再開する
- `export_jobs` の物理 relation を `episode_export_jobs` へ移すため、bridge 後の旧本番 image への
  単純 rollback は不可。後述の互換 image／forward fix を使う
- 安定した `ACCOUNT_DELETION_IDENTITY_HASH_SECRET` は既存の承認済み runtime からのみ使う。
  勝手に生成・更新・記録・CLI 引数へ記載しない

PG16 と本番同版 PG18.3 の使い捨て DB に、実本番 38 SQL の固定 fixture を再構築して検証する。
これは本番の件数・長時間 transaction・実 lock 時間・実顧客行の代替ではない。
旧 `checkStateReleasePreflight.ts 39|41` は候補系統の限定回帰用で、046 後や実本番の判定には使わない。

## 実環境照合の扱い

公開資料には実環境の account、resource ID、task revision、image digest、権限構成や
認証設定の個別観測値を載せない。反映担当者は承認された非公開の記録と照合する。
PostgreSQL 18.3 の互換試験は実行済みだが、実 DB の履歴・件数・lock・認証 subject・
秘密値・runtime flags の検証を代替しない。
アクセス追加、IAM、Secrets、task、課金環境、provider 設定は別途承認なしに変更しない。

## 反映を止める残ゲート

1. 最終 SHA の全体検証、コードレビュー、承認された GitHub 書き込み経路での PR と CI
2. 実 DB の aggregate lineage／table-size／lock／deletion 不変条件、実件数に近い staging と write-freeze rehearsal
3. `auth:check-subjects:prod` の読み取り監査。別 subject の既存ユーザーがいれば、両本人の根拠を持つ
   個別に承認された offline 移行を先に用意。email 一致で代用しない
4. 旧ストア client と新 API の受入、旧 job／export の drain、queue payload と worker image の整合
5. 既存の退会・push・export・課金 runtime の設定／必要最小権限／鍵と運用の確認。
   旧 client へ必要な機能を default OFF のまま失わせない
6. Google の専用 OAuth client、Cognito IdP／trigger、callback／scope／ログ秘匿、実アカウント復旧。
   iOS は Apple／例外の判断と専用 app-client provider 方針が未決定。Google-only 利用者の切戻しも要確認
7. Web 限定配信の検証済み Cognito client allowlist と Web 返却先。Hy4 の生成開始は公式画像契約確認まで不可
8. 承認された費用上限の下での実 OpenAI の日本語／英語、白黒、複数状態、読み順、品質・原価・timeout・返金試験
9. browser/native の実画面、safe area／大字／keyboard／dialog back／dirty／保存共有、および下記の実機受入
10. 状態 copy v2 の実 S3/IAM/KMS/versioning/lifecycle/replication と recovery 受入。
    `138d62c` で migration 047、durable journal、conditional write、receipt と recovery runtime が
    追加された。現行契約と公開条件は `release-readiness-audit-2026-10-02.md` を参照する。
    `release-state-copy-addendum-2026-10-02.md` は v1 の欠陥再現・修正の履歴資料であり、現行の反映手順ではない。
    admission OFF でも既発行候補の confirm、journal-aware read/prune/delete/recovery は対象になる。
    旧候補・旧形式履歴・旧稼働プロセスを確認し、時間経過／HEAD／再試行成功から原試行の終了を推測しない。
    v2 導入後の rollback は v2 を扱える版に限る。ローカルモデル検証や設定 attestation の成功を、
    実サービスの IAM 制約・復旧・削除の受入完了とみなさない。

## 承認後の段階反映手順

この節は今実行する指示ではない。反映担当者と観測時間・停止閾値を staging で決めてから使用する。

1. 最終 SHA・immutable API／worker digest、現在の task definition／runtime flags、復元点を記録
2. 新 job と編集受付、課金 callback、push、export、退会等を含む全 writer を承認された方法で停止。
   SQS visible／in-flight と DB queued／processing の両方を確認し drain。旧 worker へ新 payload を渡さない
3. `db:check-lineage:prod` と `auth:check-subjects:prod`、サイズ・lock 検査を実行。
   失敗や unknown、旧 lifecycle 削除の証拠不足があれば変更せず停止
4. 復元点を再確認し、同じ reviewed image で `migrate:prod --production-lineage-bridge-quiesced` を一度実行。
   エラー時は writer を再開せず、receipt と schema を検査して原因を解決。無限自動 retry や履歴削除はしない
5. bridge と 046 までの履歴・不変条件を再確認し、worker を先に完全更新。
   旧 running／pending task がなくなってから、受付を止めたまま API も同じ候補へ完全更新
6. readiness・target health、旧 client の認証済み読み取り／無課金保存／課金状態照会を確認して受付を段階再開
7. 各新機能はその固有ゲート通過後に別判断で公開。現候補 Mobile の quote 必須経路が実環境で使用可能か検証
8. 5xx、queue age、failed/refund、credit 不一致、画像欠落、秘密入りログを観測。閾値未決定のまま公開判断しない

## rollback

- DB の down migration、履歴削除、正常データへの安易な PITR はしない
- 新受付を止め、全 job／dispatch／export／退会／push を止めるまたは安全に drain
- bridge 後は旧 2debe API／worker が export table 名や新 job を解釈できない。
  削除 inventory、state、quote、provenance を保持する検証済み互換 image か forward fix を使う
- state flag OFF だけでは白黒・quote 受付、既発行候補、既存 linked Google-only login の安全な切戻しにならない
- Google 公開後の rollback では新規 Google 受付を止める前に既存 Google-only 利用者のログインを維持する手順を確認。
  identities、challenge receipt、作品、台帳を削除しない
- destructive corruption の場合のみ全 writer を止め、別途承認と記録済み復元点に基づき復旧を判断

## 最小の実機受入

現行ストア版と候補 build を同じ試験ユーザーで比較。実課金・退会は専用試験アカウントと別途承認の範囲に限る。
現候補の Mobile package version は古い開発値のままなので、将来の署名 build 前にストアの実 build 番号と整合させる。
今回、署名 IPA／AAB、EAS build、ストア upload、OTA は作成・実行していない。

1. 既存ログイン、再認証、期限切れからの復帰で同じ内部 user・作品・残高・購入状態になる
2. 4 タブ→制作工程、既存作品から途中再開。未保存値を保持し、選択変更だけで dirty にしない
3. コマ直後の空コマ、黄色選択、5 ダイアログ、Android back／アクセシビリティ close と focus、safe area／keyboard／大字
4. 明示 quote→承認→通信中断／再押下→同じ job、正しい参照・白黒／カラー、失敗時一回だけの返金
5. 状態 gate 公開時のみ preview→confirm、古い候補拒否、default 復帰、話開始状態、保護／明示 overwrite
6. 画像拡大・保存・共有・PDF、権限拒否後の回復、Web 限定画像の Mobile 全経路遮断
7. 個人／法人切替で作品・画像・残高が混ざらず、購入復元・予約プラン・通知の旧機能が保たれる
8. Google 公開対象のみ別 email／同 email 衝突／明示連携／取消／timeout／別 session／復旧を確認

OS、app version/build、候補 SHA、時刻、期待と実際を記録。一つでも未実施・失敗なら実機完了としない。
