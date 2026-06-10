\# AGENTS.md — Lyra 実装エージェント行動規範



本ファイルはLyraを実装するAIエージェント（Claude Code等）が\*\*必ず最初に読み、全ての作業を通じて遵守する\*\*ルール集である。



\---



\## 0. 最初に必ず読むこと



作業を開始する前に以下を確認する。



1\. `docs/Lyra\_Unified\_Spec\_v4.md` を読む（設計の正本）

2\. 本ファイル（AGENTS.md）を読む

3\. `git status` と `git log --oneline -10` で現在の状態を把握する

4\. 実装対象の機能がどのフェーズに属するかをSpecで確認する



\*\*何も作る前に必ず設計を考える。考えてから手を動かす。\*\*



\---



\## 1. 作業の進め方（必須フロー）



\### 1-1. 作業開始前：設計フェーズ



実装に入る前に以下を行う。



```

① タスクの目的と範囲を言語化する

&#x20;  - 何を作るのか

&#x20;  - 何に影響するのか（既存コードへの影響）

&#x20;  - どのSpecのセクションが根拠か



② 設計を考える

&#x20;  - 関数/クラスの責任範囲は何か

&#x20;  - どのレイヤーに置くべきか（Route / Service / Repository / Domain）

&#x20;  - どのインターフェースを定義するか

&#x20;  - エラーケースは何か



③ セキュリティリスクを洗い出す（後述）



④ 設計内容をコメントとして先に書く（実装の前に）

```



設計フェーズを飛ばして実装から入ることを禁止する。



\### 1-2. ブランチ作成



```bash

\# mainブランチから必ずブランチを切る

git checkout main

git pull origin main

git checkout -b {type}/{scope}



\# ブランチ命名規則

feature/entity-import-flow      # 新機能

fix/credit-deduction-race       # バグ修正

refactor/panel-service-solid    # リファクタリング

chore/add-migration-001         # 設定・インフラ・DB変更

docs/update-api-spec            # ドキュメント

```



\### 1-3. 実装フェーズ



```

① テストを先に書く（TDD）

&#x20;  - 正常系・異常系・境界値を網羅

&#x20;  - テストが失敗することを確認してから実装を始める



② 実装する

&#x20;  - 1コミット = 1つの論理的変更

&#x20;  - 動作確認しながら進める



③ テストが全て通ることを確認する

&#x20;  npm test （または該当テストコマンド）



④ コードレビューチェック（後述）を自分で行う

```



\### 1-4. コミット



```bash

\# コミットメッセージ形式

{type}({scope}): {変更内容を動詞で簡潔に}



\# 例

feat(entity): add image import and GPT-4o spec extraction

fix(credit): fix race condition in concurrent deduction

refactor(page): extract page generation logic to PageService

test(auth): add middleware tests for expired JWT

chore(db): add migration 004 for entity\_states table



\# typeの種類

feat     新機能

fix      バグ修正

refactor リファクタリング（動作変更なし）

test     テスト追加・修正

chore    設定・依存関係・DB migration

docs     ドキュメント

```



\### 1-5. プッシュ → プルリクエスト



```bash

git push origin {branch-name}

```



プッシュ後、必ずプルリクエストを作成する。PRには以下を記載する。



```markdown

\## 概要

何をしたか（1〜3文で）



\## 変更内容

\- 変更点1

\- 変更点2



\## 根拠となるSpec箇所

Lyra\_Unified\_Spec\_v4.md § XX



\## テスト

\- \[ ] 単体テスト追加・通過

\- \[ ] 手動動作確認済み



\## セキュリティ確認

\- \[ ] 入力バリデーション済み

\- \[ ] 認証・認可チェック済み

\- \[ ] シークレットのハードコードなし

```



\### 1-6. マージ後の説明（必須）



作業完了後、以下のフォーマットで\*\*素人にわかるように\*\*説明する。



```

\## 今回の作業報告



\### 何を作ったか（一言で）

例: 「PCの画像をアップロードしてキャラクターを登録できる機能を作りました」



\### なぜそれを作ったか

例: 「ユーザーが既に描いたイラストや写真をLyraに取り込んで使えるようにするためです」



\### 具体的にどういう動きをするか（ユーザー目線で）

例:

&#x20; 1. キャラ登録画面で「画像からインポート」ボタンを押す

&#x20; 2. PCの画像ファイルを選ぶ

&#x20; 3. AIが自動的に「黒髪・長髪・軍服」などの特徴を読み取る

&#x20; 4. 読み取った内容をユーザーが確認・修正できる

&#x20; 5. 確定するとキャラとして登録される



\### 技術的に工夫した点（プログラマー向け）

例: 「画像のアップロードと解析を分離し、大きなファイルでもS3への直接アップロードで

&#x20;   サーバーの負荷を避けるようにしました」



\### 残課題・注意点

例: 「5MB以上の画像は現在エラーになります。次のタスクで対応予定です」

```



\---



\## 2. セキュリティ原則（全ての実装で必須）



\### 2-1. 認証・認可



```typescript

// ❌ 絶対にやってはいけない

app.get('/api/pages/:id', async (c) => {

&#x20; const page = await db.query('SELECT \* FROM pages WHERE id = $1', \[c.req.param('id')]);

&#x20; return c.json(page); // 誰でも取れてしまう

});



// ✅ 必ずこうする

app.get('/api/pages/:id', authMiddleware, async (c) => {

&#x20; const user = c.get('user');

&#x20; const page = await pageRepository.findByIdAndUserId(

&#x20;   c.req.param('id'),

&#x20;   user.id  // 必ずuser\_idで絞る

&#x20; );

&#x20; if (!page) return c.json({ error: 'Not Found' }, 404);

&#x20; return c.json(page);

});

```



\- 全てのAPIエンドポイントに `authMiddleware` を通す（公開エンドポイントは明示的に除外リストを作る）

\- DBクエリには必ず `user\_id` を条件に含める（他ユーザーのデータを返さない）

\- 認証と認可を混同しない（認証=誰か、認可=何をしてよいか）



\### 2-2. 入力バリデーション



```typescript

// ❌ やってはいけない

const { name, free\_description } = await c.req.json();

await db.query('INSERT INTO entities (name, ...) VALUES ($1, ...)', \[name]);



// ✅ 必ずzodでバリデーション

import { z } from 'zod';



const createEntitySchema = z.object({

&#x20; name: z.string().min(1).max(100),

&#x20; entity\_type: z.enum(\['character', 'nonhuman', 'object']),

&#x20; free\_description: z.string().max(2000).optional(),

&#x20; structured\_fields: z.record(z.unknown()).optional(),

});



const body = createEntitySchema.safeParse(await c.req.json());

if (!body.success) {

&#x20; return c.json({ error: { code: 'VALIDATION\_ERROR', message: body.error.message } }, 422);

}

```



\- 全てのリクエストボディをzodでバリデーションする

\- 文字列は必ず最大長を設定する

\- SQLはパラメータバインディングのみ使用（文字列結合禁止）



\### 2-3. シークレット管理



```typescript

// ❌ 絶対禁止

const openaiKey = 'replace-me-openai-key'; // コードにベタ書き



// ✅ 環境変数から取得（SSM Parameter Storeから注入される）

const openaiKey = process.env.OPENAI\_API\_KEY;

if (!openaiKey) throw new Error('OPENAI\_API\_KEY is not set');

```



\- APIキー・パスワード・JWT Secretは環境変数のみ

\- `.env` ファイルを `.gitignore` に含める（デフォルトで含めること）

\- コードレビュー時にシークレットのハードコードを必ずチェックする



\### 2-4. ファイルアップロード



```typescript

// 画像アップロード時の必須チェック

const ALLOWED\_MIME\_TYPES = \['image/jpeg', 'image/png', 'image/webp'];

const MAX\_FILE\_SIZE\_BYTES = 5 \* 1024 \* 1024; // 5MB



if (!ALLOWED\_MIME\_TYPES.includes(file.type)) {

&#x20; return c.json({ error: 'Invalid file type' }, 422);

}

if (file.size > MAX\_FILE\_SIZE\_BYTES) {

&#x20; return c.json({ error: 'File too large' }, 422);

}



// S3キーにユーザーIDを含める（パストラバーサル対策）

const s3Key = `tmp/${user.id}/entities/${entityId}/${crypto.randomUUID()}.png`;

// ユーザー入力をS3キーに直接使わない

```



\### 2-5. クレジット消費の競合対策



```typescript

// ❌ やってはいけない（TOCTOU問題）

const balance = await getBalance(userId);    // チェック

if (balance >= cost) {

&#x20; await deductBalance(userId, cost);         // 消費（この間に別のリクエストが入ると多重消費）

}



// ✅ DBトランザクション内でFOR UPDATEロック

await db.transaction(async (trx) => {

&#x20; const balance = await trx.query(

&#x20;   'SELECT monthly\_credits, purchased\_credits FROM credit\_balances WHERE user\_id = $1 FOR UPDATE',

&#x20;   \[userId]

&#x20; );

&#x20; if (totalCredits(balance) < cost) throw new InsufficientCreditsError();

&#x20; await trx.query('UPDATE credit\_balances SET ... WHERE user\_id = $1', \[userId]);

&#x20; await trx.query('INSERT INTO credit\_ledger ...', \[...]);

});

```



\---



\## 3. コード品質原則



\### 3-1. SOLID原則



\#### S: 単一責任原則（Single Responsibility）



```typescript

// ❌ 1つのクラスが多くのことをしている

class PageController {

&#x20; async generate(c: Context) {

&#x20;   // JWTを検証して

&#x20;   // クレジットをチェックして

&#x20;   // プロンプトを構築して

&#x20;   // SQSに送って

&#x20;   // DBに書いて

&#x20;   // レスポンスを返す

&#x20;   // → 全部ここに書かない

&#x20; }

}



// ✅ 責任を分割する

class PageController {

&#x20; constructor(

&#x20;   private pageGenerationService: PageGenerationService,

&#x20; ) {}



&#x20; async generate(c: Context) {

&#x20;   const user = c.get('user');

&#x20;   const pageId = c.req.param('id');

&#x20;   const jobId = await this.pageGenerationService.enqueue(user.id, pageId);

&#x20;   return c.json({ job\_id: jobId });

&#x20; }

}



class PageGenerationService {

&#x20; // クレジットチェック・消費

&#x20; // プロンプト構築の委譲

&#x20; // SQSエンキュー

}



class PromptBuilder {

&#x20; // プロンプト構築だけに集中

}

```



\#### O: 開放閉鎖原則（Open/Closed）



```typescript

// ✅ 新しいエンティティタイプを追加する時に既存コードを変えなくていい設計

interface PromptStrategy {

&#x20; buildPromptSupplement(fields: Record<string, unknown>): string;

}



class CharacterPromptStrategy implements PromptStrategy { ... }

class NonhumanPromptStrategy implements PromptStrategy { ... }

class ObjectPromptStrategy implements PromptStrategy { ... }



const strategies: Record<EntityType, PromptStrategy> = {

&#x20; character: new CharacterPromptStrategy(),

&#x20; nonhuman: new NonhumanPromptStrategy(),

&#x20; object: new ObjectPromptStrategy(),

};

```



\#### L: リスコフ置換原則（Liskov Substitution）



サブクラスは親クラスの契約を守る。インターフェースを実装する場合は全メソッドを正しく実装する。



\#### I: インターフェース分離原則（Interface Segregation）



```typescript

// ❌ 巨大なインターフェース

interface EntityRepository {

&#x20; findById(id: string): Promise<Entity>;

&#x20; create(data: CreateEntityDto): Promise<Entity>;

&#x20; update(id: string, data: UpdateEntityDto): Promise<Entity>;

&#x20; delete(id: string): Promise<void>;

&#x20; findByWorkId(workId: string): Promise<Entity\[]>;

&#x20; updateReferenceSet(id: string, refs: ReferenceImage\[]): Promise<void>;

&#x20; // ...20個のメソッド

}



// ✅ 目的別に分割

interface EntityReader {

&#x20; findById(id: string, userId: string): Promise<Entity | null>;

&#x20; findByWorkId(workId: string, userId: string): Promise<Entity\[]>;

}

interface EntityWriter {

&#x20; create(data: CreateEntityDto): Promise<Entity>;

&#x20; update(id: string, data: UpdateEntityDto): Promise<Entity>;

&#x20; delete(id: string, userId: string): Promise<void>;

}

interface ReferenceSetWriter {

&#x20; updateReferenceSet(entityId: string, refs: ReferenceImage\[]): Promise<void>;

}

```



\#### D: 依存性逆転原則（Dependency Inversion）



```typescript

// ✅ ServiceはRepositoryの具体実装に依存しない

class PageGenerationService {

&#x20; constructor(

&#x20;   private readonly pageRepo: EntityReader,         // インターフェース

&#x20;   private readonly creditService: CreditService,   // インターフェース

&#x20;   private readonly jobQueue: JobQueue,             // インターフェース

&#x20; ) {}

}



// テスト時はモックを注入できる

const service = new PageGenerationService(

&#x20; new MockPageRepository(),

&#x20; new MockCreditService(),

&#x20; new MockJobQueue(),

);

```



\### 3-2. ディレクトリ構造（レイヤードアーキテクチャ）



```

src/

├── routes/           # HTTPルーティング・リクエスト受付

│   ├── entities.ts

│   ├── pages.ts

│   ├── story.ts

│   └── billing.ts

│

├── services/         # ビジネスロジック

│   ├── entity/

│   │   ├── EntityService.ts

│   │   ├── PromptSupplementService.ts

│   │   └── ReferenceSetService.ts

│   ├── page/

│   │   ├── PageGenerationService.ts

│   │   ├── PromptBuilder.ts

│   │   └── ModeSelector.ts          # Standard/Thinking判定

│   ├── story/

│   │   ├── StoryCollaborationService.ts

│   │   └── PageSkeletonService.ts

│   └── credit/

│       └── CreditService.ts

│

├── repositories/     # DB操作（SQL）

│   ├── EntityRepository.ts

│   ├── PageRepository.ts

│   ├── CreditRepository.ts

│   └── JobRepository.ts

│

├── domain/           # 型定義・定数・ドメインロジック

│   ├── types/

│   │   ├── entity.ts

│   │   ├── page.ts

│   │   ├── panel.ts

│   │   └── job.ts

│   ├── errors/

│   │   ├── InsufficientCreditsError.ts

│   │   ├── NotFoundError.ts

│   │   └── ForbiddenError.ts

│   └── constants/

│       ├── credits.ts               # STANDARD\_COST, THINKING\_COST等

│       └── limits.ts                # MAX\_FILE\_SIZE等

│

├── infrastructure/   # 外部サービス連携

│   ├── openai/

│   │   ├── OpenAIClient.ts

│   │   └── ImageGenerationClient.ts

│   ├── anthropic/

│   │   └── ClaudeClient.ts

│   ├── aws/

│   │   ├── S3Client.ts

│   │   └── SQSClient.ts

│   └── upstash/

│       └── RedisClient.ts

│

├── middleware/

│   ├── auth.ts

│   ├── rateLimit.ts

│   └── errorHandler.ts

│

└── lib/

&#x20;   ├── db.ts                        # DB接続プール

&#x20;   └── validators/                  # zodスキーマ

&#x20;       ├── entity.schema.ts

&#x20;       └── page.schema.ts



worker/

├── index.ts                         # Lambdaハンドラー

├── handlers/

│   ├── pageGenerateHandler.ts

│   └── entityGenerateHandler.ts

└── services/

&#x20;   ├── gpt-image-2.ts

&#x20;   └── consistencyChecker.ts



tests/

├── unit/

│   ├── services/

│   └── repositories/

├── integration/

│   └── routes/

└── fixtures/

```



\### 3-3. 可読性のルール



```typescript

// ❌ 読めないコード

const r = await db.query(`SELECT \* FROM entities WHERE id = $1 AND user\_id = $2`, \[c.req.param('id'), c.get('user').id]);

if (!r.rows\[0]) return c.json({error:'Not Found'}, 404);



// ✅ 読めるコード

const entityId = c.req.param('id');

const userId = c.get('user').id;



const entity = await entityRepository.findByIdAndUserId(entityId, userId);



if (!entity) {

&#x20; return c.json({ error: { code: 'NOT\_FOUND', message: 'Entity not found' } }, 404);

}

```



```typescript

// ❌ マジックナンバー

if (entityCount > 4 || panelCount > 8) { ... }



// ✅ 定数に名前をつける

// src/domain/constants/generation.ts

export const THINKING\_MODE\_THRESHOLDS = {

&#x20; MAX\_ENTITIES\_FOR\_STANDARD: 4,

&#x20; MAX\_PANELS\_FOR\_STANDARD: 8,

} as const;



if (entityCount > THINKING\_MODE\_THRESHOLDS.MAX\_ENTITIES\_FOR\_STANDARD || ...) { ... }

```



```typescript

// ❌ 深いネスト

async function generatePage(pageId: string, userId: string) {

&#x20; const page = await getPage(pageId);

&#x20; if (page) {

&#x20;   const credits = await getCredits(userId);

&#x20;   if (credits >= cost) {

&#x20;     const job = await enqueueJob(page);

&#x20;     if (job) {

&#x20;       return job.id;

&#x20;     }

&#x20;   }

&#x20; }

}



// ✅ 早期リターンでフラットに

async function generatePage(pageId: string, userId: string): Promise<string> {

&#x20; const page = await pageRepository.findByIdAndUserId(pageId, userId);

&#x20; if (!page) throw new NotFoundError('Page not found');



&#x20; const cost = modeSelector.calculateCost(page);

&#x20; await creditService.deduct(userId, cost); // 不足時は例外を投げる



&#x20; const job = await jobQueue.enqueue({ type: 'page\_generate', pageId, userId });

&#x20; return job.id;

}

```



\### 3-4. TypeScript厳格設定



```json

// tsconfig.json

{

&#x20; "compilerOptions": {

&#x20;   "strict": true,

&#x20;   "noImplicitAny": true,

&#x20;   "noUnusedLocals": true,

&#x20;   "noUnusedParameters": true,

&#x20;   "noImplicitReturns": true

&#x20; }

}

```



\- `any` 型の使用禁止（止むを得ない場合は `unknown` + 型ガードを使う）

\- 全ての関数に戻り値の型を明示する

\- `null` と `undefined` を区別して扱う



\### 3-5. エラーハンドリング



```typescript

// src/domain/errors/index.ts

export class AppError extends Error {

&#x20; constructor(

&#x20;   public readonly code: string,

&#x20;   message: string,

&#x20;   public readonly statusCode: number,

&#x20; ) {

&#x20;   super(message);

&#x20;   this.name = this.constructor.name;

&#x20; }

}



export class NotFoundError extends AppError {

&#x20; constructor(message = 'Not found') {

&#x20;   super('NOT\_FOUND', message, 404);

&#x20; }

}



export class ForbiddenError extends AppError {

&#x20; constructor(message = 'Forbidden') {

&#x20;   super('FORBIDDEN', message, 403);

&#x20; }

}



export class InsufficientCreditsError extends AppError {

&#x20; constructor() {

&#x20;   super('INSUFFICIENT\_CREDITS', 'Credit balance is insufficient', 402);

&#x20; }

}



// src/middleware/errorHandler.ts

app.onError((err, c) => {

&#x20; if (err instanceof AppError) {

&#x20;   return c.json({ error: { code: err.code, message: err.message } }, err.statusCode as any);

&#x20; }

&#x20; // 予期しないエラーはログに残してユーザーには詳細を返さない

&#x20; console.error('Unexpected error:', err);

&#x20; return c.json({ error: { code: 'INTERNAL\_ERROR', message: 'An unexpected error occurred' } }, 500);

});

```



\---



\## 4. テスト原則



\### 4-1. テストの種類と配置



```

tests/unit/        → 外部依存なし。Serviceのビジネスロジックを中心にテスト

tests/integration/ → 実際のDBを使ったRepositoryのテスト（テスト用DBを使用）

```



\### 4-2. テストの書き方



```typescript

// tests/unit/services/page/ModeSelector.test.ts

import { ModeSelector } from '@/services/page/ModeSelector';



describe('ModeSelector', () => {

&#x20; const selector = new ModeSelector();



&#x20; describe('selectMode', () => {

&#x20;   it('エンティティ数4・コマ数8はstandardになる', () => {

&#x20;     const result = selector.selectMode({ entityCount: 4, panelCount: 8 });

&#x20;     expect(result).toBe('standard');

&#x20;   });



&#x20;   it('エンティティ数5はthinkingになる', () => {

&#x20;     const result = selector.selectMode({ entityCount: 5, panelCount: 4 });

&#x20;     expect(result).toBe('thinking');

&#x20;   });



&#x20;   it('コマ数9はthinkingになる', () => {

&#x20;     const result = selector.selectMode({ entityCount: 2, panelCount: 9 });

&#x20;     expect(result).toBe('thinking');

&#x20;   });

&#x20; });

});

```



\- テスト名は「〇〇の場合に〇〇になる」という形式で日本語で書く

\- 正常系・異常系・境界値を必ずカバーする

\- モックは最小限にとどめる（Infrastructure層のみモック）



\### 4-3. テスト実行



```bash

npm test              # 全テスト

npm test -- --watch  # ウォッチモード

npm run test:coverage # カバレッジ確認（目標: 80%以上）

```



\---



\## 5. DB・マイグレーション原則



```bash

\# マイグレーションファイルの命名

migrations/

&#x20; 001\_initial\_schema.sql

&#x20; 002\_add\_entity\_states.sql

&#x20; 003\_add\_page\_dialogue\_mode.sql

```



\- マイグレーションは必ず連番で管理する

\- 一度適用したマイグレーションは絶対に編集しない（新しいマイグレーションを追加する）

\- カラム削除・テーブル削除は段階的に行う（まず使用停止→次のリリースで削除）

\- インデックスを追加する際は `CONCURRENTLY` を使う（本番環境でのロック回避）



```sql

\-- ✅ 本番環境でもロックなしで追加できる

CREATE INDEX CONCURRENTLY idx\_entities\_work ON entities(work\_id);

```



\---



\## 6. 外部API呼び出し原則



```typescript

// ✅ タイムアウト・リトライを必ず設定する

class OpenAIImageClient {

&#x20; async generatePage(params: GeneratePageParams): Promise<GeneratedImage> {

&#x20;   const maxRetries = 3;



&#x20;   for (let attempt = 1; attempt <= maxRetries; attempt++) {

&#x20;     try {

&#x20;       const response = await this.client.images.generate({

&#x20;         ...params,

&#x20;         timeout: 300\_000, // 5分

&#x20;       });

&#x20;       return this.parseResponse(response);

&#x20;     } catch (err) {

&#x20;       if (attempt === maxRetries) throw err;

&#x20;       if (this.isRetryable(err)) {

&#x20;         await this.sleep(1000 \* attempt); // exponential backoff

&#x20;         continue;

&#x20;       }

&#x20;       throw err;

&#x20;     }

&#x20;   }

&#x20; }



&#x20; private isRetryable(err: unknown): boolean {

&#x20;   // 429（レート制限）と5xx（サーバーエラー）はリトライ

&#x20;   // 4xx（クライアントエラー）はリトライしない

&#x20;   if (err instanceof OpenAI.RateLimitError) return true;

&#x20;   if (err instanceof OpenAI.APIError \&\& err.status >= 500) return true;

&#x20;   return false;

&#x20; }

}

```



\- 外部APIへのリクエストには必ずタイムアウトを設定する

\- レート制限エラーはリトライ（exponential backoff）

\- クライアントエラー（4xx）はリトライしない

\- LambdaのタイムアウトはgRPC-image-2の最大待機時間（240秒）より大きく設定（300秒）



\---



\## 7. セルフチェックリスト（PR前に必ず確認）



```

コードの正確性

&#x20; □ Specの仕様と実装が一致しているか

&#x20; □ エッジケース（空文字、null、0、最大値）を処理しているか

&#x20; □ 全てのエラーパスにハンドリングがあるか



セキュリティ

&#x20; □ 全APIエンドポイントに認証ミドルウェアが通っているか

&#x20; □ DBクエリにuser\_idの条件が含まれているか

&#x20; □ 入力バリデーション（zodスキーマ）があるか

&#x20; □ シークレットのハードコードがないか

&#x20; □ ファイルアップロードのMIMEタイプ・サイズチェックがあるか

&#x20; □ クレジット消費にFOR UPDATEロックがあるか



コード品質

&#x20; □ 1つの関数・クラスが1つの責任だけを持っているか

&#x20; □ マジックナンバーが定数に置き換えられているか

&#x20; □ 深いネスト（3段以上）がないか

&#x20; □ anyを使っていないか

&#x20; □ 全ての関数に戻り値の型があるか



テスト

&#x20; □ テストを書いたか

&#x20; □ 正常系・異常系・境界値を網羅しているか

&#x20; □ npm test が全て通るか



Git

&#x20; □ コミットメッセージが規約に従っているか

&#x20; □ 1コミットが1つの論理的変更か

&#x20; □ .envや機密ファイルがコミットされていないか



説明（マージ後）

&#x20; □ 作業報告を所定のフォーマットで書いたか

&#x20; □ 素人でも理解できる言葉で説明したか

```



\---



\## 8. やってはいけないこと（禁止事項）



| # | 禁止事項 | 理由 |

|---|---|---|

| G-1 | 設計フェーズを飛ばして実装から始める | 後から直すコストが高い |

| G-2 | mainブランチに直接コミットする | レビューなしで本番に影響する |

| G-3 | APIキーをコードに書く | セキュリティインシデントの原因 |

| G-4 | `any`型を使う | 型安全性が失われる |

| G-5 | テストなしでPRを出す | 動作保証ができない |

| G-6 | 1つのコミットに複数の変更を混ぜる | 問題の切り分けができなくなる |

| G-7 | DBクエリのuser\_idチェックを省略する | 他ユーザーのデータを返す |

| G-8 | LLMの回答をそのままDBに保存する（バリデーションなし）| スキーマ不整合・注入攻撃 |

| G-9 | 一度適用したmigrationを編集する | 他環境との不整合が生じる |

| G-10 | クレジット消費をトランザクション外で行う | 二重消費・残高不整合の原因 |



\---



\## 9. 参照すべきドキュメント



| ドキュメント | 内容 |

|---|---|

| `docs/Lyra\_Unified\_Spec\_v4.md` | 設計の正本（迷ったらここに戻る）|

| `docs/Lyra\_StoryAI\_SubSpec.md` | StoryAI詳細仕様（LLMモデルはClaude Sonnetに読み替え）|

| `migrations/` | DBスキーマの変遷 |

| `tests/fixtures/` | テストデータのサンプル |



\---



\*AGENTS.md は設計・仕様が変わった場合に必ず更新する。\*

\*最終更新: 2026-04-22\*

