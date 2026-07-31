# Backend API contract inventory design

## 目的と範囲

現行Backendで実際に登録されるHTTP endpointを静的に収集し、各endpointについて次を
機械検証できるinventoryを追加する。

- mount後のmethod / path
- 認証境界
- 成功responseの種類
- JSON / SSEで使用する共有contract
- pagination方式
- 定義元source

本PRではAPI、Service、Repository、DB、Mobile画面のwire動作を変更しない。
例外として、`src/app.ts`が先行登録する公開招待previewを、同じpathを持つ
`src/routes/organizations.ts`と同じ既存shared response contractへ接続する。
これは公開wireを変えず、契約外Service値だけをfail closedにする修正である。

works / entities / pages / organization一覧への新しいcursor paginationは、本inventoryで
現状を固定した後、各Repositoryの既存order・index・Web互換性を個別に監査する。
PR #67の汎用cursor実装を一括移植しない。

## Spec根拠

- `docs/Lyra_Unified_Spec_v4.md` §3 Architecture
- 同 §4 Authentication and authorization
- 同 §5 Persistence and tenancy
- 同 §8 Input and output safety
- 同 §10 Verification gate

## 影響レイヤー

- Ops / CI: inventory生成、drift check
- Route: 公開招待previewのshared contract guardのみ
- Docs: 自動生成されたBackend API inventory
- Service / Repository / Domain / Worker / Web / Mobile / Migration: 変更しない

## Inventory契約

- `src/routes/*.ts`と`src/app.ts`のliteralなHono route登録だけを対象にする。
- route fileごとのmount prefixを明示し、routeを持つ未知fileはfail closedにする。
- 同じmethod / pathが複数sourceにある場合は統合し、response分類が一致しなければ失敗する。
- consumer JSONは`assertMobileResponseContract`を必須とする。
- health、provider webhook ack、binary、CSV、204、SSE、local preflight、Web staticは
  明示分類し、暗黙の例外を許可しない。
- `--write`だけがMarkdownを更新し、`--check`は差分があれば失敗する。
- job履歴はopaque cursor（1〜100、最大512文字）、composition一覧はbounded limit
  （1〜250）、その他は現行complete collectionとして記録する。

## セキュリティ

- inventoryはsourceだけを読み、環境変数、DB、外部APIへアクセスしない。
- route path、schema名、source pathだけを出力し、secretやruntime値を含めない。
- 公開招待previewはtoken自体を応答・ログへ出さず、既存最小response schemaを再利用する。
- 認証分類は公開 / provider / local / operator / authenticatedを明示する。

## TDDと検証

1. inventory check未実装と公開previewの契約外payload受理をredで確認する。
2. collector、分類、deterministic Markdown、drift checkを実装する。
3. 公開previewを既存schema guardへ接続する。
4. focused test、backend build、全Vitest/Bun、fresh migration/invariant、
   Web lint/build/E2E、Mobile全gateを確認する。

## Sol / Terra

Solが設計、分類例外、統合、最終検証を担当する。現在のセッション指示で新規sub-agent
委譲が禁止されているため、本PRはSol単独で進める。
