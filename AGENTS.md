# AGENTS.md - Lyra 実装エージェント行動規範

Lyra を実装する AI エージェントは、作業開始前にこのファイルを読み、作業中ずっと遵守する。

## 0. 権威順と最初に読むもの

作業開始時に必ず確認する。

1. `docs/Lyra_Unified_Spec_v4.md`
2. `AGENTS.md`
3. `git status --short --branch`
4. `git log --oneline -10`
5. 対象領域の routes / services / repositories / domain / tests / migrations

仕様が衝突する場合の権威順は `docs/Lyra_Unified_Spec_v4.md` に従う。現行 Spec はフェーズ番号ではなく実装契約の索引であるため、旧フェーズ名が見つからない場合は最も近い Spec セクションを根拠として明記する。

何も作る前に必ず設計する。設計してから手を動かす。

## 1. Sol/Terra オーケストレーション

中規模以上の実装、調査、リファクタ、CI 修正、セキュリティ修正では `skills/lyra-sol-terra-orchestration` を使う。

- GPT-5.6 Sol: 設計責任者、統合判断、最終レビュー、検証方針を担当する。
- GPT-5.6 Terra: Sol が切り出した read-only 調査、限定実装、検証を担当する。
- Terra に渡す作業は、目的、所有ファイル、触ってはいけない範囲、Spec 根拠、期待出力を明記する。
- Terra の結果は Sol が必ずレビューする。設計判断、統合判断、セキュリティ判断を Terra に丸投げしない。
- `multi_agent_v1` が使えない場合は、Terra タスクパケットをローカルチェックリストとして扱う。

小さな単一ファイル修正では、委譲コストが勝る場合がある。その場合は「委譲なし」と理由を記録して Sol 単独で進める。

## 2. 必須ワークフロー

### 2-1. 設計フェーズ

実装前に以下を言語化する。

- 目的と範囲: 何を作るか、何を作らないか。
- Spec 根拠: `docs/Lyra_Unified_Spec_v4.md` の該当セクション。
- 影響レイヤー: Route / Service / Repository / Domain / Infrastructure / Worker / Web / Mobile / Ops。
- インターフェース: 入力、出力、永続化、外部 API、ジョブ、エラー。
- セキュリティ: 認証、認可、テナンシー、入力検証、SQL、シークレット、クレジット、ファイル。
- テスト方針: 先に追加するテスト、期待する失敗、最終検証コマンド。
- Terra 委譲方針: 委譲する作業と所有範囲、または委譲しない理由。

設計内容は、チャットだけでなくリポジトリに残るコメント、設計メモ、テスト名、PR 本文のいずれかに反映する。無意味なコードコメントは増やさない。

### 2-2. Git ベースライン

原則として main から作業ブランチを切る。

```bash
git checkout main
git pull origin main
git checkout -b {type}/{scope}
```

既に作業ブランチ上、または worktree にユーザーの未コミット変更がある場合は、切り替え、pull、reset、checkout で壊さない。現在の安全な HEAD から続ける場合は、その理由と既存 dirty path を記録する。

ブランチ名の例:

- `feature/entity-import-flow`
- `fix/credit-deduction-race`
- `refactor/panel-service-solid`
- `chore/add-migration-024`
- `docs/update-agent-rules`

### 2-3. TDD と実装

コード変更では先にテストを書く。新しいテストが期待どおり失敗することを確認してから実装する。

例外は次だけ:

- ドキュメントのみの変更
- 先に失敗テストを作る意味が薄い純粋な配線変更

例外にする場合は理由を記録する。

実装時は以下を守る。

- 1 つの変更は 1 つの責任に絞る。
- 既存のパターンとディレクトリ境界に合わせる。
- 共有コード、認可、クレジット、ジョブ、マイグレーションを触る場合は検証範囲を広げる。
- ユーザーや他エージェントの未コミット変更を戻さない。

### 2-4. 検証

まず対象に最も近いテストを実行し、共有契約に触れたら範囲を広げる。

代表コマンド:

```bash
npm test
npm run build
npm run web:lint
npm run web:build
npm run db:check-invariants
npm run web:e2e
```

リリース前は Spec の Verification gate を満たす。少なくとも Vitest/Bun、マイグレーションと invariant、backend build、frontend lint/build、Playwright smoke を確認する。

### 2-5. コミット、push、PR

実装タスクではコミット、push、PR 作成まで行う。ユーザーが明示的に local-only、no-commit、no-push を指示した場合、または認証や tooling の都合で不可能な場合だけ例外にする。

コミットメッセージ:

```text
{type}({scope}): {動詞で始まる簡潔な変更内容}
```

type:

- `feat`: 新機能
- `fix`: バグ修正
- `refactor`: 動作変更なしの整理
- `test`: テスト追加、修正
- `chore`: 設定、依存関係、DB、運用
- `docs`: ドキュメント

PR 本文には以下を含める。

```markdown
## 概要

## 変更内容

## 根拠となるSpec箇所

## テスト

## セキュリティ確認
```

## 3. アーキテクチャ境界

`docs/Lyra_Unified_Spec_v4.md` の Architecture を正とする。

- `src/routes`: HTTP 入力、認証、認可、Zod 検証、レスポンス変換。
- `src/services`: ビジネスワークフロー、トランザクション境界、クレジット判断、ジョブ投入。
- `src/repositories`: パラメータ化 SQL と永続化詳細。
- `src/domain`: 型、定数、ドメインエラー、純粋ロジック。
- `src/infrastructure`: OpenAI、AWS、Stripe、ローカル adapter。
- `worker`: 非同期生成ジョブ実行。
- `apps/web`: React browser client。
- `apps/mobile`: mobile client。

Routes に provider 呼び出し、クレジット計算、SQL 詳細を置かない。Services は ports/interfaces に依存し、Repositories が persistence を担当する。

## 4. セキュリティ必須事項

### 4-1. 認証と認可

- 保護 API は認証必須。
- ID を知っているだけではアクセスを許可しない。
- personal ownership または active organization membership で必ずスコープする。
- organization role は編集権限と billing 権限を混同しない。
- 公開 endpoint は health/readiness、Stripe webhook、静的 asset、必要な invitation flow など明示されたものに限る。

### 4-2. 入力、SQL、出力

- request body は bounded Zod schema で検証する。
- 文字列には最大長を置く。
- SQL は parameter binding のみ使う。
- LLM structured output は schema validation と quality gate 後に保存する。
- raw provider error、stack trace、credential、connection string をユーザーへ返さない。

### 4-3. シークレット

- API key、password、JWT secret、DB URL は環境変数または secrets manager から読む。
- `.env` や秘密情報をコミットしない。
- ログ、テスト fixture、PR 本文にも秘密情報を出さない。

### 4-4. ファイルと画像

- 画像 upload は MIME type と size を検証する。
- S3 key や storage path にユーザー入力を直接入れない。
- production image delivery は authenticated export または短命 URL を使う。

### 4-5. クレジットと billing

- クレジット消費は transaction 内で row lock し、ledger と一緒に更新する。
- failed chargeable job は idempotent に refund する。
- Stripe webhook は signature verification 後だけ信用する。
- browser return URL だけで credit を付与しない。

## 5. DB とマイグレーション

- `migrations/` は連番で管理する。
- 適用済み migration は編集しない。変更は新規 migration で行う。
- contract 変更は migration、テスト、Spec 更新をセットにする。
- テーブル削除やカラム削除は段階的に行う。
- 本番影響のある index 追加は lock と rollout を考慮する。

## 6. 外部 API と生成ジョブ

- 外部 API 呼び出しには timeout を置く。
- retry は 429 や 5xx など retryable failure のみに限定する。
- client error を無条件 retry しない。
- generation_jobs の active uniqueness、SQS visibility、provider timeout、retry classification、recovery、refund の整合性を崩さない。
- regeneration は現在保存済み input から新規生成する。過去の生成画像を暗黙の参照画像にしない。

## 7. コード品質

- TypeScript は strict を前提にする。
- `any` は禁止。必要なら `unknown` と型ガードを使う。
- 関数の戻り値型を明示する。
- マジックナンバーは domain constants に置く。
- 早期 return で深いネストを避ける。
- 単一責任を守る。抽象化は重複や複雑さを実際に減らす場合だけ追加する。
- ユーザー向けエラーは安定した code/message を返す。

## 8. テスト方針

- テスト名は「〇〇の場合に〇〇になる」の形式を基本とし、日本語で書く。
- 正常系、異常系、境界値を必要範囲でカバーする。
- Infrastructure は mock してよい。Domain/Service はできるだけ純粋にテストする。
- Route は auth、validation、not found、ownership を確認する。
- Repository や migration 変更は DB contract と invariant を確認する。
- Web の user-facing flow を変える場合は lint/build と Playwright smoke を検討する。

## 9. 禁止事項

| # | 禁止事項 |
|---|---|
| G-1 | 設計フェーズなしで実装する |
| G-2 | main に直接コミットする |
| G-3 | secret をコード、ログ、テスト、PR に書く |
| G-4 | `any` を使う |
| G-5 | テストなしで実装 PR を出す |
| G-6 | 1 コミットに無関係な変更を混ぜる |
| G-7 | `user_id` や organization scope を省いた DB/API access を作る |
| G-8 | LLM 出力を validation なしで保存する |
| G-9 | 適用済み migration を編集する |
| G-10 | クレジット消費を transaction 外で行う |
| G-11 | ユーザーや他エージェントの未コミット変更を戻す |
| G-12 | destructive git command を曖昧な指示で実行する |

## 10. 完了報告

作業完了時は、素人にも分かる言葉で以下を報告する。

```markdown
## 今回の作業報告

### 何を作ったか（一言で）

### なぜそれを作ったか

### 具体的にどういう動きをするか（ユーザー目線で）

### 技術的に工夫した点（プログラマー向け）

### 残課題・注意点
```

実行したテスト、実行できなかったテスト、既存の未コミット変更、PR URL がある場合は必ず含める。

## 11. 参照ドキュメント

| ドキュメント | 内容 |
|---|---|
| `docs/Lyra_Unified_Spec_v4.md` | 現行実装契約 |
| `docs/Lyra_StoryAI_SubSpec.md` | StoryAI 詳細仕様 |
| `skills/lyra-sol-terra-orchestration/` | Sol/Terra オーケストレーション |
| `migrations/` | DB schema 変遷 |
| `tests/fixtures/` | テストデータ |

AGENTS.md は設計、仕様、運用規約が変わった場合に更新する。

最終更新: 2026-07-14
