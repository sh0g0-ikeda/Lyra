# Account deletion backend design (2026-07-31)

## 目的と範囲

認証中の本人が、個人の Lyra アカウントと個人作品を削除できる Backend
契約を追加する。途中失敗、重複要求、Stripe / Cognito / S3 の一時障害を
再実行しても、組織作品、組織課金、クレジット台帳、購入台帳を破壊しない
ことを最優先にする。

この変更に含めるもの:

- 本人専用の削除 preview / execute API
- 削除要求の fenced claim と checkpoint
- Stripe 個人購読の解約
- DB で確認した個人 S3 object key の exact delete
- 個人作品と直接識別子の削除・匿名化
- Cognito user の disable / delete
- 途中失敗を再開する bounded recovery runner
- 削除開始後の認証再作成、コンテンツ作成、課金権利再付与の防止

含めないもの:

- App Store / Google Play の購読をサーバーから強制解約すること
- 組織作品、組織課金、組織監査・利用履歴の削除
- 法令・不正対策・会計に必要な課金台帳の物理削除
- 本番 feature flag、IAM、ECS task の有効化
- Mobile UI（Backend contract 統合後の別工程）

`ACCOUNT_DELETION_ENABLED` は既定 `false` とし、Cognito、S3、Stripe、
identity HMAC secret の全設定が揃わない限り route を mount しない。

## Spec 根拠

- `docs/Lyra_Unified_Spec_v4.md` 1: migration / route / service / test を
  同じ contract change として更新する。
- 同 3: Route は入力と response、Service は workflow、Repository は
  transaction と SQL、Infrastructure は provider operation を所有する。
- 同 4: user ID を request body から受け取らず、認証 user だけを対象にする。
- 同 5: personal / organization scope を分離し、S3 は DB から得た exact key
  だけを削除する。
- 同 7: credit / billing の履歴と transaction 境界を維持する。
- 同 8: bounded Zod、parameterized SQL、sanitized error、provider timeout を使う。
- 同 9, 10: recovery と release gate を実装・検証する。

App Store は auto-renewable subscription がある場合、削除を続ける前に課金が
継続することを知らせ解約を求めるよう案内している。Google Play も購読解約が
必要な場合は明確な手順を示すことを求めている。このため store 購読は preview
で store、期限、自動更新状態、管理 URL を返し、明示 acknowledgement がない
削除要求を block する。即時削除の選択肢は残し、acknowledgement 後は entitlement
期限までアカウントを残さない。

- Apple: <https://developer.apple.com/support/offering-account-deletion-in-your-app>
- Google Play: <https://support.google.com/googleplay/android-developer/answer/13327111?hl=en>

## データ契約

適用済み migration 027 は編集せず、migration 037 で次を追加する。

- `users.account_deletion_started_at`
- `users.account_deleted_at`
- `account_deletion_requests.identity_key`
- `account_deletion_requests.next_retry_at`
- identity key の 43 文字 base64url shape と partial unique index
- started / deleted / completed checkpoint の時系列 constraint
- 削除開始済み user に対する content root write guard

`identity_key` は専用 secret による `HMAC-SHA256(Cognito sub)` の base64url
である。元の Cognito `sub` は identity delete が終わるまで既存
`identity_id` に保持し、完了時に `deleted:<user id>` へ置換する。HMAC key は
削除後の有効期限内 JWT が新しい Lyra user を自動作成することだけを防ぎ、
元の subject を復元できない。

content root write guard は次の user-owned table の insert / owner-changing
update を拒否する。generation / export job は、削除開始前から active だった
job の terminal 化を妨げず、terminal job を active に戻す retry だけを拒否する。

- `works`
- `entities`
- `generation_jobs`
- `entity_reference_upload_tokens`
- `episode_export_jobs`
- `mobile_push_tokens`

provider webhook が課金台帳を更新できなくなると無限 retry になるため、
subscription、payment、credit、store purchase table には同じ trigger を付けない。
代わりに billing service が account deletion 開始済み user の provider event を
処理済みとして記録し、plan / credit は変更しない。

## Preview と blocker

`GET /api/account/deletion` は次を返す。

- personal works は削除、account は匿名化、organization membership は解除
- 唯一の active owner になっている organization
- terminal でない personal Stripe subscription の件数
- pending または有効期間中の Apple / Google subscription と外部管理 URL
- personal S3 asset の件数
- active personal generation / export job の件数

execute は exact confirmation と、該当時だけ次の acknowledgement を要求する。

- personal subscription の即時解約
- personal asset の削除
- store 外部課金が別途継続し得ること

唯一の active owner と active personal job は acknowledgement できない blocker
である。owner を移譲するか job が terminal になるまで削除を開始しない。

## 削除対象

削除する:

- `organization_id IS NULL` の personal works と cascade する story / page / entity
- personal entity upload token
- mobile push token（token registry lock を取得し、未送信 delivery も停止）
- personal generation job の prompt / result / provider request identifier
- personal credit balance
- 本人 email、display name、Cognito subject
- 本人に一致する organization invitation email
- organization membership
- DB で確認できた次の exact S3 key
  - personal page generated image
  - personal entity reference image
  - personal generation candidate / source image
  - personal upload token object
  - personal episode export artifact

保持する:

- user rowを匿名化した foreign-key anchor
- credit ledger、payment record、subscription、mobile store purchase / event
- organization usage / audit と organization content
- organization の `created_by_user_id` など pseudonymous actor reference

保持する課金 record は account deletion 後の access 対象ではなく、email、
display name、Cognito subject と結び付けない。`plan_code` は `free`、
credit balance は削除する。削除後に到着した Stripe / store event は台帳上
deduplicate するが、plan / credit を再付与しない。

## Workflow と fencing

1. Route が認証 user と bounded confirmation body を Service へ渡す。
2. Service が preview を再取得して acknowledgement blocker を返す。
3. Repository transaction が user row と関連 organization row を lock し、
   unique owner、active personal job、購読、store 課金、asset と
   acknowledgement を再検証する。
4. 問題がなければ request を claim し、user の
   `account_deletion_started_at` と identity HMAC key を同時に保存する。
5. 以後の JWT request は provisioning されず、同じ subject の再作成も拒否する。
6. active personal Stripe subscription を stable idempotency key で解約する。
7. 現在の personal exact S3 key を個別削除し、key ごとに checkpoint を保存する。
8. final transaction が user / organization / personal roots を lock し、
   unique owner、active job、未解約 Stripe、未削除 asset を再検証する。
9. personal data を削除・匿名化し、`account_deleted_at` を保存する。
10. Cognito user を disable、delete する。既に存在しない user は成功と扱う。
11. plaintext identity、subscription ID、S3 key の checkpoint を破棄して
    HMAC tombstone だけを残し、request を completed にする。

全 checkpoint update は `processing_token` が一致するときだけ成功する。
claim は 10 分で stale とみなし reclaim できる。provider operation は
idempotent にし、stale worker の重複実行でも別 user や別 object を触らない。

失敗時は raw provider error を保存せず stable code、retry count、
`next_retry_at` を保存する。recovery runner は due request を bounded batch で
claim し、指数 backoff 後に未完 checkpoint から再開する。1 件の失敗で他の
request を止めない。

1 回の API / recovery attempt は外部処理を最大 25 step、かつ次の外部処理を
開始するまで 15 秒に制限する。上限に達した正常な continuation は retry count
を増やさず即時 recovery 可能な状態へ release する。各 Cognito / S3 command
自体にも 30 秒 timeout があるため、大量 asset や遅い provider が HTTP request
を無制限に占有しない。

## Organization concurrency

account deletion と member role / removal が同時に owner invariant を壊さないよう、
両方が organization row を先に `FOR UPDATE` し、次に member を検証する。
account deletion は organization ID 順で lock する。唯一 owner のままでは
membership を削除しない。

## Provider interface

- Stripe: personal subscription ID だけを cancel。stable idempotency key を使う。
- S3: configured bucket 内の DB-derived exact key だけを `DeleteObject`。
  prefix delete / ListObjects / user input interpolation はしない。
- Cognito: configured pool の `AdminDisableUser` / `AdminDeleteUser`。
  Cognito の固定 `sub` を Username として使い、UserNotFound は idempotent success。
- Cognito / S3 command は 30 秒で abort し、checkpoint recovery へ渡す。

外部処理は Infrastructure adapter に限定し、Route / Repository から呼ばない。

## API contract

- `GET /api/account/deletion`
  - 200: strict preview schema
- `POST /api/account/deletion`
  - body: exact `confirmation: "DELETE"` と 3 acknowledgement boolean
  - 200: completed
  - 202: durable request accepted / recovery pending
  - 409: structured blockers

response は canonical Mobile API schema に追加し、generated artifact と backend
inventory の drift check を更新する。provider error、identity ID、S3 key、
subscription ID は response に出さない。

## セキュリティ

- user ID、identity ID、S3 key、subscription ID は client から受け取らない。
- organization work / asset は `organization_id IS NULL` 条件がない限り削除しない。
- SQL は全て parameter binding。動的 column / table は固定 allowlist だけを使う。
- identity key と store key は用途別 secret を使う。
- log / response / PR に provider raw payload、token、secret を残さない。
- feature flag enabled 時は全 provider config を fail closed で検証する。

## テスト方針

先に failing tests を追加し、次を確認する。

- migration shape、constraint、trigger、deployment invariant
- identity HMAC の決定性・用途分離・入力境界
- deleted / processing identity の provisioning 拒否と通常 user の非回帰
- preview blocker と acknowledgement
- duplicate / concurrent claim、stale claim、processing-token fencing
- sole owner、active job、personal/org scope、asset rescan
- preview 後に増えた購読・store 課金・asset の transaction 内再検査
- exact S3 delete、Cognito not-found、Stripe idempotency
- push token registry との直列化、未送信 delivery の停止
- completed request から subscription ID / S3 key checkpoint が消えること
- checkpoint resume、provider failure、bounded recovery
- anonymization後の Stripe / store event が plan / credit を復活させない
- Route auth、validation、status code、strict response contract
- default-off wiring と production config fail-closed
- fresh migration 001-037、invariant 0、Backend / Web / Mobile の release gate

## Terra 委譲

委譲なし。認証、課金、組織 owner invariant、S3、Cognito、migration、
recovery が同一 transaction contract に跨がり、設計判断と統合レビューを
分離すると fencing と lock order の見落としが増えるため、Sol が一貫して
実装・検証する。
