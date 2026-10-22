# 2026-07-14 15:00 JST 本番ロールバック設計

## 目的と範囲

本設計は、Lyra 本番環境を 2026-07-14 15:00 JST に稼働していたアプリケーション契約へ、一つのコマンドで安全に戻せるようにする。

対象:

- Git の基準コミット
- API / worker の ECR イメージと ECS task definition
- API / worker の ECS service
- アプリケーション Secret の版
- worker の Application Auto Scaling 設定
- 切替前後の ALB / CloudFront health check

対象外:

- RDS 内の作品、決済、クレジット等のデータを 7 月 14 日へ巻き戻すこと
- Cognito、Stripe、CloudFront、ALB、Route 53 の現在のセキュリティ設定を古い状態へ戻すこと
- 実行中または配信中の生成ジョブを強制停止すること

DB を過去へ復元すると 7 月 14 日以降のユーザーデータと課金記録を失うため、DB は現在のデータを維持する。代わりに、現在の schema が基準コードと後方互換であることを事前検査し、不明な migration が一つでもあればロールバックを中止する。

## Spec 根拠

- `docs/Lyra_Unified_Spec_v4.md` 3章: Route / Service / Repository / Infrastructure / Worker の境界
- 同 5章: tenancy と永続化データを失わないこと
- 同 6章: generation job、active uniqueness、SQS visibility、refund の整合性
- 同 7章: billing / credit ledger の保全
- 同 9章: API と worker の可用性
- 同 10章: release verification gate

## 確定した基準点

| 項目 | 基準値 |
|---|---|
| 時刻 | 2026-07-14 15:00 JST |
| Git commit | `bfea1329f151d76a335d8bbbc59c624c54b7f4e3` |
| ECR release tag | `continuity-v3-bfea132-20260714` |
| ECR digest | `sha256:7b0562f727e0eeca712a255dc08d15f94c2f8e5ef2d996e321517b98f210ac19` |
| API task definition | `lyra-prod-api:75` |
| Worker task definition | `lyra-prod-worker:48` |
| Secret version | `6982a44b-0425-406a-8704-f0b73f9dfefb` |
| Worker scaling | min 1 / max 3 at 15:00 JST |
| Worker daytime schedule | 09:00 JST に min 1 / max 3 |
| Worker midnight schedule | 00:00 JST に min 0 / max 3 |
| Worker scale-out | queue visible >= 1、+1、cooldown 60 秒、Average |
| Worker scale-in | queue total <= 0 が15分継続、exact 0、cooldown 300 秒、Average |

ECR の基準イメージには `checkpoint-20260714-1500-jst` タグを追加し、lifecycle policy の通常世代削除から保護する。実行時は保護タグだけでなく、過去 task definition が実際に参照する release tag も同じ digest であることを検査する。Secret の基準版には `LYRA_CHECKPOINT_20260714_1500_JST` stage を付け、Secrets Manager の未ラベル旧版整理から保護する。

## 影響レイヤー

- Domain: manifest と検証結果の型、純粋な rollback plan
- Infrastructure / Ops: AWS CLI の限定コマンド実行、状態取得、切替、health check
- Worker: task definition と autoscaling の復元のみ。生成処理コードは変更しない
- DB: read-only compatibility check のみ。migration やデータを変更しない
- Web / Mobile / Route / Service / Repository: runtime 実装は変更しない

## 操作インターフェース

確認のみ。本番の設定とデータは変更しない:

```powershell
npm run prod:rollback:20260714 -- --profile lyra-admin-temp
```

本番へ適用:

```powershell
npm run prod:rollback:20260714 -- --apply --profile lyra-admin-temp --confirm 20260714T1500JST
```

このコマンドが切り替える「コード」は、本番 ECS が実行する API / worker イメージである。手元の Git branch や未コミットファイルには触れない。過去 commit に対応する本番イメージ、task definition、Secret、worker scaling を一つの操作で揃えるため、開発中のファイルを失わずに本番だけを基準点へ戻せる。

標準動作は必ず dry-run とする。`--apply` と完全一致する確認文字列の両方がない限り本番設定を変更しない。dry-run は、現在の API task definition と Secret を使う一時 Fargate task を 1 台起動して DB を読み取り専用検査し、終了後に停止する。作品・課金・生成ジョブ・schema は変更しないが、短時間の Fargate と CloudWatch Logs 利用料は発生する。

## 実行順序

1. AWS account と region が manifest と一致するか確認する。
2. API / worker の checkpoint tag と release tag が、どちらも基準 digest と一致するか確認する。
3. task definition が ACTIVE で、image digest、CPU architecture、container 名が一致するか確認する。
4. Secret の checkpoint stage と version を確認する。
5. SQS の visible / in-flight / delayed message が 0 であることを確認する。残っていれば中止する。
6. DB の `schema_migrations` と `generation_jobs` の active 件数を、15秒の statement timeout を持つ read-only transaction で取得する。基準 migration と明示許可した前方互換 migration だけであり、`queued` / `processing` job が 0 件である場合だけ続行する。
7. 現在の task definition、Secret AWSCURRENT、desired count、scaling target と schedule を receipt に保存する。Secret の値は保存しない。
8. worker autoscaling の dynamic / scheduled scaling を一時停止し、min capacity を 0 にする。
9. worker を 0 台にし、停止完了を待つ。
10. API を一時的に 0 台にし、切替中の新規 job enqueue を止める。
11. SQS と DB active job をもう一度確認する。最初の検査後に処理が増えていれば、版を切り替えず自動復旧する。
12. Secret の AWSCURRENT を checkpoint version へ移す。
13. worker service を checkpoint task definition へ変更する。
14. API service を checkpoint task definition と基準 desired count 1 へ同時に変更し、stable と ALB health 成功を待つ。
15. CloudFront cache を invalidation する。Web bundle は API image 内にあるため、古い HTML と新旧 asset の混在を防ぐ。
16. worker の scaling target、schedule、policy の増減方式・step・cooldown・集計方式を基準値へ合わせ、15:00 JST の desired count 1 を復元する。設定更新中は dynamic / scheduled scaling を停止し、全設定が揃ってから再開する。
17. API / worker の checkpoint tag と release tag が引き続き基準 digest を指すこと、task definition、Secret AWSCURRENT、worker scaling target / schedule / policy を再検証する。API は desired / running count 1 を必須とし、worker は利用中の正当なオートスケールを失敗扱いしないよう min 1 / max 3 の範囲を必須とする。
18. public health と readiness を再検証する。

API の切替前に worker を止めることで、新しい API payload を古い worker が処理する時間帯を作らない。SQS が空でない場合はロールバック自体を拒否する。

## 失敗時の自動復旧

手順 8 以降で失敗した場合、receipt を使って次の順に復旧する。

1. worker autoscaling を停止し、worker と API を 0 台にする。
2. Secret AWSCURRENT を切替前の version へ戻す。
3. API / worker service を切替前の task definition へ戻す。
4. API / worker の desired count を切替前の値へ戻し、両serviceがstableになるまで待つ。
5. scaling policy、target、suspended state、scheduled actionを切替前の値へ戻し、自動スケールを再開する。
6. CloudFront cache を invalidation する。
7. public health と readiness を確認する。

自動復旧にも失敗した場合は、成功した操作と失敗した操作を明記して終了する。Secret 値、token、DB URL は標準出力と receipt の双方に出さない。

## DB 互換性方針

基準 commit が持つ migration は `001` から `023`。現在確認済みの前方互換 migration として次だけを許可する。

- `024_add_generation_job_cancellation.sql`
- `025_include_cancelled_jobs_in_retention_index.sql`

これ以外の基準後 migration が DB に存在する場合は fail closed とする。カラム削除、型変更、制約強化を自動で「安全」と推測しない。`024` で追加された `cancelled` job は終端履歴として保持し、過去データを書き換えない。旧コードへ切り替える瞬間に active job が存在すると payload と worker 契約が混在するため、SQS と DB のどちらか一方でも active な処理が見つかれば拒否する。

## セキュリティ

- profile 名は受け取るが access key を引数、ログ、receipt に書かない。
- account ID と region を固定検証し、別アカウントへの誤操作を防ぐ。
- AWS CLI は引数配列で起動し、shell interpolation を使わない。
- manifest は Zod で bounded validation する。
- Secret は version ID と stage だけを扱い、値を取得しない。
- DB 検査は同一connectionのread-only transactionに限定し、15秒でqueryを打ち切る。
- receipt の保存先は Git 管理外とし、秘密値を含めない。
- CloudFront / ALB / Cognito / Stripe の現在の境界設定は変更しない。
- rollback 実行には明示確認文字列を要求する。

## テスト方針

先に次の失敗テストを追加する。

- account / region / digest 不一致を拒否する
- checkpoint tag と実行用 release tag のどちらか一方でも digest が違えば拒否する
- `--apply` に確認文字列がなければ拒否する
- SQS に message があれば変更計画を作らない
- DB に `queued` / `processing` job があれば変更計画を作らない
- 未承認 migration があれば拒否する
- Secret 値を receipt に含められない
- API / worker / Secret / scaling の復旧順序が固定される
- worker scaling policy のstepとcooldownまでmanifestから復元される
- API停止後に生成処理が増えた場合は版切替前に自動復旧する

最終検証:

```powershell
npm test
npm run build
npm run web:lint
npm run web:build
npm run prod:rollback:20260714 -- --profile lyra-admin-temp
```

本番 rollback 自体は本作業では実行しない。ECR tag と Secret stage の保護は runtime 動作を変えない metadata 操作として別途適用し、適用後に再度 dry-run する。

## Terra タスクパケット

`multi_agent_v1` が利用できないため、次をローカル検証チェックリストとして扱う。

- 目的: manifest と rollback planner の read-only 監査
- 所有範囲: `ops/rollback/**`, `scripts/rollbackProductionCheckpoint.ts`, `tests/unit/ops/**`
- 触らない範囲: routes、services、repositories、generation worker、billing、migrations、web、mobile
- Spec 根拠: 上記 3、5、6、7、9、10章
- 期待出力: unsafe state が一つでもあれば apply 前に停止すること、復旧計画が切替前 state を完全に参照すること

最終の統合判断と AWS metadata 適用判断は Sol が行う。
