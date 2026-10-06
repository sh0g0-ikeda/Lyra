# 状態画像 copy と退会の追加検証・修正（2026-10-02 JST）

> **旧版の検証記録です。現行の反映・復旧手順には使わないでください。**
> この文書は `1d51219` を基準にした v1 修正を記録しています。後続の
> `138d62c` は migration 047 と durable journal、試行 receipt、conditional write、
> version を指定した削除、recovery を追加しました。「新規 migration はない」
> 「receipt 設計は含まれない」は当時の版だけに適用されます。現行契約と未完了の
> 実 S3/IAM 受入は [最新監査](release-readiness-audit-2026-10-02.md) の
> 状態 copy v2 と公開ゲートを参照してください。v2 記録の導入後に v1 へ戻す運用は不可です。

## 版と結論

基準版は凍結候補 `1d512194dd0ee506102adc8bb773c2dfcaba28a8`。
追加修正は `fix/state-copy-settlement-2026-10-02` に分離し、基準版の branch と配布済み
bundle／patch／文書／offline preview は保存した。修正版の exact commit と各成果物の
SHA-256 は修正版の配布 manifest に記録する。

この問題には、ローカルで再現・修正できる安全性の欠陥と、実 S3 を使う受入・復旧運用の
未完了部分の両方がある。状態機能を公開できるという判定には変更しない。

## 基準版で再現した欠陥

使い捨て PostgreSQL 18.3 と、実際の保存完了・ローカルの応答を独立した barrier で
制御する模擬ストレージを使用した。本番 DB、AWS、OpenAI、実ユーザーデータは使わない。

1. copy 開始後にその PostgreSQL backend を終了する。row lock が解除される
2. または SDK の応答だけを失敗にし、DB は正常なまま rollback する
3. 基準版は退会を完了し、削除済み key の checkpoint を保存して job の画像履歴を消す
4. その後に模擬ストレージの保存を完了すると、追跡されない画像が再出現する

両パターンで、退会が止まるべきという回帰試験を先に失敗させてから実装した。
従来の正常な接続での lock 競合や copy／commit 失敗試験は、この順序を検証していなかった。

## 追加した保護

- 既存の exact-key intent に試行固有の `attempt_id` と `state` を記録する
- `unresolved`、旧形式、不正形式、重複した試行 ID が残る間、その job の再 copy と個人退会を停止する
- `succeeded` は、その単回処理の完全な成功応答を受け取った場合だけ記録する
- `not_dispatched` は、その呼び出しが自分の試行を一度も送っていない場合だけ記録する
- DB への記録が失敗した場合は停止したまま履歴を保持する。時間切れによる解除はしない
- 既に成功の証拠を DB に保存できた copy は descriptor の再保存に使い、再 copy しない
- 状態 copy 用 S3 client は `maxAttempts=1`。完全な成功結果、HTTP 200、SDK 試行回数 1 を要求する
- 通常の基準画像 copy への fallback は廃止する。通常の基準画像の挙動・再試行設定自体は変更しない
- 未確定履歴は画像・job の掃除から保護し、deployment invariant でも検出する

新規 migration はない。既存 JSON の拡張であり、旧形式を自動で成功扱いに書き換えない。
旧 API の退会 blocker 形式は保持するが、停止中の処理には未解決の状態 copy も含まれる。

## 実行結果

| 検証 | 修正版での結果 |
|---|---|
| backend Vitest + 使い捨て PG18.3 | 338 files / 2,512 tests、0 fail |
| native Bun test + 使い捨て PG18.3 | 338 files / 2,512 tests、0 fail |
| PG16 integration | 21 files / 193 tests、0 fail |
| Fresh migration CLI / deployment invariants | 001–046成功、66件 ok、lineage=candidate／blockers=[] |
| Backend build、Mobile canonical 契約／API inventory | 成功、150 endpoints |
| Mobile Vitest | 183 files / 926 tests、再実行成功 |
| Mobile typecheck／lint、Web lint／build | 成功（既存 Web chunk サイズ警告あり） |
| 基準版の欠陥再現 | 別 checkout の実装を1d51219に固定し、新回帰2ケースとも期待通り失敗（completed ≠ blocked） |
| Parser／SQL／deployment 判定一致 | PG18.3 の20ケース成功。正常・不明・旧形式・重複・不正scope等 |

修正版の exact commit で backend／PG16／Mobile／build を再検証し、配布 manifest とログに対象を記録する。
新しい runtime 修正は API／storage／退会の境界だけで、Mobile／Web／共有契約／migration の source は
基準版と同一。既存の Android／iOS offline export と portable preview は基準版の成果物のまま保存する。
今回の commit から新しく署名 build や preview を作成したとは扱わない。実画面は引き続き未検証。

## 残る公開条件

1. 実際に使う AWS SDK／S3／DB 接続設定で、単回成功応答と故障時の停止を staging で確認する
2. プロセス終了などで成功応答自体を失った `unresolved` を、安全に解決する復旧方法を設計・検証する
3. 単なる時間経過、abort 完了、HEAD の存在／不存在、別の再試行の成功を、元処理の終了証拠にしない
4. 旧プロセスを停止・drain し、既発行候補、旧形式／未確定履歴、過去の退会 checkpoint を点検する
5. 旧退会 receipt に関する production lineage bridge の停止条件を維持する。記録を消して通過させない

原試行の成功応答を受け取れる場合は、切断後の別 DB 接続でその証拠を保存して復旧できる。
応答そのものを失った場合は、画像が見えても自動復旧しない。状態機能は引き続き OFF。
将来の試行 token に結び付く storage receipt 等の設計は、この修正版には含めていない。

実 S3 への障害注入、新規 provider 呼出し、production 変更、有料試験は未実施。
GitHub write／CI、実 DB と移行負荷、Google、Hy4、実画像品質、実機・実画面など、既存の残ゲートも維持する。

## 根拠

AWS は CopyObject の HTTP 200 だけでは完了を意味せず、応答全体の受信・処理が必要と説明する。
SDK は埋め込みエラーを検出し、設定次第で再試行する。切断が必ず remote write を停止するとは
この説明から保証できないため、不明な結果を成功に読み替えない。
[Amazon S3 CopyObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_CopyObject.html)
および [AWS SDK retry behavior](https://docs.aws.amazon.com/sdkref/latest/guide/feature-retry-behavior.html)
を 2026-10-02 JST に確認した。
