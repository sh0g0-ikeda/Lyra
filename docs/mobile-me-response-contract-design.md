# Mobile `/api/me` response contract design

## 目的と範囲

PR #67のMobile API response contractを、一度に全Routeへ接続せず、
セッション初期化で利用する`GET /api/me`だけへ適用する。既存WebとBackendが
利用しているwire payloadを変更せず、Backend内部で不正な成功レスポンスを
生成した場合だけ500としてfail closedにする。

対象:

- `/api/me`の成功レスポンスを表す最小の共有Zod schema
- `/api/me`成功payloadのレスポンス境界検証
- schema適合、wire互換性、不正なcredit値の拒否を確認するテスト
- production Docker buildへ共有contract sourceを含める最小配線

対象外:

- `/api/me`以外のRoute
- Mobile側へのschema生成
- 認証middleware、credit計算、organization取得処理の変更
- DB、migration、Web、Mobile UI、外部API、runtime設定の変更

## Spec根拠

- `docs/Lyra_Unified_Spec_v4.md` section 3: Routeのレスポンス変換責務
- `docs/Lyra_Unified_Spec_v4.md` section 4: 認証とorganization membership
- `docs/Lyra_Unified_Spec_v4.md` section 5: personalとorganizationの分離
- `docs/Lyra_Unified_Spec_v4.md` section 7: personalとorganization creditの分離
- `docs/Lyra_Unified_Spec_v4.md` section 8: 出力検証
- `docs/Lyra_Unified_Spec_v4.md` section 10: verification gate
- PR #67上の `docs/mobile-api-response-contract-design.md`

## 現行本番契約

`GET /api/me`は認証済みユーザーについて次を返す。

- `user`: id、email、display name、plan code
- `personal_credits`: personal残高。CreditService未設定時は`null`
- `organizations`: userが所属するworkspaceのrole、status、plan、共有残高

Webは`apps/web/src/lib/api.ts`からこのendpointを利用する。したがってfield名、
nullability、配列構造、数値、日時文字列を変更しない。

## 必要条件

1. 既存のauth middlewareとrate limit middlewareの順序を変更しない。
2. organizationは`listWorkspaces(user.id)`で取得し、request由来のorganization IDを
   使用しない。
3. personal creditとorganization creditを別fieldとして維持する。
4. 現行の正常payloadをschemaが受理する。
5. 検証後も元のpayloadを返し、default追加やtransformをwireへ反映しない。
6. creditは整数かつ0以上、roleとorganization状態は既知値だけを受理する。
7. schema違反時はpayloadを返さず、安定した`ConfigurationError`で失敗する。
8. production Docker buildが共有contract sourceを含み、コンパイルできる。

## 十分条件

次をすべて満たした場合だけ統合する。

- 現行Route fixtureがschemaを通る。
- 現行RouteのJSON完全一致テストが変更後も通る。
- personal creditが負数の内部payloadを200で返さない。
- schema単体で未知role、未知organization状態、不正email、負数creditを拒否する。
- 未設定のoptional serviceが返す`personal_credits: null`と空organization配列を受理する。
- auth、rate limit、service呼び出し、レスポンスfieldに意図しない差分がない。
- Dockerfileのbuild stageだけへ`packages/`を追加し、runtime imageへsourceを残さない。
- 対象テスト、全Backend test、strict build、Web lint/build、Playwright、DB gateが成功する。

## 影響レイヤーとインターフェース

- Route: `/api/me`の成功payloadを返す直前に検証する。
- Shared contract: `currentSessionSchema`を最小構成で追加する。
- Ops: production Dockerのbuild stageへ共有contract sourceを追加する。
- Service / Repository / Domain / Infrastructure / Worker / Web / Mobile:
  インターフェースと実装を変更しない。
- 永続化、外部API、ジョブ: なし。

## セキュリティ

- 既存の認証とuser IDによるworkspace scopeを維持する。
- schema違反のpayloadやZod issueをログ、レスポンスへ展開しない。
- credit残高が不正な場合に成功レスポンスとして表示しない。
- personalとorganizationの残高を合算しない。

## テスト方針

共有schemaとRoute境界のテストを先に追加し、schemaファイルが存在しないため失敗する
ことを確認する。その後、最小schemaとRoute接続を実装する。Dockerfileの配線は
必要なCOPYがない場合に失敗するテストを先に追加してから修正する。

## 委譲方針

サブエージェント利用がこのセッションでは禁止されているため委譲しない。
設計、TDD、差分監査、統合判断はSolが単独で行う。

## ロールバック

DBとwire payloadを変更しないため、問題発生時はschema importとRoute境界検証、
共有schema、Dockerfileの追加COPYをrevertすれば、従来の`/api/me`挙動へ戻る。
