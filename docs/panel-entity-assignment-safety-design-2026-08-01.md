# Panel entity assignment safety design

## 目的と範囲

Mobile の Panel 登場要素編集を公開する前提として、既存の
`PUT /api/panels/:id/entities` に後方互換な条件付き全置換を追加する。
現行 endpoint は保存前の Panel snapshot を受け取らないため、Story 自動入力や
別 client の更新直後に古い assignment を無言で全置換できる。また Page の
`confirmed` / `generating` 状態と、保存済み会話 speaker の整合性を mutation 内で
確認しない。

この slice は条件付き保存に必要な Route / Service / Repository / tests / design
だけを変更する。既存の `entities` request field と response、Panel の保存 JSON、
Page / Scene / Entity の構造、共有 Mobile response contract、Prompt、SQS message、
generation job、credit / refund、Worker、Web、Mobile UI、migration は変更しない。
既存 client が送る `{ entities: [...] }` は従来経路のまま受理する。

## Spec 根拠

- Unified Spec §2: Page image は現在保存済みの Panel / Entity 入力から生成する。
- Unified Spec §4-5: personal ownership または active organization membership で
  scope し、PostgreSQL を system of record とする。
- Unified Spec §6: Story autofill は episode planning graph を lock し、入力
  fingerprint を再確認して Panel と assignment を原子的に更新する。手動保存も
  その lock 順と競合して silent overwrite を作ってはならない。
- Unified Spec §8: bounded Zod validation と安定した error を使う。
- StoryAI SubSpec §3/5/6: 1 Panel 最大8 Entity、speaker identity と assignment の
  整合性を生成前に維持する。Backend の既存 legacy 上限20はこの slice では変更せず、
  Mobile UI 側で8件に制限する。

## 現行契約と追加する条件付き契約

現行 body は次のまま維持する。

```json
{ "entities": [/* 保存後の完全な assignment */] }
```

安全な client は、同じ body に保存前 snapshot を任意 field として追加する。

```json
{
  "expected_entities": [/* GET panels で最後に確認した完全な assignment */],
  "entities": [/* 保存後の完全な assignment */]
}
```

`expected_entities` は既存 assignment schema、最大20件、Entity ID 一意を再利用する。
省略時は既存 Service / Repository 経路を変えない。指定時だけ次の処理を同一
PostgreSQL transaction で行う。

1. 認証 user と optional organization scope で Page を取得し、Page row を lock する。
2. 同じ Page の Panel row を lock する。Episode plan persistence と同じ
   `Page -> Panel -> Entity -> Entity state` の lock 順を維持する。
3. 現在の保存済み assignment と `expected_entities` を nullable field と順序を含む
   canonical semantic value で比較する。過去JSONの非custom時のstale custom値と
   effect note前後空白はrequest parserと同じ意味値へ正規化する。不一致は
   `409 CONFLICT` とし更新しない。
4. Page が `confirmed` / `generating` なら `409 CONFLICT` とし更新しない。
5. 現在の speech / thought / shout / whisper speaker が新しい assignment にすべて
   含まれることを確認する。不一致は `422 VALIDATION_ERROR` とする。
6. 新しい Entity を同一 work / tenancy で lock し、`state_id` をその Entity と同一
   work に属する state として lock する。不一致は既存どおり `422` とする。
7. Panel row の `entities` と `updated_at` を更新し、既存 response shape
   `{ entities: [...] }` を返す。

timestamp はDBのmicrosecond精度を既存APIのmillisecond文字列へ丸めるため、
optimistic tokenには使わない。assignment自身の完全 snapshotを比較することで、
同一millisecondの競合も検出する。

## 影響レイヤーとインターフェース

- Route: optional `expected_entities` をbounded schemaで受け、既存response mapperを再利用。
- Service: optional snapshot がある場合だけ条件付きRepository結果を domain errorへ変換。
- Repository: personal / organization scope、lock、semantic compare、speaker / Entity / state
  validation、updateを1 transactionで実行。
- Domain / Infrastructure / Worker / Web / Mobile / Ops: このsliceでは変更なし。
- Persistence: migrationなし。既存 `panels.entities` JSONBだけを更新する。

## セキュリティと整合性

- IDを知るだけでは対象をlockできない。personal workまたはactive organization
  membershipの既存scope predicateをtransaction最初のPage lookupで適用する。
- Entityとstateは同一workに限定し、parameter bindingと`jsonb_to_recordset`を使う。
- request bodyの最大件数・文字列長・enum・UUID・custom必須規則を既存schemaから再利用する。
- 条件付き経路でstored JSONが解釈不能な場合は空配列へ読み替えず保存を拒否して
  fail closedにする。既存経路のlenient parserは変更せず、過去データの読取互換性を
  維持する。
- 外部API、secret、credit、S3、LLMには触れない。
- 条件付き保存が先にlockを取った場合、後続Story autofillは既存fingerprint再確認で
  conflictする。Story autofillが先にcommitした場合、条件付き保存はsnapshot不一致で
  conflictする。

## エラーと互換性

- targetがscope内に存在しない: `404 NOT_FOUND`。
- snapshot不一致、confirmed / generating: `409 CONFLICT`。
- speaker、Entity、state不整合: `422 VALIDATION_ERROR`。
- 既存 bodyだけのclient: request / response / error mappingを変更しない。
- 条件付き成功responseもPanel identityや`updated_at`を増やさない。Mobileは後続sliceで
  authoritative `GET /pages/:id/panels` を再取得してcacheへ採用する。

## TDDと検証方針

先に以下を失敗テストとして追加し、実装前に期待どおりredを確認する。

- validator / Route: legacy body互換、expected snapshot受理、重複・件数・custom境界、
  organization引き渡し、条件付き結果のHTTP mapping。
- Service: legacy経路非変更、stale / Page status / speaker / Entity / state / not-found mapping。
- Repository unit: transaction必須、Page -> Panel -> Entity -> state lock順、parameter scope、
  response shape。
- PostgreSQL integration: personal / organization成功、stale snapshotで無更新、
  confirmed / generating無更新、speaker除去拒否、別work Entity / 別Entity state拒否、
  Story plan lockとの直列化後に片方がconflictしsilent overwriteが起きないこと。

対象テスト後、Backend Vitest / Bun、build、fresh migration / invariant / integration、
Mobile contract drift / typecheck / lint / tests / 両OS export、Web lint / build / Playwrightを
PR-ready gateとして実行する。Backend contractの追加なので全gateを省略しない。

## Terra委譲

Solが設計、transaction / lock順、実装、統合判断、最終検証を所有する。Terraには
既存Route / Service / Repository、Story autofill lock、speaker、Mobile dirty/cache境界の
read-only監査を委譲した。監査でP0なし、Mobile-only案にはPage status・replace-all競合・
speaker整合性のP1が確認されたため、このBackend先行sliceへ設計を変更した。実装後は
別のread-only validation packetでscopeと回帰を再監査する。
