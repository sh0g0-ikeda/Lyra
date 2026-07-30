# Mobile store purchase ledger migration 029 design

## 目的と範囲

Apple / Googleの個人向け購入を、raw provider証跡を保存せず冪等に処理するためのDB土台を追加する。

対象はmigration 029、deployment invariant、契約テストだけである。StoreKit / Google Play verifier、購入Service / Repository / Route、Webhook、商品mapping、Mobile課金SDK、クレジット付与処理は接続しない。

## Spec根拠

- `docs/Lyra_Unified_Spec_v4.md` Billing、Security、Data and migrations、Verification gate
- `docs/mobile-release-task-list-2026-07-30.md` GIT-110 PR-C / DB-300 migration 029

## 影響レイヤー

- Domain: 変更なし
- Route / Service / Repository: 変更なし
- DB: 個人購入台帳、provider event台帳、credit ledgerのnullable idempotency keyを追加
- Infrastructure / Worker / Web / Mobile / Ops: 変更なし

## 永続化契約

`mobile_store_purchases`は個人`user_id`だけに紐付き、organization scopeを持たない。Apple original transaction IDまたはGoogle purchase tokenは保存せず、将来のServiceがHMAC-SHA256 base64urlへ変換した43文字のkeyだけを保存する。

冪等性は三段階で保護する。

1. `(store, external_purchase_key)`で同一購入を一意にする。
2. provider eventを`(store, event_key)`、課金操作を`(store, transaction_key, operation)`で一意にする。
3. credit ledgerの`mobile_store_event_key`を一意にし、付与・反転の二重実行を防ぐ。

購入状態、store、environment、商品種別、plan / credit package対応、付与済み・反転済みcredit量、key形状、provider event metadataをDB制約で固定する。`purchase_reversal`は負数だけを許可する。

## 現mainとPR #67案からの補強

- raw token/JWSを誤保存しにくくするため、全HMAC keyを43文字に制限する。
- product IDとprovider event typeを1〜255文字、event metadataをJSON objectに制限する。
- financial auditをhard deleteで失わないよう、purchaseのuser FKを`ON DELETE RESTRICT`にする。通常のアカウント削除はuser行を匿名化する。
- `CREATE INDEX CONCURRENTLY`の前に同名indexを`DROP INDEX CONCURRENTLY IF EXISTS`し、途中失敗後の再実行でinvalid indexを作り残しにくくする。
- migrationは`no-transaction`でstatement単位に実行し、各constraint / index操作を再実行可能にする。

## セキュリティ

- organization creditへ到達する列・経路を追加しない。
- raw StoreKit JWS、Google purchase token、provider credential、価格、client申告stateを保存しない。
- credit ledgerの追加keyはnullableで、既存Stripe / Web課金経路を変更しない。
- Store側で検証済みの証跡だけを処理するService / verifierとfeature flagが揃うまでAPIをmountしない。

## 既存運用への影響

- 課金挙動: 変化なし。Route / Service / Repositoryが未接続なのでApple / Google購入は受け付けない。
- Web / Stripe: 既存typeを維持し、DB enumへ未使用の`purchase_reversal`を加えるだけである。
- migration時間: 新規tableは空。credit ledgerのnullable列追加はdefaultなし、indexはconcurrent。constraint差し替え時の短いtable lockと既存ledger検証scanは発生し得るため、本番preflightとone-off migrationで時間を計測する。
- rollback: API未接続のため、問題時は新機能を有効化せずDB追加物を残してよい。適用済みmigrationは編集・巻き戻ししない。

## account deletionとの境界

購入台帳が入るとactive Mobile subscription数を照会できるが、PR #67のAccountDeletionServiceはMobile購読を解約せず、acknowledge後に処理を続行する。store解約導線・entitlement終期・identity削除方針が確定するまでaccount deletion APIもmountしない。

## テスト方針

先にmigrationと5つのdeployment invariantを要求するテストを追加し、migration不在・invariant不在のredを確認した。実装後は以下を確認する。

- focused migration / invariant test
- fresh PostgreSQLへ001〜029を適用
- deployment invariant
- Vitest / Bun
- Backend build
- Web lint / build
- Playwright smoke

## Sol / Terra

利用可能な`skills/lyra-sol-terra-orchestration`が作業環境に存在しないため委譲しない。credit constraintを含むため、Sol相当の設計・実装・差分レビュー・全ゲート確認を同一作業で行う。

