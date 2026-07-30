# Mobile `/api/compositions` response contract design

## 目的と範囲

PR #67のMobile API response contractから、副作用のない
`GET /api/compositions`だけを切り出す。既存WebとBackendのquery、service呼び出し、
JSON wire payloadを変更せず、Backend内部で不正な構図データを生成した場合だけ
成功レスポンスをfail closedにする。

対象:

- composition itemと一覧wrapperの共有Zod schema
- `/api/compositions`の成功レスポンス境界検証
- 現行wire互換性、不正item拒否、内部S3 key非開示のテスト

対象外:

- composition query schemaと検索条件
- Composition Service / Repository / DB
- Pages画面、構図選択、生成prompt
- 他Route、Mobile側schema生成、pagination、API inventory

## Spec根拠

- `docs/Lyra_Unified_Spec_v4.md` section 3: Routeのレスポンス変換責務
- `docs/Lyra_Unified_Spec_v4.md` section 4: 保護APIの認証
- `docs/Lyra_Unified_Spec_v4.md` section 5: S3 keyを公開しない画像契約
- `docs/Lyra_Unified_Spec_v4.md` section 8: 出力検証
- `docs/Lyra_Unified_Spec_v4.md` section 10: verification gate
- PR #67上の `docs/mobile-api-response-contract-design.md`

## 現行本番契約

`GET /api/compositions`は認証とrate limitの後、bounded queryを検証し、
CompositionGalleryServiceの結果を`{ compositions: [...] }`として返す。
レスポンスには`preview_cdn_url`を含むが、`preview_s3_key`は含めない。

WebとMobileは同じwrapperとsnake_case fieldを利用するため、field追加、削除、
rename、nullability変更、query既定値変更をこのPRでは行わない。

## 必要条件

1. auth middlewareとrate limit middlewareの順序を変更しない。
2. category、entity count、tag、limitのquery検証とservice入力を変更しない。
3. wrapperを`{ compositions: [...] }`のまま維持する。
4. 各itemのid、名称、category、entity count、CDN URL、prompt、shot、angle、
   tags、created timestampを検証する。
5. `preview_s3_key`をレスポンスへ追加しない。
6. schema検証後も元のwire payloadを返す。
7. 不正itemは200で返さず、安定した`ConfigurationError`で失敗する。

## 十分条件

次をすべて満たした場合だけ統合する。

- 現行Route fixtureが共有schemaを通る。
- 現行成功レスポンスのfieldと値が変更前後で一致する。
- `preview_s3_key`がレスポンスに存在しない。
- 負数entity countなどの不正なservice結果を200で返さない。
- query validation 422と未認証401が既存テストのまま成功する。
- Route、共有schema、テスト、設計文書以外を変更しない。
- 対象テスト、全Backend test、strict build、Web lint/build、Playwright、DB gateが成功する。

## 影響レイヤーとインターフェース

- Route: `/api/compositions`の成功payloadを返す直前に検証する。
- Shared contract: composition itemと一覧schemaを追加する。
- Service / Repository / Domain / Infrastructure / Worker / Web / Mobile / Ops:
  インターフェースと実装を変更しない。
- 永続化、外部API、ジョブ、credit: なし。

## セキュリティ

- 認証、rate limit、bounded queryを維持する。
- S3 keyを公開せず、既存CDN URLだけを返す。
- schema違反payloadやZod issueをレスポンス、ログへ展開しない。
- request値をschema選択やstorage pathへ使用しない。

## テスト方針

共有schemaとRoute境界のテストを先に追加し、export未存在で失敗することを確認する。
その後、最小schemaとRoute接続を実装する。

## 委譲方針

サブエージェント利用がこのセッションでは禁止されているため委譲しない。
設計、TDD、差分監査、統合判断はSolが単独で行う。

## ロールバック

DBとwire payloadを変更しないため、問題発生時はschema追加とRoute境界検証を
revertすれば従来の`/api/compositions`挙動へ戻る。
