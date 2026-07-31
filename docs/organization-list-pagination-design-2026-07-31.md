# Organization list pagination design

## 目的と範囲

`GET /api/organizations`へoptionalなbounded opaque cursor paginationを追加する。
`limit`も`cursor`もない場合は、現在の`OrganizationService.listWorkspaces`と
`OrganizationRepository.listWorkspacesByUserId`、`{ organizations: [...] }` wireを
維持する。`limit`を明示した場合だけpage経路を使い、`next_cursor`を追加する。

本PRの「organization一覧」は、ログインユーザーがactive memberであるWorkspace一覧を
指す。member、invitation、invoice、usage、audit logの各一覧、組織作成・更新、残高・
課金、Migration、Web / Mobile画面は変更しない。

## Spec根拠

- `docs/Lyra_Unified_Spec_v4.md` §3 Architecture
- 同 §4 Authentication and authorization
- 同 §5 Persistence and tenancy
- 同 §7 Credits and billing
- 同 §8 Input and output safety
- 同 §10 Verification gate

## インターフェースと互換性

- query: `limit`は1〜100、`cursor`は最大512文字
- cursor単独、不正整数、別endpoint用cursor、非canonical値は422
- legacy response: `{ organizations: OrganizationWorkspaceSummary[] }`
- page response:
  `{ organizations: OrganizationWorkspaceSummary[], next_cursor: string | null }`
- cursor wire: version、endpoint kind、Organizationの`updated_at`、`created_at`、
  UUIDのcanonical base64url

現行の`updated_at DESC, created_at DESC`を維持し、同値時だけ`id DESC`を追加する。
page queryは`limit + 1`件を取得し、membershipとoptional balanceを従来と同じmappingで
返す。queryなしのSQLとwireは変更しない。

## 影響レイヤー

- Domain: Organization一覧専用cursor codec
- Repository: active membership付きkeyset query
- Service: page経路の委譲
- Route / shared contract: optional queryとoptional `next_cursor`
- Mobile生成物: canonical schema同期のみ
- Infrastructure / Worker / Billing / Credit / Migration / UI: 変更なし

## セキュリティ、整合性、性能

- SQLは`organization_members.user_id = viewer`かつ`status = 'active'`に限定する。
- cursorをmembershipや認可の証明として信用せず、毎page active membershipを再確認する。
- Stripe customer/subscription IDは従来どおりresponse mapperとstrict contractで除外する。
- SQLはparameter bindingのみを使用する。
- 既存membership user indexでviewerを限定し、最大101件だけ返す。
- Organization更新とpage取得が並行すると境界が動き得るため、Mobile接続時はIDで重複を
  除外し、refreshで正規順を再取得する。
- 実利用計測なしに本番indexを追加しない。

## TDDと検証

1. cursor codec、Repository active scope/order/limit+1、Service委譲、Routeのlegacy
   互換・validation、shared contract、inventoryをredにする。
2. 最小実装でfocused testsとbackend buildをgreenにする。
3. 全Vitest/Bun、fresh migration/invariant、実PostgreSQL smoke、Web全gate、
   Mobile全gate、GitHub required CIを確認する。

## Sol / Terra

現在のセッション指示で新規sub-agent委譲が禁止されているため、Sol単独で設計・実装・
レビュー・検証する。
