# Page list pagination design

## 目的と範囲

`GET /api/episodes/:id/pages`へoptionalなbounded opaque cursor paginationを
追加する。queryなしの場合は、現在の`PageQueryService.listEpisodePages`と
`PageRepository.findPagesByEpisodeIdAndUserId`、`{ pages: [...] }` wireを維持する。
`limit`を明示した場合だけpage経路を使い、`next_cursor`を追加する。

本PRではPageの生成・更新・確定・再オープン、Panel/Frame/Balloon、Story autofill、
画像、Migration、Web / Mobile画面を変更しない。

## Spec根拠

- `docs/Lyra_Unified_Spec_v4.md` §3 Architecture
- 同 §4 Authentication and authorization
- 同 §5 Persistence and tenancy
- 同 §6 Generation jobs
- 同 §8 Input and output safety
- 同 §10 Verification gate

## インターフェースと順序

- query: `limit`は1〜100、`cursor`は最大512文字
- cursor単独、不正整数、別endpoint用cursor、非canonical値は422
- legacy response: `{ pages: PageSummary[] }`
- page response: `{ pages: PageSummary[], next_cursor: string | null }`
- cursor wire: version、endpoint kind、`page_number`、Page UUIDのcanonical
  base64url

現行の`page_number ASC`を維持し、同値時だけ`id ASC`を追加する。
`(episode_id, page_number)`はDBで一意だが、IDもcursorへ含めて順序を明示する。
page queryは既存のPanel/Frame/Balloon集計後に`limit + 1`件を返す。

## 影響レイヤー

- Domain: Page一覧専用cursor codec
- Repository: episode / personal / active organization scope付きkeyset query
- Service: Episodeアクセス確認後のpage委譲
- Route / shared contract: optional queryとoptional `next_cursor`
- Mobile生成物: canonical schema同期のみ
- Infrastructure / Worker / Billing / Credit / Migration / UI: 変更なし

## セキュリティ、整合性、性能

- Serviceは`StoryRepository.findEpisodeByIdAndUserId`でEpisodeアクセスを確認する。
- RepositoryもEpisodeからWorkまでjoinし、personal ownerまたはactive organization
  membershipをSQLで再確認する。
- SQLはparameter bindingのみを使用し、cursorを認可情報として信用しない。
- 既存`idx_pages_episode (episode_id, page_number)`を利用し、新規indexは追加しない。
- ページ番号の並べ替えが取得中に行われた場合は境界が動き得る。Mobile接続時はIDで
  重複排除し、refreshで正規順を再取得する。

## TDDと検証

1. cursor codec、Repository scope/order/aggregation/limit+1、ServiceのEpisode確認、
   Routeのlegacy互換・validation、shared contract、inventoryをredにする。
2. 最小実装でfocused testsとbackend buildをgreenにする。
3. 全Vitest/Bun、fresh migration/invariant、実PostgreSQL smoke、Web全gate、
   Mobile全gate、GitHub required CIを確認する。

## Sol / Terra

現在のセッション指示で新規sub-agent委譲が禁止されているため、Sol単独で設計・実装・
レビュー・検証する。
