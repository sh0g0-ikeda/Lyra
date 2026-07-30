# Mobile response contract foundation design

## 目的と範囲

PR #67から、Mobile向けJSONレスポンスをZod schemaで検証するための純粋な
境界ヘルパーだけを切り出す。この段階では既存Routeへ接続せず、APIレスポンス、
DB、Worker、Web、Mobileの実行時挙動を変更しない。

対象:

- `assertMobileResponseContract`の追加
- 変換、default、不正値、情報漏えいを確認する単体テスト

対象外:

- 共有API schema/type/payloadの追加
- 既存Routeへのレスポンス検証の接続
- Mobileアプリ、migration、外部API、本番設定の変更

## Spec根拠

- `docs/Lyra_Unified_Spec_v4.md` section 3: Routeはレスポンス変換を担当する
- `docs/Lyra_Unified_Spec_v4.md` section 8: 出力検証と秘密情報の非開示
- `docs/Lyra_Unified_Spec_v4.md` section 10: release verification gate
- PR #67上の `docs/mobile-api-response-contract-design.md`

## 必要条件

1. 任意のZod schemaとwire payloadを受け取れる。
2. schemaのtransformやdefaultを実行して検証できる。
3. 検証成功時はparse後の値ではなく、元のwire payloadを同一参照で返す。
4. 検証失敗時は安定した`ConfigurationError`を投げる。
5. 例外メッセージにpayload値やZod issueの詳細を含めない。

## 十分条件

次をすべて満たした場合だけ、この基盤を統合可能と判断する。

- transform付きschemaでも元のwrapper objectを返すテストが成功する。
- default付きschemaでも省略fieldをwire payloadへ追加しないテストが成功する。
- 不正payloadを拒否するテストが成功する。
- 不正payload内の秘密値を例外へ含めないテストが成功する。
- TypeScript strict build、全Backendテスト、既存Web gateが成功する。
- 差分が新規ヘルパー、単体テスト、この設計文書だけである。

このPR単体ではRouteに接続しないため、既存本番APIを変更しない。後続PRでRouteへ
接続する際は、Routeごとにauth、tenancy、正常レスポンス、既存wire互換性を別途
証明する。

## 影響レイヤーとインターフェース

- Route: 将来利用する純粋ヘルパーを追加するが、現行Routeには未接続。
- Domain: 既存の`ConfigurationError`を再利用し、型やエラー契約は変更しない。
- Service / Repository / Infrastructure / Worker / Web / Mobile / Ops: 変更なし。
- 入力: `ZodType`と検証対象payload。
- 出力: 検証前と同一のpayload。
- 永続化、外部API、ジョブ: なし。

## セキュリティ

- `safeParse`の失敗詳細をクライアント向けエラーへ展開しない。
- payloadをログへ出力しない。
- schemaの選択へrequest値を使用しない。
- 認証・認可・テナンシーには触れない。

## テスト方針

先に単体テストを追加し、実装ファイルが存在しないため失敗することを確認する。
その後に最小実装を追加し、対象テスト、Backend全体、build、Web gate、Playwright
smokeの順で検証する。

## 委譲方針

サブエージェント利用がこのセッションでは禁止されているため、委譲しない。
設計、実装、差分監査、検証、統合判断はSolが単独で行う。

## ロールバック

現行Routeから未参照の新規ファイルだけなので、問題が見つかった場合は該当PRを
revertしても本番API、DB、ジョブ、Webの状態へ影響しない。
