# Lyra セキュリティリスク評価書

最終更新: 2026-06-10
対象ブランチ: `claude/clever-hypatia-c0z8u8` (`893fe2b` 時点)
参照: `docs/cloud-production-roadmap.md`（クラウド本番化ロードマップ）

## この文書の目的

漫画自動制作アプリ「Lyra」のソースコードと運用設定を対象に、脅威を洗い出してまとめる。
各項目には「どのファイルのどこに脅威があるか」「どう直すべきか（既存実装とパイプラインを壊さない修正方針）」を記載する。
**実装は別エージェントが行う前提**なので、ここでは発見と修正方針の提示までを行う。

修正時の原則:

- 既存の API 契約（レスポンス形・ステータスコード）を変えない。
- 生成パイプライン（API → クレジット消費 → job 作成 → SQS → worker）の段階構造を壊さない。
- ローカル開発フロー（`LOCAL_FILE_STORAGE_DIR` 経由の inline worker）を壊さない。
- 後方互換のため、環境変数の追加はデフォルト値を安全側に倒し、未設定でも既存挙動を維持する。

## 重大度サマリ

| ID | 重大度 | 概要 | 主な対象ファイル |
|----|--------|------|------------------|
| H-1 | High | `import-image` がクレジット消費・課金監査なしで OpenAI Vision を呼べる（コスト暴走・乱用） | `src/services/entity/EntityReferenceService.ts`, `src/routes/entities.ts` |
| H-2 | High | dev auth bypass とレート制限無効化が `NODE_ENV === 'production'` 完全一致でしか防がれない（staging / 未設定で認証全バイパス） | `src/lib/runtimeGuards.ts`, `src/app.ts`, `src/middleware/auth.ts` |
| M-1 | Medium | 画像 URL が署名なしの素の CDN URL。ロードマップ必須の CloudFront signed URL/cookie が未実装 | `src/infrastructure/aws/S3PageImageStorage.ts` ほか S3*Storage |
| M-2 | Medium | S3 バケットポリシー例が `saved/*` しか許可せず、コードが書く `session/`・`tmp/` prefix と不整合。Block Public Access も例に明記なし | `ops/security/s3-images-bucket-policy.example.json` |
| M-3 | Medium | RDS/Postgres 接続に TLS 強制なし | `src/lib/db.ts` |
| M-4 | Medium | DB に `statement_timeout` / クエリタイムアウトがなく、低速クエリで資源枯渇しうる | `src/lib/db.ts` |
| M-5 | Medium | アップロード画像の magic-byte 検証なし。宣言 MIME を信頼して S3 保存（SVG/HTML 偽装の余地） | `src/services/entity/EntityReferenceService.ts` |
| M-6 | Medium | kill switch が単一 env `GENERATION_ENABLED` のみ。ロードマップが要求する粒度別 runtime kill switch が未実装 | `src/lib/env.ts`, `src/app.ts`, 各 generation service |
| L-1 | Low | WAF 例にレートベースルールがない | `ops/security/waf-web-acl.example.json` |
| L-2 | Low | `/local-assets/*` が無認証 + CORS `*`。同一ストレージ内の他ユーザー資産を横断取得可能（ローカル/staging 限定） | `src/routes/localAssets.ts` |
| L-3 | Low | `/compositions` が user スコープなしで prompt 等を返す（意図確認が必要） | `src/routes/compositions.ts`, `src/services/composition/CompositionGalleryService.ts` |
| L-4 | Low | Supabase セッションが localStorage 永続化（XSS 時のトークン奪取窓が広い） | `apps/web/src/lib/supabase.ts` |
| L-5 | Low | 本番でも 4xx の `AppError.message` をそのまま返す（軽微な内部情報露出） | `src/middleware/errorHandler.ts` |

---

## High

### H-1. `import-image` がクレジット消費なしで課金 API（OpenAI Vision）を呼べる

**場所**
- `src/routes/entities.ts:107-126`（`POST /api/entities/import-image`）
- `src/services/entity/EntityReferenceService.ts:88-116`（`importImage`）

**内容**

`importImage` は以下を行うが、**クレジットを一切消費しない**:

1. base64 画像を S3 (`tmp/{userId}/...`) に保存（`storeImportedImage`）。
2. OpenAI Vision でエンティティ画像を解析（`this.imageAnalyzer.analyze`、`EntityReferenceService.ts:105`）。

このエンドポイントは認証済みだが、レート制限は `default` バケット（`src/domain/constants/rateLimit.ts`：100 req/min/user）にしか属さない。
`generate-reference` 側（`EntityReferenceService.ts:145` で `consumeCredits`）はクレジットを消費するのに対し、`import-image` は OpenAI 課金 API を毎リクエスト無償で叩ける。

ロードマップは「すべてのクレジット移動を ledger に残す」「生成消費」「OpenAI 日次/月次上限」「不正利用対策」を必須としている（roadmap: 課金方針／コスト最適化／Kill Switch）。現状の `import-image` はこの監査・コスト制御の外にある。

**影響**

- 認証済みユーザーが 100 req/min で OpenAI Vision コストを無償発生させられる（コスト暴走・サービス乱用）。
- どの import がどれだけ OpenAI コストを使ったか ledger に残らず、課金監査が成立しない。

**修正方針（パイプライン非破壊）**

- `import-image` 専用の軽量クレジットコスト（例: `CREDIT_COSTS.ENTITY_IMPORT_ANALYSIS`）を `src/domain/constants/credits.ts` に追加し、`importImage` の OpenAI 呼び出し**前**に `creditService.consumeCredits` を実行、失敗系では既存 `generate-reference` と同じく `refundCredits` する。レスポンス形は不変。
- 併せて `import-image` を `generation` レートバケットに含める（`src/domain/constants/rateLimit.ts` のパターンに `import-image` を追加）。
- コストを掛けたくない場合の代替として、最低限「per-user の import 回数 backpressure」を `assertGenerationCapacity` 相当で課す。
- 既存のローカル/テスト（`enableDevAuthBypass` 時はレート制限 no-op）の挙動は維持されるため、ローカル開発は壊れない。

---

### H-2. dev auth bypass / レート制限無効化が「production 完全一致」でしか止まらない

**場所**
- `src/lib/runtimeGuards.ts:50-54`（`nodeEnv !== 'production'` なら即 return）
- `src/app.ts:199-213`（`enableDevAuthBypass` が true のとき rate limit middleware を no-op に置換）
- `src/middleware/auth.ts:55-64`（dev bypass 時は Authorization 検証を完全スキップ）

**内容**

`assertProductionRuntimeConfig` は `NODE_ENV` が文字列 `'production'` に完全一致するときだけガードを発火する。
したがって `NODE_ENV` が未設定、`staging`、`prod`（タイポ）等の場合:

- `DEV_AUTH_BYPASS=true` でも production ガードに弾かれず、`auth.ts` が **すべてのリクエストを `dev-local-user` として認証バイパス**する。
- さらに `app.ts:209` の分岐により、bypass 時はレート制限ミドルウェアが no-op になる（認証なし＋レート制限なし）。

staging もインターネット到達可能な前提（roadmap: Phase 2 AWS staging）なので、`NODE_ENV` 設定ミス 1 つで全アカウントなりすまし＋無制限アクセスになる。
ロードマップの Launch Gate「production が dev auth bypass を拒否する」は満たすが、production “以外”の到達可能環境が無防備。

**影響**

- 設定事故（`NODE_ENV` 未設定/誤設定）で認証全バイパス＝任意ユーザーのデータ・生成・課金操作が可能。
- 同時にレート制限も外れ、コスト暴走と DoS の入口になる。

**修正方針（パイプライン非破壊）**

- `runtimeGuards` を「`NODE_ENV !== 'development'`（および `!== 'test'`）なら本番相当ガードを適用」へ反転する、もしくは明示的な許可リスト（`development`/`test` のみ bypass 許容）に変更する。これにより staging/未設定は安全側に倒れる。
- `DEV_AUTH_BYPASS=true` を「`NODE_ENV` が `development`/`test` のときのみ有効」とし、それ以外では env 解釈段階で false に強制する（`src/lib/env.ts` か `app.ts:199` の `enableDevAuthBypass` 決定箇所）。既存のローカル開発（`NODE_ENV` 未設定でローカル起動）が壊れないよう、ローカルの想定値を `development` に固定する手順を README/runbook に追記する。
- レート制限 no-op 化（`app.ts:209-213`）は dev bypass と同条件に縛られているため、上記で自動的に締まる。テストは `app.ts:200` で `NODE_ENV==='test'` を bypass=false にしているので影響なし。

---

## Medium

### M-1. 画像 URL が署名なしの素の CDN URL（signed URL/cookie 未実装）

**場所**
- `src/infrastructure/aws/S3PageImageStorage.ts`（`buildCdnUrl` で `${cdnBaseUrl}/${key}` を生成、49/59 付近）
- `src/infrastructure/aws/S3EntityImageStorage.ts`（94/122/129 付近）
- `src/infrastructure/aws/S3FinalPageImageStorage.ts`（61/101 付近）

**内容**

返却される `cdn_url` は署名なしの恒久 URL。API 側のオーナーシップ確認（例: `PageExportService.exportGeneratedImage`、`src/services/page/PageExportService.ts:20-31`）は健全だが、`cdn_url` 自体は一度漏れれば誰でも無期限に取得できる。
ロードマップは「CloudFront signed URL/cookie が短 TTL かつ狭い scope」を Launch Gate 必須としており、現状は未達。

**影響**

- 生成中・未確定の `session/`/`tmp/` 画像を含む URL がログ・リファラ・共有経由で漏れると、第三者が無期限取得可能。ユーザー資産保護方針に反する。

**修正方針（パイプライン非破壊）**

- `S3*Storage` の `cdnUrl` 生成箇所に、CloudFront signed URL/cookie を発行するアダプタ層を追加（鍵は Secrets Manager）。worker は引き続き `s3Key` を DB に保存し、**URL 署名は API のレスポンス組み立て時に行う**ことで、保存データ形と worker フローを変えない。
- 移行期は「`IMAGES_CDN_SIGNING_ENABLED` のような feature flag を追加し、未設定時は現行の素 URL（ローカル/staging 互換）」とすれば既存環境を壊さず段階導入できる。

### M-2. S3 バケットポリシー例が実際の prefix と不整合 / Block Public Access 未明記

**場所**
- `ops/security/s3-images-bucket-policy.example.json:5-17`（CloudFront 読み取り許可が `arn:aws:s3:::lyra-images/saved/*` のみ）
- コード側の実際の prefix: `session/{userId}/...`、`tmp/{userId}/...`（`S3PageImageStorage.ts`/`S3EntityImageStorage.ts`）

**内容**

ポリシー例は `saved/*` だけを CloudFront に許可しているが、コードは `session/`・`tmp/` などにも書き込み、それらの `cdn_url` を返す。
ポリシーをそのまま適用すると、(a) 一部画像が CloudFront から取得できず機能不全になるか、(b) 運用者が手早く直そうとして prefix をワイルドカード化し過剰公開する誘発要因になる。
また例には `s3:GetObject` の許可と TLS 強制（`DenyUnEncryptedTransport`）はあるが、**Block Public Access（アカウント/バケットの公開遮断）設定**が例として含まれていない。ロードマップは「S3 Block Public Access」「public access は block」を必須としている。

**影響**

- 設定不整合による機能不全、または運用者の過剰公開修正によるバケット公開リスク。

**修正方針**

- ポリシー例を、実際に配信する prefix（`saved/`、必要に応じ `session/` 等の限定）に合わせて明示列挙する。`tmp/` のような一時資産は配信対象から外す方針を runbook に明記。
- バケットに Block Public Access 4 項目（IaC 側で `aws_s3_bucket_public_access_block` 等）を必須化する旨を `ops/security` の README か runbook に追記。
- M-1 の signed URL と合わせ、OAC（origin access control）経由のみ許可する形に揃える。

### M-3. DB 接続に TLS 強制がない

**場所**
- `src/lib/db.ts:15-18`（`new Pool({ connectionString, max: 10 })`、`ssl` 指定なし）

**内容**

接続文字列任せで `ssl` オプションがない。`DATABASE_URL` に `sslmode` が含まれなければ平文接続になりうる。ロードマップは「RDS encryption」「TLS」を必須としている。

**修正方針**

- 本番相当（`NODE_ENV` が `development`/`test` 以外）では `ssl: { rejectUnauthorized: true }`（RDS の CA を使用）を設定。ローカル Docker Postgres（TLS なし）は `ssl: false` のままにできるよう環境で分岐する。デフォルトをローカル互換に倒せば既存開発は壊れない。

### M-4. クエリ/ステートメントタイムアウトがない

**場所**
- `src/lib/db.ts:15-18`

**内容**

`statement_timeout` / `query_timeout` 未設定。重い・暴走クエリがコネクションプール（`max: 10`）を占有し、API 全体の応答不能（資源枯渇 DoS）につながる。

**修正方針**

- Pool に `statement_timeout`（例: 30s）と `query_timeout` を設定、またはコネクション確立時に `SET statement_timeout`。生成系の長時間処理は worker 側（同期実行しない設計）なので、API DB クエリへの妥当なタイムアウトはパイプラインに影響しない。

### M-5. アップロード画像の magic-byte 検証がない

**場所**
- `src/services/entity/EntityReferenceService.ts`（`parseImageDataUrl`、319-335 付近、`importImage` 95-104）

**内容**

`parseImageDataUrl` は data URL の宣言 MIME（`image/png|jpeg|webp`）を正規表現で検査し、サイズ上限（`ENTITY_IMPORT_MAX_FILE_SIZE_BYTES` = 5MB）も確認している（ここは良い）。
ただしデコード後バイト列の **実体（magic byte）検証がない**ため、宣言 `image/png` で中身が SVG/HTML というファイルを S3 に `ContentType: image/png` で保存できる。
M-1 の素 CDN URL かつ CloudFront が `X-Content-Type-Options: nosniff` を付けない構成だと、ブラウザの content sniffing 次第で stored XSS に発展する余地がある（現状は低〜中、防御は多層で固めるべき）。

**修正方針**

- `parseImageDataUrl` のデコード直後に magic-byte 検証（PNG/JPEG/WebP のシグネチャ確認、`file-type` 等）を追加し、不一致は `ValidationError`。検証は純粋関数追加で、保存・解析フローの順序を変えないため非破壊。
- 併せて配信時に `X-Content-Type-Options: nosniff` を CloudFront/レスポンスに付与（API edge では `securityHeaders.ts` が既に付与済み。CDN 配信パスにも適用する旨を runbook に明記）。

### M-6. runtime kill switch がロードマップ要件より粗い

**場所**
- `src/lib/env.ts:35-38`（`GENERATION_ENABLED` のみ、起動時評価）
- `src/app.ts:405,427` ほか（DI 時に `env.GENERATION_ENABLED` を各 service へ注入）

**内容**

生成停止スイッチは単一 env `GENERATION_ENABLED` で、プロセス起動時に固定される。ロードマップは
`generation_enabled` / `high_quality_generation_enabled` / `free_user_generation_enabled` / `worker_max_concurrency` / `page_generation_enabled` / `entity_generation_enabled` を
**DB または SSM Parameter Store の runtime config** として持ち、API と worker の双方が生成前に参照することを必須としている（コスト暴走・不正・retry ループの緊急停止用）。
現状は env のため、緊急停止に再デプロイ/再起動が必要で、粒度も足りない。

**影響**

- OpenAI/AWS コスト暴走時に即時停止できない。free ユーザーや高品質生成だけを絞る、といった部分停止ができない。

**修正方針（パイプライン非破壊）**

- runtime config provider（SSM Parameter Store か専用テーブル）を追加し、`PageGenerationService`/`EntityReferenceService`/worker が生成直前に参照する形へ。
- 既存の `GENERATION_ENABLED` env はデフォルト/フォールバックとして残し、runtime config 未導入環境では現行どおり動くようにすれば後方互換。
- worker 側（`worker/index.ts`、`PageGenerationWorkerService`/`EntityGenerationWorkerService`）でも claim 前に kill switch を確認する。

---

## Low

### L-1. WAF 例にレートベースルールがない

**場所**: `ops/security/waf-web-acl.example.json`

AWS managed（Common / KnownBadInputs / IpReputation）は入っているが、`RateBasedStatement` がない。ロードマップ Phase 5 は「WAF rate-based rule」を挙げている。
**修正方針**: edge レベルの粗いレート制限として rate-based rule（IP 単位 5 分窓など）を例に追加。アプリ層の per-user 制限（`rateLimit.ts`）とは別レイヤーとして併用。

### L-2. `/local-assets/*` が無認証 + CORS `*`

**場所**: `src/routes/localAssets.ts:8-25`

パストラバーサルは `resolveLocalAssetPath`（`src/infrastructure/local/LocalAssetFiles.ts:55-72`）で適切に防御済み。ただしオーナーシップ確認がなく、`Access-Control-Allow-Origin: *` で、同一 `LOCAL_FILE_STORAGE_DIR` 内なら他ユーザーの資産 key を知っていれば取得できる。
production では `runtimeGuards` がローカルストレージを禁止する（`runtimeGuards.ts:86-88`）ため本番影響は限定的。staging で local storage を使う場合に問題化する。
**修正方針**: ローカル/開発専用であることを runbook に明記し、staging 以上では `LOCAL_FILE_STORAGE_DIR` を使わず S3+CloudFront 配信に統一する（H-2 の環境ガード強化と整合）。CORS `*` も配信用途に必要な範囲へ絞れるとなお良い。

### L-3. `/compositions` が user スコープなしで prompt を返す

**場所**: `src/routes/compositions.ts:20-35`、`src/services/composition/CompositionGalleryService.ts:16-18`

ギャラリーは共有/システム提供のテンプレートと推測され、`findMany(query)` に userId を渡していない。意図的な共有リソースなら問題ないが、`composition_prompt` や `preview_cdn_url` を全認証ユーザーに開示しているため、**ユーザー固有データが混在しない設計か要確認**。
**修正方針**: 仕様確認の上、ユーザー由来データを含むなら user スコープ（または public フラグ）でフィルタ。共有テンプレート専用テーブルなら現状維持で可。文書として「共有ギャラリーである」ことを明記。

### L-4. Supabase セッションが localStorage に永続化

**場所**: `apps/web/src/lib/supabase.ts:16-22`（`persistSession: true`）

Supabase 標準挙動だが、XSS 発生時にトークンが奪われる窓が広い。手動トークンは `sessionStorage` を使っており相対的に良い。
**修正方針**: 本番第一候補が Cognito（roadmap: ログイン方針）なので、Cognito 移行時に token 保管方針（メモリ保持＋短命 access token + refresh の扱い）を設計。Supabase 継続なら CSP の整備で XSS 自体を抑止することを優先。

### L-5. 本番で 4xx の内部メッセージをそのまま返す

**場所**: `src/middleware/errorHandler.ts:22-25`

5xx は production で汎用文言に隠蔽されており良い（roadmap: 5xx で内部詳細を返さない、を満たす）。一方 4xx（`AppError` の `statusCode < 500`）は `error.message` をそのまま返す。多くは安全だが、`ValidationError` 等に内部識別子や SQL 由来の語が混ざると軽微な情報露出になりうる。
**修正方針**: 4xx メッセージはユーザー向け定型文に正規化するか、`message` を検証済みの安全な文言に限定する運用ルールを設ける。優先度は低い。

---

## 確認できた良好な実装（誤検知防止のための記録）

修正エージェントが「壊してはいけない」既存の防御。以下はリスクではなく、現状維持すべき良い実装。

- **IDOR / オーナーシップ**: 全 60+ エンドポイントで `findByIdAndUserId` 系、または `works.user_id` への INNER JOIN チェーン（`balloons → pages → episodes → chapters → works`）でオーナー確認済み。ネスト資源のチェーンに切れ目なし。`export-image` も `PageExportService` で所有確認後に S3 ロード。
- **SQL インジェクション**: 全リポジトリでパラメータ化クエリ（`$1` プレースホルダ）。テンプレートリテラルは列定数のみで、ユーザー入力の補間なし。
- **クレジット競合**: `CreditRepository` が `SELECT ... FOR UPDATE` + トランザクションで残高更新。二重消費・マイナス残高を DB CHECK 制約と合わせて防止。
- **Stripe 冪等性**: `processed_stripe_events` の PRIMARY KEY + `markStripeEventProcessed` の早期 return で webhook 重複配送に対し二重付与しない。クレジット付与は webhook のみ（成功画面を信用していない）。
- **job 冪等 / claim**: `claimQueuedPageGenerationJob` が `status='queued'` ガード付きの原子的 `UPDATE` で queued→processing を claim。active job lock の unique index（`migrations/003`）で二重生成を抑止。失敗時はクレジット返金（`PageGenerationWorkerService`/`EntityGenerationWorkerService`）。
- **SSRF**: 画像は data URL のみを受け付け（`parseImageDataUrl` の厳格な正規表現）、ユーザー指定 HTTP URL を fetch する経路なし。
- **コマンドインジェクション**: `DetachedWorkerProcessLauncher` は `spawn` を配列引数で実行（shell なし）。`jobId` は argv 要素として渡す。
- **秘匿情報の redaction**: `errorSanitizer.ts` が Bearer/API key/AWS 署名/base64 画像を永続化前にマスク。5xx は production で汎用化。リポジトリ層に console ログなし。
- **SQS メッセージ検証**: worker は zod（`job_id` UUID、`job_type`）で検証し、未知 type は skip、不正は failed。poison メッセージでクラッシュしない。
- **入力検証**: 各ルートで zod スキーマ + UUID パラメータ検証。アップロードは MIME ホワイトリスト + 5MB 上限。
- **セキュリティヘッダ**: `securityHeaders.ts` が nosniff / X-Frame-Options DENY / Referrer-Policy / Permissions-Policy / COOP / CORP を付与、production で HSTS。
- **Cognito 検証**: 署名(RS256)・issuer・audience(id token)・client_id(access token)・token_use・scope・group を検証（`auth.ts`）。ロードマップ Launch Gate と整合。
- **シークレット**: `.gitignore` が `.env`/`.env.*` を除外（`.env.example` のみ追跡）。コミット履歴に実鍵なし。`.env.example` は全て `replace-me` プレースホルダ。

---

## 優先対応順の提案

1. **H-2**（環境ガード）: 設定事故で全認証バイパスは最優先。コード変更も局所的。
2. **H-1**（import-image 課金）: コスト暴走の直接的入口。クレジット消費＋レートバケット変更で塞ぐ。
3. **M-6 / M-1 / M-2**: 課金 beta 前に必要な runtime kill switch・signed URL・S3 ポリシー整合（ロードマップ Launch Gate 直結）。
4. **M-3 / M-4 / M-5**: DB TLS・タイムアウト・magic-byte。いずれも局所修正で多層防御を底上げ。
5. **L-1〜L-5**: 公開前の仕上げ・運用文書化。