# 最終互換レビュー（2026-10-01）

実本番 source `2debe8c3c22633ed077e7b189ddcfa8b209a00dc` と現在の候補を、
ローカルのコード・固定 fixture・使い捨て PostgreSQL 18.3 で独立に確認した。
production や provider への接続・変更はない。対象 commit と全体結果は validation 文書を参照。

## 検出した問題

旧 source の completed deletion 1件に `scheduled_asset_keys=[]` と raw `identity_id` が残る場合、
lineage preflight は blockers=[] となり、bridge と migration 完了後に deployment invariant の
`account_deletion_requests.completed_scrub` だけが失敗した。
identity_key の backfill と raw identity の scrub は別契約なのに、前段がこの差を検出していなかった。
exact 2debe fixture に1行を追加して PostgreSQL 18.3 で再現した。

修正方針は、未解決の旧 completed receipt を preflight の明示 blocker とし、行をそのまま保って停止する。
source の completed というラベルだけで provider／storage の完了証拠を推測し、履歴を消すことはしない。
成功する bridge fixture には最終 `checkDeploymentDataInvariants` も追加する。
修正後は PG16/18 とも48件の focused suite が成功。成功 fixture 全ての最終 deployment invariant を検査し、追加で検出した stale push delivery も事前 blocker にした。最終全体結果は validation に記載する。

## 追加の欠陥を確認しなかった重点境界

- 実 API の TransactionalUserProvisioningService は user と credit repository を同じ transaction に束縛
- UserProvisioningService は insert の競合だけを再照合。credit grant の一意制約エラーは成功扱いせず rollback
- native/federated ともに email 一致だけの subject 変更を禁止
- quote、直接 save-and-generate、旧受付は共通 admission と active-job 一意性を通り、一つの job/debit に収束
- shared export queue は旧 `{job_id,job_type:'episode_export'}` と strict v1 envelope を dispatch
- export runtime がない場合は message を ACK せず retry

確認時の focused 実行は4 files／39 tests成功。
独立レビューの範囲を超える全コードの無欠陥証明、実 IdP、実 queue、配布 binary の受入ではない。
