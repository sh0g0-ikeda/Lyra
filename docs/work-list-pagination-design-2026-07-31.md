# Work list pagination design

## 目的と範囲

`GET /api/works`にoptionalなbounded opaque cursor paginationを追加する。
queryに`limit`も`cursor`もない場合は、現在と同じService / Repository経路と
`{ works: [...] }` wireをそのまま維持する。`limit`を明示した場合だけpage経路を使い、
`{ works: [...], next_cursor: string | null }`を返す。

本PRではworks以外の一覧、Work作成更新、Web client、Mobile画面、DB migration、
organization権限を変更しない。

## Spec根拠

- `docs/Lyra_Unified_Spec_v4.md` §3 Architecture
- 同 §4 Authentication and authorization
- 同 §5 Persistence and tenancy
- 同 §8 Input and output safety
- 同 §10 Verification gate

## 影響レイヤーとinterface

- Domain: works専用cursor codec
- Repository: personal / active organization scope付きkeyset page
- Service: page経路の委譲
- Route / shared contract: optional queryとoptional `next_cursor`
- Mobile生成物: canonical schemaの同期のみ
- Migration / Worker / Billing / Credit / Web / Mobile UI: 変更しない

queryは`limit`（1〜100）と`cursor`（最大512文字）で、cursor単独は422にする。
cursor wireはversion、endpoint kind、`updated_at`、`created_at`、UUIDをcanonical
base64url化する。別endpoint、非canonical日時、壊れたJSON、範囲外入力を拒否する。

## 順序と互換性

現行一覧の`updated_at DESC, created_at DESC`を維持し、同値時だけ`id DESC`を追加する。
page queryは`limit + 1`で次page有無を判断し、cursorは返却した最後のrowから作る。
cursorなしlegacy query自体は変更しないため、既存Webの件数、wire、Service呼出し、
表示順を変えない。

更新とpage取得が同時に起きた場合はsnapshotを固定しない。作品の`updated_at`変更により
page境界が動く可能性があるため、Mobile側は後続PRでID重複を除外する。APIは各page内の
決定的keyset順とscopeを保証する。

## セキュリティと性能

- personalは`user_id = viewer`かつ`organization_id IS NULL`に限定する。
- organizationは指定organizationとactive membershipをSQLでも再確認する。
- SQLはparameter bindingだけを使用する。
- legacy unbounded queryより負荷を増やさず、page queryは最大101 rowだけを返す。
- 新規indexは追加しない。user / organization既存indexでscopeを絞った後にsortし、
  実利用を計測せずproductionへconcurrent indexを増やさない。

## TDDと検証

1. cursor codec、Repository scope/order/limit+1、Service委譲、Route互換/validation、
   shared contractをredにする。
2. 最小実装後にfocused greenとbackend buildを確認する。
3. API inventory生成物を更新し、全Vitest/Bun、fresh migration/invariant、
   Web lint/build/E2E、Mobile全gateを確認する。

## Sol / Terra

現在のセッション指示で新規sub-agent委譲が禁止されているため、Sol単独で設計・実装・
レビュー・検証する。
