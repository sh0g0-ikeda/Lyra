# Story deletion safety design

## 目的と範囲

chapter / episode の既存削除 API が PostgreSQL の cascade だけで配下を消し、実行中の生成、episode export、S3 上の生成画像を取り残し得る問題を解消する。削除対象の personal ownership または active organization membership は現行 Route / Repository の境界を維持し、許可された対象だけを同一 transaction で lock・再検査・削除する。

この slice は Backend の削除安全契約だけを実装する。Mobile の削除ボタン、work 削除・並べ替え、S3 asset の durable deletion workflow、DB schema / migration、生成・export の課金や返金、queue / Worker の処理順は変更しない。生成画像または未削除 export artifact がある話は、asset cleanup を別に実装するまで削除を許可しない。

## Spec 根拠

- `docs/Lyra_Unified_Spec_v4.md` §3: Route / Service / Repository の責務境界
- §4: ID の既知だけでは許可せず、personal ownership または active organization membership で scope する
- §5: PostgreSQL を system of record とし、画像と export artifact は opaque S3 key で管理する
- §6: `generation_jobs` の active / terminal、active uniqueness、cancellation、retry、refund の整合性を維持する
- §8: parameter binding と安全な user-facing error
- §10: Vitest / Bun、PostgreSQL、Backend、Web、Playwright の release gate

## 現行監査

- `chapters` の削除は episodes、scenes、pages、panels、frames、balloons、episode export rows を cascade する。`episodes` の削除も同じ配下を cascade する。
- `generation_jobs` は対象 ID を `params` JSON に保持し、story hierarchy への foreign key がない。そのため現行削除後も job が残り、Worker、retry、refund と削除済み対象が不整合になる。
- page の `generated_image` と completed export の `artifact_s3_key` は DB row の cascade では S3 object を削除しない。通常の story 削除には account deletion のような durable asset cleanup がない。
- page generation の page 保存と job 完了は transaction だが、job 受付と page status 更新は別 transaction である。episode long job も受付後に Worker が story graph を更新するため、削除側の一度だけの事前確認では TOCTOU を防げない。
- production の `StoryService` は `PostgresStoryRepository` へ transaction runner を渡していない。安全削除は transaction 必須とし、app wiring で明示的に渡す。

## 削除契約

削除は次の順で行う。

1. request user と optional organization scope で対象を検索する。scope 外は blocker の有無を調べず not found とする。
2. episode 単位の transaction-scoped advisory lock を ID 順に取得する。
3. episode と配下 page rows を lock し、同じ transaction 内で blocker を再検査する。chapter は先に authorized chapter row を lock して新しい child episode の追加を止め、child episode ID を確定してから advisory lock を取得する。
4. blocker がなければ既存 FK cascade で対象を削除する。成功後だけ既存 organization audit を記録する。

次のいずれかがある場合は削除せず、詳細 ID や S3 key を含まない安定した `409 CONFLICT` を返す。

- 対象 episode の `episode_story_autofill` / `episode_page_skeleton` が `queued` または `processing`
- 配下 page の `page_generate` が `queued` または `processing`
- episode export が `queued` または `processing`
- completed export の artifact がまだ削除済みでない
- 配下 page に保存済み `generated_image` がある

terminal generation job、failed / canceled export、artifact cleanup 済み export は blocker にしない。chapter 削除は全 child episode の和集合で同じ条件を評価する。

## 生成受付・retry との直列化

`page_generate`、`episode_story_autofill`、`episode_page_skeleton` の新規作成は既存 capacity transaction 内で対象 episode を解決し、削除と同じ advisory lock を取得してから scope を再検査する。page job は client params を増やさず、authorized page から episode ID を解決する。

episode export 作成も、authorized episode の初期確認後に同じ advisory lock を取得してから idempotency、page snapshot lock、job / outbox insert を行う。これにより export が page row を share lock した後で episode FK lock を待ち、削除が episode row を lock した後で page row を待つ逆順 deadlock を作らない。

failed job の retry も job の保存済み scope / params から対象 episode を解決し、同じ lock と再検査を通す。これにより、削除が先に commit した場合は新規 job / retry を作らず conflict、job 受付が先に commit した場合は削除側が active job を検出して conflict になる。

既存 Worker は active job のまま story / page row を更新し、page generation の page と terminal job は同一 transaction で保存する。削除側は episode / page row lock 後に active job と generated image を検査するため、Worker が先なら結果を検出し、削除が先なら active job を検出して解放する。Worker、credit、refund、terminal push outbox の lock 順や状態遷移は変更しない。

## 影響とエラー

- 正常な未生成 story の削除は DB 内の追加 lock / EXISTS 検査だけで、通常は数十 ms 程度の増加を想定する。
- 同じ episode の job 受付・Worker commit・export create と競合した場合は、それらの短い DB transaction 完了まで待つことがある。外部 provider 処理を lock 中に待たない。
- generated image や未削除 artifact がある story は削除不可になる。これは S3 orphan を発生させないための fail-closed 境界で、後続の durable asset deletion workflow まで維持する。
- story、scene、page、job、credit、export の保存 schema と response schemaは変更しない。成功は従来どおり 204、not found は 404、blocker だけ 409 になる。

## セキュリティ

- scope 外 target は not found とし、active job、page image、export artifact の存在を推測できる差を返さない。
- organization target は active membership を再検査し、同じ organization の別 member が開始した active job も削除 blocker とする。
- SQL は parameter binding のみを使い、JSON param は text 比較して malformed legacy value の cast failureを避ける。
- user-facing conflict に job ID、type、status、S3 key、provider errorを含めない。

## TDD と検証

先に failing tests を追加し、次を確認する。

- episode / chapter の ownership lock、advisory lock、page lock、blocker 検査、delete の順序
- active episode / page job、active export、pending artifact、generated image の各 blocker
- terminal / cleanup 済み状態の許可と not-found 非漏えい
- generation create / retry と export create が同じ episode lock と scope 再検査を使うこと
- 実 PostgreSQL で「削除先行なら job 作成失敗」「job 作成先行なら削除失敗」になること
- Route の 409 contract と成功時だけ organization audit が残ること
- 対象 unit / integration 後に Spec §10 の全 gate

## Terra 調査の扱い

read-only 監査では cascade、`generation_jobs` の JSON 参照、export artifact cleanup、tenant error、TOCTOU を確認した。Sol が lock 順と統合範囲を再検討し、S3 orphan を避けるため generated image も blocker に加え、設計・実装・最終検証を所有する。
