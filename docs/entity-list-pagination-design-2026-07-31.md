# Entity list pagination design

## 目的と範囲

`GET /api/works/:work_id/entities`へoptionalなbounded opaque cursor
paginationを追加する。`limit`も`cursor`もない場合は、現在の
`EntityService.listEntities`と`EntityRepository.findByWorkIdAndUserId`を使い、
既存の`{ entities: [...] }` wireを変えない。`limit`を明示した場合だけ
page経路を使い、`next_cursor`を追加する。

本PRではEntityの作成・更新・削除、reference set、画像、生成ジョブ、Web / Mobile
画面、Migration、課金を変更しない。

## Spec根拠

- `docs/Lyra_Unified_Spec_v4.md` §3 Architecture
- 同 §4 Authentication and authorization
- 同 §5 Persistence and tenancy
- 同 §8 Input and output safety
- 同 §10 Verification gate

## インターフェースと互換性

- query: `limit`は1〜100、`cursor`は最大512文字
- cursor単独、不正整数、別endpoint用cursor、非canonical値は422
- legacy response: `{ entities: Entity[] }`
- page response: `{ entities: Entity[], next_cursor: string | null }`
- cursor wire: version、endpoint kind、`created_at`、Entity UUIDのcanonical
  base64url

現行の`created_at DESC`を維持し、同値時だけ`id DESC`を追加する。page queryは
`limit + 1`件を取得する。`created_at`は更新で変わらないため、既存Entityの編集が
page境界を動かすことはない。取得中に新規作成されたEntityは先頭側へ入るため、
継続cursorより後ろの既取得範囲へ混入しない。

## 影響レイヤー

- Domain: Entity一覧専用cursor codec
- Repository: work / personal / active organization scope付きkeyset query
- Service: 作品アクセス確認後のpage委譲
- Route / shared contract: optional queryとoptional `next_cursor`
- Mobile生成物: canonical schema同期のみ
- Infrastructure / Worker / Billing / Credit / Migration / UI: 変更なし

## セキュリティと性能

- Serviceは従来どおり`WorkReader`で作品アクセスを確認する。
- Repositoryもwork IDに加えてpersonal ownerまたはactive organization membership
  をSQLで再確認する。
- SQLはparameter bindingのみを使用する。
- cursorの内容を認可情報として信用しない。
- page queryの返却候補は最大101件とする。
- 既存`idx_entities_work`でworkを限定できるため、本PRでは本番indexを追加しない。

## TDDと検証

1. cursor codec、Repository scope/order/limit+1、Serviceのアクセス確認と委譲、
   Routeのlegacy互換・validation、shared contract、inventoryをredにする。
2. 最小実装でfocused testsとbackend buildをgreenにする。
3. 全Vitest/Bun、fresh migration/invariant、実PostgreSQL smoke、Web全gate、
   Mobile全gate、GitHub required CIを確認する。

## Sol / Terra

現在のセッション指示で新規sub-agent委譲が禁止されているため、Sol単独で設計・実装・
レビュー・検証する。
