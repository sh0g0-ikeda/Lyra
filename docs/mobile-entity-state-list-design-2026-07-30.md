# Mobile entity state list design

## 目的と範囲

PR #67から`GET /api/entities/:id/states`だけを独立し、本人またはactive organization memberが参照できるEntity state一覧APIを追加する。MobileのScene・Character編集が既存stateを選択するためのread-only endpointである。

0件は異常ではなく`200 { "entity_states": [] }`を返す。作成・更新・削除、DB schema、Web UI、Mobile UIは変更しない。

## Spec 根拠

- `docs/Lyra_Unified_Spec_v4.md` §3: Route / Service / Repository境界
- `docs/Lyra_Unified_Spec_v4.md` §4: personal ownership / active organization membership
- `docs/Lyra_Unified_Spec_v4.md` §8: response schema validation
- `docs/Lyra_Unified_Spec_v4.md` §10: release verification gate
- `docs/mobile-release-task-list-2026-07-30.md` GIT-110 PR-A

## インターフェース

- Input: path UUID `entity id`、任意の`organization_id` query
- Output: `{ entity_states: EntityState[] }`
- Sort: `created_at ASC, id ASC`
- Empty: 200と空配列
- Not found: 所有・所属を確認できないEntityは既存の`NOT_FOUND`
- Error: 契約外のRepository/Service値は`CONFIGURATION_ERROR`
- 永続化、外部API、ジョブ、クレジット: なし

## 影響レイヤー

- Route: GETを追加し、auth、rate limit、UUID、`view_work`、response schemaを適用
- Service: Entity ownershipを先に確認してからRepositoryへ委譲
- Repository: Entity・Work・active membershipでscopeしたparameterized SELECTを追加
- Shared contract: `{ entity_states }` wrapperを追加
- Tests: Contract、Route、Service、Repositoryを追加
- Domain / Migration / Infrastructure / Worker / Web / Mobile / Ops: 変更しない

## セキュリティ

1. IDを知っているだけでは参照できない。
2. personalは`works.organization_id IS NULL`かつ`entities.user_id`が本人である。
3. organizationは指定organizationとWorkが一致し、active membershipが存在する。
4. Routeでも`view_work` capabilityを要求する。
5. SQLは既存と同じparameter bindingのみを使う。
6. state内容、schema issue、secretをログやerrorへ追加しない。

## 必要十分条件

1. 本人のEntity stateを安定順で返す。
2. stateが0件なら200の空配列を返す。
3. 所有しないEntityはNOT_FOUNDにする。
4. organizationでは`view_work`とactive membershipを両方要求する。
5. itemはPR #95で統合済みの`entityStateSchema`を再利用する。
6. 契約外itemを成功応答として返さない。
7. 既存Scene/Entity state作成更新の挙動を変えない。

## テスト方針

先にContract、Route、Service、Repositoryの失敗テストを追加する。Route 404、Service method不存在、Repository method不存在、wrapper schema不存在を確認後に最小実装する。focused tests後、全Vitest / Bun、migration / invariant、Backend build、Web lint / build、Playwright smokeを実行する。

## Sol / Terra

指定された`skills/lyra-sol-terra-orchestration`は現行mainに存在せず、sub-agent委譲の明示指示もない。変更は1つのread-only endpointと3層の限定実装に閉じるため、ここに設計・境界・検証方針を残し、Sol単独で実装とレビューを行う。
