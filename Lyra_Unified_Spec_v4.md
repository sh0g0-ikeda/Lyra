# Lyra 統合仕様書 v4.0
### Production Blueprint — 完成品実装用設計書

---

## 本仕様書の位置づけ

AI漫画制作WebアプリケーションLyraの統合仕様書。本書のみで設計・実装が完結する。

**設計の核心**

> キャラクターを登録し、コマごとに「誰が何をしているか」を書くだけでページが生成される。
> プロンプトを書く必要はない。AIとの協働で物語を作り、それを漫画ページとして出力する。

**v4.0における主要変更（v3.0比）**

| 変更 | v3.0 | v4.0 |
|---|---|---|
| 画像生成 | gpt-image-1（コマ単位） | **gpt-image-2（ページ単位一括）** |
| Thinkingモード | 常時オン | **複雑度で自動切替**（Standard/Thinking）|
| キャラ一貫性の主軸 | reference画像 + 構造化prompt同等 | **reference画像が主軸**。構造化promptは補助 |
| キャラ登録方法 | GUI入力のみ | **GUI + 自由記述 + 画像インポート** |
| 登録エンティティ | 人物キャラ・アイテム | **人物・人外・物体（統合）** |
| ストーリー | LLM生成→人間承認 | **人間とAIが双方向協働。話が固まったらPage/Panel骨格を自動生成** |
| インフラ | ECS Fargate | **EC2（API）+ Lambda（Worker）+ RDS + SQS**（AWS無料枠最大活用）|
| プロンプトコンパイラー | 中核コンポーネント | **補助的役割に格下げ。GUIとreferenceが主役** |

---

## 目次

- Part I: システム概要・設計思想
- Part II: AWSインフラ設計
- Part III: 認証（Supabase Auth）
- Part IV: キャラクター・エンティティシステム
- Part V: ストーリーシステム（人間×AI協働）
- Part VI: ページ・コマ設計システム
- Part VII: 画像生成パイプライン（gpt-image-2 + GPT-5.4 mini planner）
- Part VIII: ページエディタ（Balloonレイヤー）
- Part IX: 課金システム
- Part X: API設計
- Part XI: DBスキーマ
- Part XII: スケーリング設計
- 付録A: 禁止事項
- 付録B: 実装フェーズ計画
- 付録C: 設計核心まとめ

---

# Part I: システム概要・設計思想

---

## 1. Lyraとは

非プロのユーザーがAI支援でオリジナル漫画を制作できるPCブラウザ向けWebアプリケーション。

**ユーザーがすること**
1. キャラクターを登録する（GUI入力・自由記述・画像インポートのいずれか）
2. AIと協働しながら物語の骨格を作る
3. ページのコマ割りを決め、各コマに「誰が何をしているか」を書く
4. ボタンを押すとページが生成される
5. 必要ならセリフ・吹き出しを追加する

**ユーザーがしないこと**
- プロンプトを書く
- モデルを選ぶ
- エンジンを意識する

## 2. 設計原則

| 原則 | 内容 |
|---|---|
| GUI完結 | キャラ選択と状況テキストだけで漫画が作れる |
| reference画像が主役 | 顔・外見の一貫性はreference画像で担保。テキストは補助 |
| ページ単位生成 | コマを1枚ずつではなく、1ページを丸ごと生成 |
| 人間×AI協働 | ストーリーはAIが提案、人間が編集。どちらも書ける |
| 正本は構造化データ | チャット・生成結果は補助。DBの構造化データが唯一の正本 |
| 非同期分離 | 画像生成はSQS+Lambda経由。APIレスポンスをブロックしない |
| AWS無料枠優先 | 初期はFree Tier構成で動く。成長に応じてスケールアウト |

## 3. LLM役割分担

| モデル | 担当 |
|---|---|
| **Claude Sonnet（最新）** | ストーリー生成・提案・編集・チャット・Review Engine |
| **GPT-4o** | キャラspec抽出（Vision）・prompt_supplement生成・Consistency確認 |
| **GPT-5.4 mini** | Thinkingモード時のページ構図整理・生成前プランニング |
| **GPT-4.1-mini** | 軽量スキーマ検証・分類タスク |
| **gpt-image-2** | 全画像生成（キャラ・ページ・物体）|

## 4. UIデザイン方針

ゴールド × ブラック基調。ダークモード主体。

| 用途 | HEX |
|---|---|
| プライマリゴールド | `#C8A951` |
| ブライトゴールド（ホバー） | `#E5C76B` |
| ダークゴールド（プレス） | `#A68B3C` |
| ピュアブラック（背景） | `#0A0A0A` |
| ダークグレー（カード） | `#1A1A1A` |
| ボーダーグレー | `#3A3A3A` |
| サブテキスト | `#8A8A8A` |
| メインテキスト | `#E0E0E0` |
| 成功 | `#4CAF50` |
| 警告 | `#FFC107` |
| エラー | `#F44336` |
| 編集中 | `#00BCD4` |

---

# Part II: AWSインフラ設計

---

## 5. 全体アーキテクチャ

```
[ユーザー（PCブラウザ）]
        │ HTTPS
        ▼
[Route 53]
        │
        ├──────────────────────────────────┐
        ▼                                  ▼
[CloudFront #1]                    [CloudFront #2]
 SPA配信                             生成画像CDN
        │                                  │
        ▼                                  ▼
[S3: lyra-frontend]               [S3: lyra-images]
 Reactビルド成果物                   生成画像ストレージ

[CloudFront #1]
  └─ /api/* → [ALB]
                  │
                  ▼
         [EC2: lyra-api]
           ├─ インスタンス: t2.micro（Free Tier）→ t3.small（成長後）
           ├─ アプリ: Node.js + TypeScript + Hono
           ├─ PM2でプロセス管理（クラッシュ自動再起動）
           │
           ├─── [RDS: PostgreSQL db.t3.micro]（Free Tier）
           │      └─ pg-pool（接続プール、max:10）
           │
           ├─── [Upstash Redis]（外部SaaS、Free Tier）
           │      ├─ ジョブ状態キャッシュ
           │      ├─ レート制限カウンター
           │      └─ WebSocket pub/sub
           │
           └─── [SQS: lyra-generation-queue]（Free Tier範囲）
                    │
                    ▼
         [Lambda: lyra-worker]（Free Tier: 100万req/月）
           ├─ ランタイム: Node.js 22.x
           ├─ タイムアウト: 300秒（5分）
           ├─ メモリ: 1024MB
           ├─ 同時実行数: 50（初期）→ 200（成長後）
           │
           ├─── gpt-image-2 API（ページ画像生成）
           ├─── GPT-4o API（Consistency確認・Vision）
           ├─── S3: lyra-images（生成画像アップロード）
           └─── RDS PostgreSQL（ジョブ結果書き込み）

[EC2: lyra-api]
  └─── Claude Sonnet API（ストーリー生成・チャット）
  └─── GPT-4o API（prompt変換・Vision）
  └─── GPT-4.1-mini API（軽量タスク）
```

## 6. AWSサービス選定とFree Tier対応

| サービス | Free Tier | 超過後 |
|---|---|---|
| EC2 t2.micro | 750h/月（12ヶ月）| t3.small: ~$17/月 |
| RDS db.t3.micro | 750h/月 + 20GB SSD（12ヶ月）| ~$25/月 |
| S3 | 5GB + 2万PUT + 20万GET（12ヶ月）| $0.023/GB |
| CloudFront | 1TB/月 + 1000万req（12ヶ月）| $0.009/GB |
| SQS | 100万msg/月（永続） | $0.40/100万msg |
| Lambda | 100万req/月 + 40万GB-sec（永続）| $0.20/100万req |
| Upstash Redis | 1万req/日（永続・外部）| $0.2/10万req |

**Free Tierでの推定月間処理量**
- Lambda 100万req = 画像生成ジョブ100万回（十分）
- SQS 100万msg = エンキュー + デキュー各50万回（十分）
- S3 5GB = 生成画像約200枚分（β版では十分）

## 7. ネットワーク構成

```
VPC: 10.0.0.0/16

Public Subnets（2AZ）:
  10.0.0.0/24 (ap-northeast-1a)  ← ALB, EC2（Elastic IP付与）
  10.0.1.0/24 (ap-northeast-1c)  ← ALB（マルチAZ用）

Private Subnets（2AZ）:
  10.0.10.0/24 (ap-northeast-1a) ← RDS Primary
  10.0.11.0/24 (ap-northeast-1c) ← RDS Standby（将来MultiAZ化）

Lambda:
  VPC内配置（RDSに直接接続するため）
  ENI経由でPrivate Subnetを使用

Security Groups:
  sg-alb:    inbound 443 from 0.0.0.0/0
  sg-ec2:    inbound 3000 from sg-alb, inbound 22 from 管理IP
  sg-rds:    inbound 5432 from sg-ec2, sg-lambda
  sg-lambda: outbound all（外部API呼び出し用）
```

## 8. シークレット管理

AWS Systems Manager Parameter Store（無料）を使用。Secrets Managerは有料のため使わない。

```
/lyra/prod/openai-api-key
/lyra/prod/anthropic-api-key
/lyra/prod/stripe-secret-key
/lyra/prod/stripe-webhook-secret
/lyra/prod/supabase-jwt-secret
/lyra/prod/database-url
/lyra/prod/upstash-redis-url
/lyra/prod/s3-bucket-images
/lyra/prod/cloudfront-image-domain
```

EC2起動時のUserDataスクリプト・Lambda環境変数で Parameter Store から値を取得して注入する。

## 9. WebSocket（ジョブ完了通知）

```
フロー:
1. クライアントがジョブエンキュー → { job_id } を受け取る
2. WebSocket接続（/ws）を確立
3. job_id を subscribe メッセージで送信
4. Lambda がジョブ完了 → Upstash Redis PUBLISH "job:{job_id}" {result}
5. EC2 API が SUBSCRIBE → 受信 → 該当WebSocket clientに転送
6. クライアントがページ画像URLを受け取り → UI更新

フォールバック:
- WebSocket切断時: GET /api/jobs/{job_id} でポーリング（5秒間隔）
- 接続タイムアウト: 60秒（pingで維持）
```

## 10. CI/CDパイプライン

```
GitHub → GitHub Actions
  1. 単体テスト実行
  2. Dockerビルド（またはzipパッケージ）
  3. EC2へSSH + PM2 reload（APIサービス）
  4. Lambda zip更新（aws lambda update-function-code）
  5. フロントエンドビルド → S3同期 → CloudFront invalidation

ブランチ戦略:
  develop → staging EC2（t2.micro）
  main    → production EC2（手動トリガー）
```

---

# Part III: 認証（Supabase Auth）

---

## 11. 認証フロー

```
[クライアント]
  1. Supabase Auth JS SDKでサインアップ/ログイン
  2. Supabaseが JWT（HS256）を発行
  3. 全APIリクエストに Authorization: Bearer {token} を付与

[EC2 lyra-api: 認証ミドルウェア]
  4. JWTをSUPABASE_JWT_SECRETで検証
  5. sub（user_id）を抽出
  6. RDS の users テーブルを参照
     - 存在しない → 新規作成（初回自動プロビジョニング + Free クレジット付与）
     - 存在する → userレコード取得
  7. request.context.user に注入
```

## 12. 認証ミドルウェア（実装）

```typescript
// src/middleware/auth.ts
import { jwt } from 'hono/jwt';

export const authMiddleware = async (c: Context, next: Next) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return c.json({ error: 'Unauthorized' }, 401);

  try {
    const payload = jwt.verify(token, process.env.SUPABASE_JWT_SECRET!, {
      algorithms: ['HS256'],
    }) as SupabaseJWT;

    const user = await db.query(`
      INSERT INTO users (id, supabase_id, email, plan_code)
      VALUES (gen_random_uuid(), $1, $2, 'free')
      ON CONFLICT (supabase_id) DO UPDATE SET updated_at = NOW()
      RETURNING *
    `, [payload.sub, payload.email]);

    if (user.rows[0].is_new_user) {
      await grantCredits(user.rows[0].id, 200, 'signup_bonus'); // $5相当
    }

    c.set('user', user.rows[0]);
    await next();
  } catch {
    return c.json({ error: 'Unauthorized' }, 401);
  }
};
```

---

# Part IV: キャラクター・エンティティシステム

---

## 13. エンティティ種別

Lyraで登録・管理できるエンティティは3種別。全て同一の管理画面で扱う。

| 種別 | entity_type | 主な入力方法 | 用途 |
|---|---|---|---|
| 人物キャラ | `character` | GUI + 自由記述 + 画像インポート | 主要登場人物・脇役 |
| 人外キャラ | `nonhuman` | 自然言語 + 画像インポート | 怪物・精霊・ロボット等 |
| 物体・アイテム | `object` | 自然言語 + 画像インポート | 武器・道具・乗り物等 |

全種別で「reference画像（全身推奨）+ 説明テキスト」が基本構造。

## 14. エンティティデータ構造

### 14-1. entity_spec（共通基盤）

```json
{
  "entity_id": "ent_001",
  "work_id": "work_001",
  "user_id": "user_001",
  "entity_type": "character | nonhuman | object",
  "name": "月華（げっか）",
  "free_description": "黒髪ロングの女性将校。青みがかった瞳。軍服は紺色で金の装飾がある。冷静で口数が少ない。",
  "structured_fields": { ... },   // entity_typeに応じて異なる（後述）
  "prompt_supplement": "GPT-4oが生成した画像生成用補足prompt（不変部分）",
  "speech_profile": { ... },      // character / nonhumanのみ
  "status": "draft | ready",      // reference画像が1枚以上あれば ready
  "created_at": "ISO 8601",
  "updated_at": "ISO 8601"
}
```

### 14-2. structured_fields（entity_typeごとの詳細）

#### character（人物）

GUIで選択できる項目。**全項目任意**。書かなくてもfree_descriptionで補完される。

```json
{
  "gender_expression": "female | male | androgynous | unspecified",
  "age_range": "child | early_teens | late_teens | twenties | thirties | forties_plus | ageless",
  "height": "short | average | tall",
  "build": "petite | slender | average | athletic | muscular | curvy",
  "hair": {
    "color": "black | brown | blonde | silver | white | blue | red | pink | purple | custom",
    "length": "very_short | short | medium | long | very_long",
    "style": "straight | wavy | curly | wild",
    "arrangement": "down | ponytail | twin_tails | bun | braid | half_up | custom"
  },
  "eyes": {
    "color": "black | brown | blue | green | red | gold | silver | purple | custom",
    "shape": "gentle | sharp | round | narrow"
  },
  "clothing": {
    "category": "military | school | casual | suit | fantasy | japanese | custom",
    "main_color": "black | white | navy | gray | brown | red | blue | green | custom",
    "impression": "formal | practical | elegant | rough | cute | custom"
  },
  "distinguishing_features": "傷・ほくろ・眼帯等の自由記述",
  "art_style": "anime | semi_realistic | manga | painterly"
}
```

#### nonhuman（人外）

```json
{
  "base_form": "dragon | wolf | spirit | robot | zombie | deity | custom",
  "size": "tiny | small | human_scale | large | enormous",
  "movement": "bipedal | quadruped | flying | floating | slithering | custom",
  "distinctive_features": "翼の色・目の数・光り方等",
  "threat_level": "harmless | low | medium | high | catastrophic",
  "art_style": "anime | semi_realistic | manga | painterly"
}
```

#### object（物体）

```json
{
  "category": "weapon | tool | vehicle | structure | consumable | magical | custom",
  "material": "metal | wood | stone | crystal | organic | energy | custom",
  "size": "small | medium | large | enormous",
  "distinctive_features": "炎の刀身・龍の彫刻等の自由記述"
}
```

### 14-3. reference_set

```json
{
  "entity_id": "ent_001",
  "reference_images": [
    {
      "ref_id": "ref_001",
      "label": "全身・正面",
      "s3_key": "saved/{user_id}/entities/ent_001/ref_001.png",
      "cdn_url": "https://img.lyra.app/...",
      "framing": "full_body | half_body | face_only | object_full",
      "approved_at": "ISO 8601"
    }
  ],
  "primary_ref_id": "ref_001",   // コマ生成時に最優先で使うreference
  "status": "empty | partial | ready",
  "updated_at": "ISO 8601"
}
```

**reference_statusの定義**
- `empty`: reference画像なし。コマ生成不可
- `partial`: 1枚あり。コマ生成可能だが一貫性は低め（警告表示）
- `ready`: 2枚以上あり。コマ生成を推奨

### 14-4. entity_state（Scene単位の状態）

```json
{
  "state_id": "est_001",
  "entity_id": "ent_001",
  "scene_id": "sc_001",
  "costume_note": "戦闘服（通常軍服ではなく黒のタクティカルスーツ）",
  "costume_ref_id": "ref_002",       // 別衣装のreference画像（あれば）
  "condition_note": "左腕に包帯",
  "hair_note": "乱れている",
  "expression_default": "determined",
  "extra_note": "自由記述"
}
```

## 15. キャラクター登録GUI

### 15-1. 登録フロー（3パターン）

```
【パターンA: 画像インポートから始める】
PC上の画像をドラッグ&ドロップ / ファイル選択
  ↓
GPT-4o Vision が自動で structured_fields を推定・入力
  ↓
ユーザーが確認・修正（GUIで編集）
  ↓
free_descriptionをユーザーが追記（任意）
  ↓
インポート画像をそのままreference画像として登録
  ↓
entity_status = "ready"

【パターンB: GUIから始める】
entity_typeを選択
  ↓
structured_fieldsをGUIで選択
  ↓
free_descriptionを任意入力
  ↓
「キャラ画像を生成する」→ gpt-image-2でreference画像を生成
  ↓
気に入った画像をreference画像として承認
  ↓
entity_status = "ready"

【パターンC: テキストのみ（人外・物体用）】
entity_typeを選択（nonhuman / object）
  ↓
free_descriptionを自由記述
  ↓
「画像を生成する」→ gpt-image-2で生成
  ↓
気に入った画像をreference画像として承認
  ↓
entity_status = "ready"
```

### 15-2. 画像インポートからのspec自動抽出（パターンA）

```
POST /api/entities/import-image
Body: { image_base64, entity_type }

→ EC2 APIが処理:
  ① 画像をS3 tmp/にアップロード
  ② GPT-4o Vision呼び出し
     system: """
     この画像に描かれているキャラクターの外見を分析し、
     指定のJSONスキーマに従って structured_fields を埋めてください。
     確信がない項目は省略し、確信がある項目のみ埋めること。
     また、外見の特徴を英語で50〜100wordsにまとめた
     prompt_supplement を生成してください。
     """
     input: [画像, entity_typeのスキーマ定義]
  ③ 解析結果を返却

→ レスポンス:
  {
    "suggested_fields": { ... },
    "prompt_supplement": "long straight black hair, navy military uniform with gold trim, ...",
    "tmp_image_s3_key": "..."
  }

→ ユーザーが確認・修正 → 保存
```

### 15-3. キャラ生成パイプライン（パターンB/C）

```
POST /api/entities/{id}/generate-reference

→ EC2 API:
  ① クレジットチェック（キャラプレビュー1回: 8cr / $0.08相当）
  ② prompt構築:
     - entity_type別のシステム指示
     - structured_fields → テキスト変換
     - free_description そのまま追加
     - prompt_supplement（あれば）
     - スタイルロック: "anime illustration style, full body shot, white background, clean lineart"
     - objectの場合: "isolated object on white background, no character"
  ③ SQSにジョブエンキュー（job_type: "entity_generate"）
  → { job_id } 即時返却

→ Lambda Worker:
  ① gpt-image-2呼び出し（quality: low, size: 1024x1536, n=3）
  ② 生成画像をS3 tmp/にアップロード
  ③ ジョブ結果をRDSに書き込み
  ④ Upstash Redis PUBLISH 完了通知

→ クライアント: 3枚の候補を表示
→ ユーザーが1〜3枚を選択してreference画像として承認
```

## 16. prompt_supplementの管理

prompt_supplementはGPT-4oが一度だけ生成し、保存する。コマ生成時の補助として参照するが、**reference画像が主役**であり、このテキストはgpt-image-2への付加情報に過ぎない。

```
prompt_supplement生成タイミング:
  - パターンA: 画像インポート時にGPT-4o Visionが自動生成
  - パターンB/C: ユーザーがreference画像を承認した後にGPT-4o Visionが自動生成

prompt_supplementの内容（英語、50〜100words）:
  - キャラの外見の客観的記述
  - スタイル指定は含めない（スタイルはシステム側で固定）
  - ストーリー上の設定・性格は含めない
```

---

# Part V: ストーリーシステム（人間×AI協働）

---

## 17. ストーリー全体フロー

```
【Work層（作品全体）】
ユーザーがタイトル・世界観・テーマを入力
  ↓ AI（Claude Sonnet）が骨格を提案
人間が編集・承認（どちらも書ける）

【Chapter層（章）】
AI提案 ↔ 人間編集（双方向）
  - AIが章構成を提案
  - 人間が直接書いてもよい
  - AIに「この章をもっと緊張感を出して」と指示してもよい

【Episode層（話）】
AI提案 ↔ 人間編集（双方向）
  話が固まったら：

  ↓ ボタンひとつ「ページ構成を自動生成」

【Page骨格の自動生成】
  AIが Episode の内容から:
    - 何ページ構成か
    - 各ページのコマ数・サイズ案
    - 各コマの「誰が何をしているか」の骨格
    を自動生成

  ユーザーが確認・編集
    ↓
  コマに登場キャラを選択 + 状況テキストを入力
    ↓
  ページ生成
```

## 18. 人間×AI協働の実装

各層でAIと人間が**同じテキストフィールドを共有**する。

```
UIコンポーネント: CollaborativeEditor

[AIが書いた内容]                [人間が直接編集]
  ↓「AIに修正依頼」ボタン           ↓ テキストを直接書き換え
  ↓ チャット入力                    ↓
  ↓ Claude Sonnetが修正案           ↓
  ↓ 差分表示 → 採用/却下            ↓ 即座に保存

→ 最終的にどちらの編集も同じフィールドに反映
→ version管理（変更履歴を5世代保持）
```

### 18-1. AI提案のリクエスト形式

```
POST /api/story/collaborate
Body: {
  "layer": "work | chapter | episode",
  "target_id": "ch_001",
  "instruction": "この章をもっと緊張感のある展開にして",
  "context": { ... }  // 上位層の要約 + 現在層のデータ
}

→ Claude Sonnet がストリーミングで返答
→ フロントエンドがストリーミングを受け取りリアルタイム表示
→ ユーザーが「採用」→ DBに反映 / 「破棄」→ 何もしない
```

### 18-2. Episode→Page骨格自動生成

```
POST /api/episodes/{id}/generate-page-skeleton

→ Claude Sonnet:
  system: """
  漫画のEpisodeの内容を受け取り、ページ構成・コマ構成を設計してください。
  出力JSON:
  {
    "pages": [
      {
        "page_number": 1,
        "purpose": "この戦闘が始まるシーン",
        "suggested_panel_count": 4,
        "suggested_layout": "standard_4",
        "panels": [
          {
            "order": 1,
            "panel_role": "establish",
            "suggested_size": "large",
            "situation_hint": "廃墟の広場。主人公が構えを取る。",
            "suggested_entities": ["char_001"],
            "suggested_dialogue_hint": null
          }
        ]
      }
    ]
  }
  ページ数の目安: 1話16〜24ページ。
  コマ数の目安: 1ページ4〜8コマ。
  climaxページはコマを大きく・少なく。
  """
  user: episode全データ + キャラ一覧（name, role）

→ ユーザーが確認・修正
→ 各コマにキャラを選択 + situation_textを入力 → ページ生成へ
```

## 19. 6層構造

### 19-1. Work

```json
{
  "work_id": "work_001",
  "user_id": "user_001",
  "title": "月光の戦士",
  "genre": "バトルファンタジー",
  "world_setting": "近未来的な廃墟と魔法が共存する世界",
  "theme": "信念と諦めの狭間で戦う者の物語",
  "main_entity_ids": ["ent_001", "ent_002"],
  "starting_point": "...",
  "ending_point": "...",
  "overall_flow": "...",
  "version": 1,
  "edit_history": [],
  "status": "draft | active | completed"
}
```

### 19-2. Chapter

```json
{
  "chapter_id": "ch_001",
  "work_id": "work_001",
  "order": 1,
  "title": "第一章: 星の重さ",
  "purpose": "主人公の信念と対戦相手の哲学が初めてぶつかる",
  "starting_state": "...",
  "ending_state": "...",
  "emotion_curve": "平静 → 緊張 → 衝突 → 余韻",
  "entities_involved": ["ent_001", "ent_002"],
  "key_beats": ["初対面", "価値観の対立", "戦闘開始"],
  "version": 1,
  "edit_history": [],
  "status": "draft | active | locked"
}
```

### 19-3. Episode

```json
{
  "episode_id": "ep_001",
  "chapter_id": "ch_001",
  "order": 1,
  "title": "第1話: この星屑に潰されろォォ！！",
  "purpose": "月華と敵将校の初戦闘。互いの技と信念を見せる。",
  "introduction": "廃墟の広場で対峙する二人。",
  "middle": "激しい打ち合い。敵が星の重さを武器にする。",
  "climax": "月華が「月光・流星槍」で決着をつける。",
  "ending_hook": "「…まだ、早い。」",
  "estimated_pages": 16,
  "entities_involved": ["ent_001", "ent_002"],
  "page_skeleton_generated": false,
  "version": 1,
  "edit_history": [],
  "status": "draft | active | pages_generated | locked"
}
```

### 19-4. Scene（ページ生成の直前単位）

EpisodeをPage骨格に変換する際の中間層。Sceneは場所・時間・登場エンティティが同じ連続コマのまとまり。

```json
{
  "scene_id": "sc_001",
  "episode_id": "ep_001",
  "order": 1,
  "location": "廃墟の広場",
  "time": "夜",
  "involved_entity_ids": ["ent_001", "ent_002"],
  "entity_states": [
    { "entity_id": "ent_001", "state_id": "est_001" }
  ],
  "atmosphere": "tense",
  "page_ids": ["page_001", "page_002"]
}
```

---

# Part VI: ページ・コマ設計システム

---

## 20. Page

```json
{
  "page_id": "page_001",
  "episode_id": "ep_001",
  "scene_id": "sc_001",
  "page_number": 1,
  "layout_config": {
    "type": "template | custom | ai_generated",
    "template_id": "standard_4",
    "panel_count": 4,
    "layout_reference_s3_key": "...",   // コマ割りreferenceとして渡す画像
    "frame_definitions": []             // PanelFrameエディタで作った枠定義
  },
  "dialogue_mode": "image_baked | balloon_only | mixed",
  "page_dialogue_toggle": true,   // ページ全体でセリフON/OFFの一括トグル
  "generated_image": {
    "s3_key": null,
    "cdn_url": null,
    "generation_mode": "standard | thinking",
    "generated_at": null
  },
  "panels": ["pnl_001", "pnl_002", "pnl_003", "pnl_004"],
  "status": "designing | generating | generated | editing | confirmed",
  "created_at": "ISO 8601",
  "updated_at": "ISO 8601"
}
```

## 21. Panel

コマ1枚の設計。「誰が何をしているか」がコアの情報。

```json
{
  "panel_id": "pnl_001",
  "page_id": "page_001",
  "order": 1,
  "panel_role": "establish | action | reaction | emphasis | transition | pause | impact",
  "panel_size": "standard | large | wide | narrow | splash",
  "situation_text": "月華が廃墟の広場で槍を構える。背後に崩れた建物。",
  "entities": [
    {
      "entity_id": "ent_001",
      "role": "primary | secondary | background",
      "expression": "determined | calm | angry | sad | surprised | custom",
      "custom_expression": "",
      "action": "standing_firm | attacking | defending | running | custom",
      "custom_action": "",
      "position": "left | center | right | background",
      "state_id": "est_001"
    }
  ],
  "composition": {
    "source": "gallery | custom | ai_auto",
    "gallery_item_id": "battle_single_001",
    "composition_prompt": "single character, full body, front angle, battle stance, dramatic lighting",
    "shot_type": "full_body | half_body | close_up | wide | extreme_close_up",
    "angle": "front | side | three_quarter | bird_eye | worm_eye | dutch_angle",
    "custom_note": ""
  },
  "dialogue_in_panel": true,   // このコマだけセリフON/OFF（ページトグルをオーバーライド）
  "dialogue": [
    {
      "entity_id": "ent_001",
      "text": "この星屑に、潰されろォォ！！",
      "type": "speech | thought | narration | shout | whisper | sfx",
      "position": "top | bottom | left | right | center"
    }
  ],
  "sfx_text": "ドオオオン",
  "background_note": "廃墟の広場。夜空と壊れた建物。",
  "panel_notes": "迫力のある1枚目。大ゴマで"
}
```

## 22. コマ割りレイアウトシステム

### 22-1. テンプレート

| template_id | コマ数 | 説明 |
|---|---|---|
| `standard_4` | 4 | 標準4コマ均等 |
| `top_wide_3` | 3 | 上段大コマ+下段2コマ |
| `standard_6` | 6 | 3×2の標準6コマ |
| `dense_8` | 8 | 8コマ密集 |
| `climax_2` | 2 | 見開き風2大コマ |
| `splash_1` | 1 | 全面1コマ |
| `action_5` | 5 | 縦長+横長の組み合わせ |
| `battle_7` | 7 | バトル向け動的配置 |

### 22-2. PanelFrameエディタ（カスタム）

ユーザーが自分でコマ枠を作れるエディタ。作成したレイアウトをコマ割りreferenceとして画像生成に渡す。

```
エディタ機能:
  - 4頂点ドラッグでコマ形状を自由に変形
  - コマの追加・削除・読み順指定
  - コマ間の枠線スタイル（実線・破線・なし）
  - 保存したレイアウトを次回から呼び出せる

エディタで作成したレイアウトの画像生成への渡し方:
  → PanelFrameエディタのレイアウトをPNG画像としてエクスポート
  → そのPNGをgpt-image-2のinput_imagesのひとつとして渡す
  → promptに「Follow this panel layout exactly. 
      Divide the page according to the provided layout reference image.」と明示

※ ImagePlacementの機能（画像をコマにはめて位置調整する）は廃止
  ページ単位生成のため、各コマ画像を個別に管理・配置する概念がなくなった
```

### 22-3. AI自動レイアウト

```
Episode骨格自動生成時に suggested_layout が提案される
  ↓
ユーザーが「AIの提案通りで生成する」を選択
  ↓
Claude Sonnetが生成したレイアウト案をpromptとして活用
  （テンプレートに対応する場合はtemplate_idを使用）
```

## 23. コマ設計GUI

### 23-1. ページ設計画面の構成

```
┌────────────────────────────────────────┐
│  ページ設計画面（page_id: page_001）      │
│                                          │
│  [コマ割り選択]                          │
│   ○ テンプレート ○ エディタ ○ AI自動     │
│                                          │
│  [ページ設定]                            │
│   セリフ: [ページ全体ON] [ページ全体OFF]  │
│                                          │
│  [コマ一覧]                              │
│  ┌────────┐ ┌────────┐ ┌────────┐       │
│  │ コマ1  │ │ コマ2  │ │ コマ3  │       │
│  │[編集]  │ │[編集]  │ │[編集]  │       │
│  └────────┘ └────────┘ └────────┘       │
│                                          │
│  [ページを生成する]                       │
└────────────────────────────────────────┘
```

### 23-2. コマ編集パネル

```
┌─────────────────────────────────────┐
│  コマ2 編集                          │
│                                      │
│  登場エンティティ:                   │
│  [月華 ▼] [+ 追加]                  │
│    役割: [主役 ▼]                   │
│    表情: [determined ▼][ 自由記述▼] │
│    アクション: [attacking ▼][自由▼] │
│    位置: [左 ▼]                     │
│                                      │
│  状況（自由テキスト）:               │
│  ┌─────────────────────────────┐    │
│  │月華が敵の槍を弾き飛ばした瞬間│    │
│  └─────────────────────────────┘    │
│                                      │
│  構図: [ギャラリー ▼][カスタム]     │
│  セリフ: [このコマはON ▼]           │
│  セリフ入力: ─────────────────       │
│  効果音: [ドオオオン]               │
│                                      │
│  コマサイズ: [標準 ▼]               │
│  背景メモ: _______________           │
└─────────────────────────────────────┘
```

---

# Part VII: 画像生成パイプライン（gpt-image-2 + GPT-5.4 mini planner）

---

## 24. 生成モード判定

```typescript
function determineGenerationMode(page: Page): 'standard' | 'thinking' {
  const entityCount = countUniqueEntities(page.panels);
  const panelCount = page.panels.length;

  if (entityCount > 4 || panelCount > 8) {
    return 'thinking';  // 14cr / $0.14
  }
  return 'standard';    // 10cr / $0.10
}
```

| 条件 | モード | ユーザー課金 | 推定実費 |
|---|---|---|---|
| エンティティ≤4人 かつ コマ≤8 | Standard | 10cr / $0.10 | ~$0.06〜$0.07 |
| エンティティ>4人 または コマ>8 | Thinking | 14cr / $0.14 | ~$0.08〜$0.10 |

※ ユーザー起点の再生成は生成モードに関係なく 22cr / $0.22 の高品質プロファイルで扱う。

## 25. ページ生成パイプライン（完全フロー）

```
[クライアント操作]
1. ページ設計完了 → 「ページを生成する」ボタン押下

[EC2 API - POST /api/pages/{page_id}/generate]
2. JWT検証 → user取得
3. ページデータ・パネル全件取得
4. 操作種別判定（initial / regenerate）
   - generated_image が未作成 → initial
   - 既存結果あり + ユーザー再実行 → regenerate
5. initial の場合のみ生成モード判定（standard / thinking）
6. クレジットチェック
   - initial + standard: 10cr
   - initial + thinking: 14cr
   - regenerate: 22cr
7. 各エンティティの reference画像 + prompt_supplement を取得
8. layout_config に基づきレイアウト情報を準備
   - template → template名をpromptに変換
   - custom → PanelFrame画像をS3から取得（input_imageとして使う）
   - ai_auto → Episode骨格のlayout情報をpromptに変換
9. ページ生成prompt構築（後述）
10. クレジット消費（DBトランザクション内）
11. generation_jobs レコード作成（status="queued"）
12. SQSメッセージ送信
    {
      "job_id": "job_xxx",
      "job_type": "page_generate",
      "user_id": "user_xxx",
      "payload": {
        "page_id": "page_001",
        "generation_mode": "standard",
        "request_kind": "initial",
        "prompt": "...",
        "input_images": [
          { "role": "entity_reference", "entity_id": "ent_001", "s3_key": "..." },
          { "role": "entity_reference", "entity_id": "ent_002", "s3_key": "..." },
          { "role": "layout_reference", "s3_key": "..." }  // customの場合
        ],
        "aspect_ratio": "portrait",
        "style_lock": "anime illustration style, manga panel layout, clean lineart, ..."
      }
    }
13. レスポンス: { job_id } 即時返却

[Lambda Worker - SQS デキュー]
14. メッセージ受信
15. generation_jobs を "processing" に更新
16. S3からinput画像をダウンロード（一時領域）
17. generation_mode === "thinking" または request_kind === "regenerate" の場合、
    GPT-5.4 mini で internal_generation_plan を作成
    - コマごとの主役
    - 視線とカメラ優先順位
    - 吹き出し余白
    - 背景/アクションの優先度
18. gpt-image-2 API呼び出し
    {
      model: "gpt-image-2",
      input: [
        { type: "input_image", image_url: entity_ref_1_base64 },
        { type: "input_image", image_url: entity_ref_2_base64 },
        // layout_reference（customの場合）
        { type: "input_image", image_url: layout_ref_base64 },
        { type: "text", text: prompt + "\n\n" + internal_generation_plan }
      ],
      quality: request_kind === 'regenerate' ? "high" : "medium",
      size: "1024x1536",  // 漫画ページ（ポートレート）
      n: 1
    }
19. 生成画像をbase64デコード
20. S3 session/{user_id}/pages/{page_id}/ にアップロード
21. generation_jobs を "completed" に更新
    result: { s3_key, cdn_url, generation_mode, request_kind, cost_usd }
22. RDS pages テーブルを更新（generated_image フィールド）
23. Upstash Redis PUBLISH "job:{job_id}" {result}
24. 一時ファイル削除

[EC2 API - WebSocket転送]
25. Redis SUBSCRIBE受信
26. 該当WebSocket clientに転送

[クライアント]
27. ページ画像を表示
28. 気に入らない場合 → コマ設計を修正 → 再生成
29. 気に入った場合 → 「確定」→ session/ → saved/ にコピー
```

## 26. ページ生成prompt構築

### 26-1. promptの構造

```
[1] ページ全体の指示
  "Create a manga page with {N} panels arranged in {layout_description}."
  "This is page {X} of the episode: {episode_purpose}"

[2] レイアウト指定
  template: "Use a {template_name} layout: {template_description}"
  custom:   "Follow the panel layout shown in the layout reference image exactly."
  ai_auto:  "Use the following panel arrangement: {ai_layout_description}"

[3] 各コマの内容（Panel情報を順番に記述）
  "Panel 1 ({panel_role}, {panel_size}): {situation_text}
   Characters: {entity descriptions with reference}
   Composition: {composition_prompt}
   Background: {background_note}"

[4] エンティティ参照の明示
  "Image 1 is the appearance reference for {entity_name}. Keep this character's
   face, hair, and costume exactly consistent throughout all panels they appear in."

[5] セリフの指定（dialogue_mode = image_baked の場合）
  "Panel 1 dialogue: '{text}' in speech balloon at {position}."
  "SFX in panel 1: '{sfx_text}' in manga-style lettering."

[6] スタイルロック（常に末尾に固定）
  "Style: anime manga illustration, clean black line art, flat colors with
   manga-style shading, panel borders with gutters, reading order right-to-left,
   NO photorealistic rendering, NO western comic style."
```

### 26-2. エンティティ数に応じた記述方針

| エンティティ数 | 記述方針 |
|---|---|
| 1人 | "Image 1 is [name]'s reference." |
| 2人 | "Image 1 is [A]'s reference. Image 2 is [B]'s reference." |
| 3〜4人 | 同様に Image 1〜4 まで明示 |
| 5人以上 | Thinkingモード自動適用。「Focus on Image 1〜4 as main characters, others as background」|

### 26-3. コマ割りreferenceの渡し方（custom）

```
prompt中に追記:
"The last input image is the panel layout reference.
 Follow this layout exactly for dividing the page into panels.
 Only use it as a layout guide — do not copy any art style or content from it."
```

## 27. セリフ生成モード

| mode | 内容 | ユーザー操作 |
|---|---|---|
| `image_baked` | セリフを画像に焼き込む | コマ設計時にセリフを入力。生成後の編集は再生成が必要 |
| `balloon_only` | セリフなしで生成。後からBalloonレイヤーで追加 | 生成後にBalloonエディタで吹き出しを配置 |
| `mixed` | コマごとに個別設定 | コマ単位でON/OFF切替 |

**ページ設計画面でのセリフ設定UI**
```
[ページ全体: 全てimage_baked] [ページ全体: 全てballoon_only] [コマ別設定]

各コマに「セリフあり/なし」トグルを配置（コマ別設定時）
```

## 28. 再生成フロー

```
ユーザーが「このページの3コマ目を直したい」と思った場合:

1. ページ設計画面でコマ3をクリック
2. コマ編集パネルでsituation_text / 表情 / 構図 等を修正
3. 「ページを再生成する」ボタン
→ ページ全体が再生成される（コマ単位の部分差し替えはしない）
→ ユーザー起点の再生成は 22cr の高品質プロファイルで実行される

生成回数に上限なし。ただし課金ルールは次の通り:
- 初回生成: Standard 10cr / Thinking 14cr
- ユーザー起点の再生成: 22cr
- システム都合の再試行: 0cr
  - generation_jobs failed
  - S3保存失敗
  - 明らかな生成破綻（コマ欠落・人物欠落・判読不能な崩れ）
```

---

# Part VIII: ページエディタ（Balloonレイヤー）

---

## 29. エディタの役割

`dialogue_mode = image_baked` の場合はBalloonエディタは開かない。
`dialogue_mode = balloon_only` または `mixed` の場合のみ、生成後にBalloonエディタが利用可能。

Balloonエディタはページ画像の上にSVGオーバーレイでテキストを描画する。

## 30. Balloon

```json
{
  "balloon_id": "b001",
  "page_id": "page_001",
  "speaker_entity_id": "ent_001",
  "balloon_type": "speech | thought | narration | shout | whisper | sfx | caption",
  "writing_mode": "vertical | horizontal",
  "text": "…まだ、早い。",
  "position": {
    "x": 0.62,
    "y": 0.18,
    "width": 0.18,
    "height": 0.12
  },
  "tail": {
    "base_x": 0.60,
    "base_y": 0.28,
    "tip_x": 0.45,
    "tip_y": 0.35
  },
  "font_size": 18,
  "font_family": "manga_gothic | mincho | rounded | bold",
  "panel_order_reference": 1,
  "z_index": 10
}
```

## 31. Balloonエディタ操作

```
生成ページ画像が表示された状態で:
  - クリック → 吹き出しを新規追加
  - ドラッグ → 吹き出しを移動
  - コーナードラッグ → リサイズ
  - テキストクリック → インライン編集
  - 尾部ドラッグ → 向き変更
  - 右クリック → スタイル変更 / 削除

Panel.dialogueからの自動配置:
  「吹き出しを自動配置する」ボタン
  → Panel.dialogue の内容を読み取り
  → AIが位置を推定してBalloonを自動生成（ユーザーが微調整）
```

## 32. ページ確定処理

```
POST /api/pages/{page_id}/confirm

→ EC2 API:
  ① 生成済みページ画像（S3 session/）を読み込み
  ② Balloon情報をSVGとして描画
  ③ ページ画像 + SVG を合成（Sharp.jsで処理）
  ④ S3 saved/{user_id}/pages/{page_id}_final.png にアップロード
  ⑤ page.status = "confirmed" に更新
  ⑥ session/ の元画像は保持（7日後に自動削除）

出力: 300DPI B5 PNG
```

---

# Part IX: 課金システム

---

## 33. クレジット設計

### 33-1. 消費レート

| 操作 | USD換算 | 説明 |
|---|---|---|
| キャラ・エンティティ生成（3候補）| **$0.08** | reference候補プレビューの初回生成。固定収益源 |
| ページ生成（Standard） | **$0.10** | エンティティ≤4 かつ コマ≤8 |
| ページ生成（Thinking） | **$0.14** | エンティティ>4 または コマ>8 |
| ページ再生成 | **$0.22** | ユーザー起点の高品質プロファイル再生成 |
| テキスト・設定変更・保存 | **$0** | 無課金 |
| ストーリー生成・チャット | **$0** | Claude Sonnetのコストはプラン料金に含む |
| Balloon編集・ページ確定 | **$0** | 無課金 |

**収益モデルの考え方**
- キャラ生成: 一作品あたり数回〜十数回の固定収益（$0.08 × 登録キャラ数）
- ページ初回生成: 試行錯誤しやすいよう $0.10〜$0.14 に抑える
- ページ再生成: こっち都合の品質改善コストを含むため、$0.22 でも薄利で運用する

### 33-2. クレジット換算

1cr = $0.01（1セント）

| 操作 | 消費クレジット |
|---|---|
| キャラ生成 | 8cr |
| ページ生成（Standard）| 10cr |
| ページ生成（Thinking）| 14cr |
| ページ再生成 | 22cr |

### 33-3. プラン

| プラン | 月額 | 月間クレジット | saved容量 | 同時ジョブ |
|---|---|---|---|---|
| Free | ¥0 | 初回200cr（補充なし）| 200MB | 1 |
| Standard | ¥1,980 | 1,000cr/月 | 5GB | 2 |
| Premium | ¥5,980 | 3,500cr/月 | 20GB | 3 |

追加パック: 200cr ¥500 / 1,000cr ¥2,000 / 3,000cr ¥5,000

**Freeプランで体験できること**
- キャラ25体生成（8cr × 25 = 200cr）
- またはページ20枚生成（10cr × 20 = 200cr）
- またはキャラ10体 + ページ12枚

### 33-4. Stripe統合フロー

```
[サブスク加入]
POST /api/billing/checkout/subscription
→ Stripe Checkout Session (mode="subscription")
→ redirect to Stripe

[Webhook処理 - POST /api/webhooks/stripe]
① Stripe-Signature 検証
② processed_stripe_events で冪等チェック
③ イベント処理:
   checkout.session.completed → サブスク登録 + クレジット付与
   invoice.paid              → 月次クレジット付与
   invoice.payment_failed    → plan を free に降格
   subscription.deleted      → plan を free に降格

クレジット2財布方式:
  monthly_credits（月末リセット、翌月繰り越しなし）
  purchased_credits（購入から1年有効）
  消費順: monthly → purchased
```

### 33-5. クレジット消費（アトミック処理）

```sql
BEGIN;
SELECT monthly_credits, purchased_credits
FROM credit_balances
WHERE user_id = $1
FOR UPDATE;

-- アプリ側で残高チェック・消費計算

UPDATE credit_balances
SET monthly_credits = monthly_credits - $monthly_deduct,
    purchased_credits = purchased_credits - $purchased_deduct,
    updated_at = NOW()
WHERE user_id = $1;

INSERT INTO credit_ledger
  (id, user_id, type, amount, description, job_id)
VALUES
  (gen_random_uuid(), $1, 'consume', -$total, $description, $job_id);

COMMIT;
```

---

# Part X: API設計

---

## 34. 共通仕様

```
Base URL: https://api.lyra.app
認証: Authorization: Bearer {supabase_jwt}
Content-Type: application/json

エラー形式:
{ "error": { "code": "ERROR_CODE", "message": "..." } }

共通エラーコード:
  401 UNAUTHORIZED
  402 INSUFFICIENT_CREDITS
  403 FORBIDDEN
  422 VALIDATION_ERROR
  429 RATE_LIMITED
  500 INTERNAL_ERROR

レート制限（Upstash Redisで管理）:
  画像生成API: 10req/min/user
  ストーリーAPI（Claude使用）: 20req/min/user
  その他: 100req/min/user
```

## 35. エンティティAPI

| Method | Path | 説明 |
|---|---|---|
| POST | /api/works/{work_id}/entities | エンティティ作成 |
| GET | /api/works/{work_id}/entities | 一覧取得 |
| GET | /api/entities/{id} | 取得 |
| PUT | /api/entities/{id} | spec更新 |
| DELETE | /api/entities/{id} | 削除 |
| POST | /api/entities/import-image | 画像インポート→spec自動抽出 |
| POST | /api/entities/{id}/generate-reference | reference画像生成（→job_id）|
| POST | /api/entities/{id}/reference/confirm | reference画像確定（1〜3枚）|
| DELETE | /api/entities/{id}/reference/{ref_id} | reference画像削除 |
| POST | /api/entities/{id}/states | entity_state作成 |
| PUT | /api/entities/{id}/states/{state_id} | entity_state更新 |

## 36. ストーリーAPI

| Method | Path | 説明 |
|---|---|---|
| POST | /api/works | 作品作成 |
| GET/PUT | /api/works/{id} | 作品取得/更新 |
| POST | /api/story/collaborate | AI協働（Claude Sonnet・ストリーミング）|
| POST/GET | /api/works/{id}/chapters | 章追加/一覧 |
| PUT/DELETE | /api/chapters/{id} | 章更新/削除 |
| POST/GET | /api/chapters/{id}/episodes | 話追加/一覧 |
| PUT/DELETE | /api/episodes/{id} | 話更新/削除 |
| POST | /api/episodes/{id}/generate-page-skeleton | Page骨格自動生成（Claude Sonnet）|
| POST/GET | /api/episodes/{id}/scenes | Scene追加/一覧 |
| PUT/DELETE | /api/scenes/{id} | Scene更新/削除 |

## 37. ページ・コマAPI

| Method | Path | 説明 |
|---|---|---|
| POST/GET | /api/episodes/{id}/pages | ページ作成/一覧 |
| GET/PUT/DELETE | /api/pages/{id} | ページ取得/更新/削除 |
| POST/GET | /api/pages/{id}/panels | コマ追加/一覧 |
| PUT/DELETE | /api/panels/{id} | コマ更新/削除 |
| POST | /api/pages/{id}/generate | ページ画像生成（→job_id）|
| POST | /api/pages/{id}/confirm | ページ確定（Balloon合成）|
| POST | /api/pages/{id}/reopen | ページreopen |
| POST/GET | /api/pages/{id}/balloons | Balloon追加/一覧 |
| PUT/DELETE | /api/balloons/{id} | Balloon更新/削除 |
| POST | /api/pages/{id}/auto-balloons | Panel.dialogueから自動配置 |
| GET | /api/compositions | 構図ギャラリー一覧 |

## 38. 画像生成・ジョブAPI

| Method | Path | 説明 |
|---|---|---|
| GET | /api/jobs/{job_id} | ジョブ状態取得（ポーリングフォールバック）|
| GET | /api/users/me/jobs | 自分のジョブ履歴 |

## 39. 課金API

| Method | Path | 説明 |
|---|---|---|
| GET | /api/billing/balance | クレジット残高 |
| POST | /api/billing/checkout/subscription | サブスク加入 |
| POST | /api/billing/checkout/credits | クレジット購入 |
| POST | /api/billing/customer-portal | Stripe Portal |
| POST | /api/webhooks/stripe | Webhook受信 |

---

# Part XI: DBスキーマ

---

## 40. Aurora PostgreSQL スキーマ

### ユーザー・認証・課金

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supabase_id TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  display_name TEXT,
  stripe_customer_id TEXT UNIQUE,
  plan_code TEXT NOT NULL DEFAULT 'free',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_users_supabase_id ON users(supabase_id);

CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stripe_subscription_id TEXT UNIQUE NOT NULL,
  plan_code TEXT NOT NULL,
  status TEXT NOT NULL,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE credit_balances (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  monthly_credits INTEGER NOT NULL DEFAULT 0,
  purchased_credits INTEGER NOT NULL DEFAULT 0,
  monthly_expires_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE credit_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,
  amount INTEGER NOT NULL,
  monthly_after INTEGER NOT NULL,
  purchased_after INTEGER NOT NULL,
  description TEXT,
  stripe_event_id TEXT,
  job_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_credit_ledger_user ON credit_ledger(user_id, created_at DESC);

CREATE TABLE payment_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  stripe_checkout_session_id TEXT,
  stripe_invoice_id TEXT,
  kind TEXT NOT NULL,
  amount_jpy INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE processed_stripe_events (
  stripe_event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 作品・ストーリー

```sql
CREATE TABLE works (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  genre TEXT,
  world_setting TEXT,
  theme TEXT,
  main_entity_ids UUID[] DEFAULT '{}',
  starting_point TEXT,
  ending_point TEXT,
  overall_flow TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  edit_history JSONB DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_works_user ON works(user_id, created_at DESC);

CREATE TABLE chapters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_id UUID NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  "order" INTEGER NOT NULL,
  title TEXT,
  purpose TEXT,
  starting_state TEXT,
  ending_state TEXT,
  emotion_curve TEXT,
  entities_involved UUID[] DEFAULT '{}',
  key_beats TEXT[] DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  edit_history JSONB DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(work_id, "order")
);

CREATE TABLE episodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chapter_id UUID NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  "order" INTEGER NOT NULL,
  title TEXT,
  purpose TEXT,
  introduction TEXT,
  middle TEXT,
  climax TEXT,
  ending_hook TEXT,
  estimated_pages INTEGER DEFAULT 16,
  entities_involved UUID[] DEFAULT '{}',
  page_skeleton_generated BOOLEAN DEFAULT FALSE,
  version INTEGER NOT NULL DEFAULT 1,
  edit_history JSONB DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(chapter_id, "order")
);

CREATE TABLE scenes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id UUID NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  "order" INTEGER NOT NULL,
  location TEXT,
  time TEXT,
  atmosphere TEXT,
  involved_entity_ids UUID[] DEFAULT '{}',
  entity_states JSONB DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(episode_id, "order")
);
```

### エンティティ

```sql
CREATE TABLE entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_id UUID NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  entity_type TEXT NOT NULL DEFAULT 'character',
  name TEXT NOT NULL,
  free_description TEXT,
  structured_fields JSONB DEFAULT '{}',
  prompt_supplement TEXT,
  speech_profile JSONB DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_entities_work ON entities(work_id);

CREATE TABLE reference_sets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id UUID NOT NULL UNIQUE REFERENCES entities(id) ON DELETE CASCADE,
  reference_images JSONB NOT NULL DEFAULT '[]',
  primary_ref_id TEXT,
  status TEXT NOT NULL DEFAULT 'empty',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE entity_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  scene_id UUID REFERENCES scenes(id) ON DELETE SET NULL,
  costume_note TEXT,
  costume_ref_id TEXT,
  condition_note TEXT,
  hair_note TEXT,
  expression_default TEXT DEFAULT 'neutral',
  extra_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_entity_states_entity ON entity_states(entity_id);
```

### ページ・コマ

```sql
CREATE TABLE pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id UUID NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  scene_id UUID REFERENCES scenes(id),
  page_number INTEGER NOT NULL,
  layout_config JSONB NOT NULL DEFAULT '{}',
  dialogue_mode TEXT NOT NULL DEFAULT 'image_baked',
  page_dialogue_toggle BOOLEAN NOT NULL DEFAULT TRUE,
  generated_image JSONB DEFAULT NULL,
  generation_mode TEXT,
  status TEXT NOT NULL DEFAULT 'designing',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(episode_id, page_number)
);
CREATE INDEX idx_pages_episode ON pages(episode_id, page_number);

CREATE TABLE panels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id UUID NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  "order" INTEGER NOT NULL,
  panel_role TEXT DEFAULT 'action',
  panel_size TEXT DEFAULT 'standard',
  situation_text TEXT,
  entities JSONB NOT NULL DEFAULT '[]',
  composition JSONB NOT NULL DEFAULT '{}',
  dialogue_in_panel BOOLEAN DEFAULT TRUE,
  dialogue JSONB NOT NULL DEFAULT '[]',
  sfx_text TEXT,
  background_note TEXT,
  panel_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(page_id, "order")
);

CREATE TABLE panel_frames (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id UUID NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  panel_id UUID REFERENCES panels(id),
  vertices JSONB NOT NULL,
  border_style TEXT DEFAULT 'solid',
  border_width INTEGER DEFAULT 3,
  border_color TEXT DEFAULT '#000000',
  z_index INTEGER DEFAULT 1,
  reading_order INTEGER NOT NULL
);

CREATE TABLE balloons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id UUID NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  speaker_entity_id UUID REFERENCES entities(id),
  balloon_type TEXT NOT NULL DEFAULT 'speech',
  writing_mode TEXT DEFAULT 'vertical',
  text TEXT NOT NULL DEFAULT '',
  position JSONB NOT NULL,
  tail JSONB,
  font_size INTEGER DEFAULT 18,
  font_family TEXT DEFAULT 'manga_gothic',
  panel_order_reference INTEGER,
  z_index INTEGER DEFAULT 10
);
CREATE INDEX idx_balloons_page ON balloons(page_id);
```

### 画像生成ジョブ

```sql
CREATE TABLE generation_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  job_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  generation_mode TEXT,
  credit_cost INTEGER NOT NULL,
  params JSONB NOT NULL,
  result JSONB,
  sqs_message_id TEXT,
  openai_request_id TEXT,
  error_message TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ
);
CREATE INDEX idx_jobs_user ON generation_jobs(user_id, created_at DESC);
CREATE INDEX idx_jobs_status ON generation_jobs(status);
```

### 構図ギャラリー

```sql
CREATE TABLE composition_gallery (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  entity_count INTEGER NOT NULL,
  preview_s3_key TEXT NOT NULL,
  preview_cdn_url TEXT NOT NULL,
  composition_prompt TEXT NOT NULL,
  shot_type TEXT NOT NULL,
  angle TEXT NOT NULL,
  tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

# Part XII: スケーリング設計

---

## 41. トラフィック想定とボトルネック

| フェーズ | DAU | 同時ジョブ | 月間画像生成 |
|---|---|---|---|
| β版 | 100 | 10 | 5,000 |
| 成長期 | 1,000 | 100 | 50,000 |
| 本格期 | 10,000 | 1,000 | 500,000 |

**Free Tier → 有料への移行トリガー**
- EC2 t2.micro の CPU使用率が恒常的に70%超 → t3.small へ
- RDS free period終了（12ヶ月後）→ db.t3.micro $25/月
- S3 5GB超 → $0.023/GB課金開始

## 42. Lambda同時実行数の制御

```
Lambda 同時実行数の設定:
  Reserved Concurrency: 50（初期）→ 200（成長後）

gpt-image-2 のレート制限:
  OpenAI Tier 1: 500 req/min
  Tier 2: 2,000 req/min（$50以上支払後）

Lambda 50同時 × 30秒/req = 100 req/min → Tier 1で十分

SQS VisibilityTimeout: 300秒（Lambdaタイムアウトと同値）
SQS DLQ: lyra-generation-dlq（3回失敗後）
```

## 43. EC2 API サーバーのスケール戦略

```
初期: EC2 t2.micro × 1台（Free Tier）
       PM2 cluster mode（2プロセス）

負荷増大時:
  → EC2 t3.small × 1台 + Auto Scaling Group
  → ALB でヘルスチェック
  → t3.small × 2台（Active-Active）

さらなる成長:
  → ECS Fargate への移行
    （EC2からFargateへはコンテナ化で移行コスト低い）
```

## 44. RDS接続プール

```
EC2 API側: pg-pool（max: 10接続）
Lambda側: pg（接続数上限: 5 × Lambda同時実行数）

RDS db.t3.micro の最大接続数: ~60
  EC2: 10
  Lambda×50: 250 → RDS Proxy が必要な時期（成長後に導入）
```

## 45. S3ストレージ管理

```
s3://lyra-images/
  tmp/{user_id}/entities/{entity_id}/    → 生成候補（TTL: 24h）
  session/{user_id}/pages/{page_id}/     → 生成済みページ（TTL: 7日）
  saved/{user_id}/                       → 確定ファイル（永続）
    entities/{entity_id}/
    pages/{page_id}/

S3 Lifecycle Rules:
  tmp/*:     Expiration 1日
  session/*: Expiration 7日
  saved/*:   Expiration なし（プラン容量上限はアプリで管理）
```

## 46. Observability

```
ログ: CloudWatch Logs
  EC2: PM2がstdout/stderrをCloudWatch Logs Agentで転送
  Lambda: 自動でCloudWatch Logsに書き込み

メトリクス: CloudWatch Metrics
  カスタムメトリクス:
    - lyra/generation_job_duration
    - lyra/credit_consumption_rate
    - lyra/job_failure_rate

アラート:
  SQS DLQ にメッセージ到着 → SNS → メール通知
  Lambda Error率 > 1% → 通知
  EC2 CPU > 80%（5分継続）→ 通知
```

---

# 付録A: 禁止事項

---

## エンティティ関連

| # | 禁止事項 |
|---|---|
| E-1 | 生成候補をユーザー確認なしに自動でreferenceに昇格させること |
| E-2 | prompt_supplementをユーザーが手動で書くこと（GPT-4o Visionが自動生成する）|
| E-3 | reference画像なしのエンティティをコマに登場させること（警告表示は許容）|
| E-4 | entity_specを生成結果で自動上書きすること |
| E-5 | 画像インポート時にGPT-4oの推定結果をユーザー確認なしに保存すること |

## ストーリー関連

| # | 禁止事項 |
|---|---|
| S-1 | AIの提案をユーザー承認なしに正本に反映すること |
| S-2 | 下位層のAIが上位層を勝手に書き換えること |
| S-3 | ストーリー生成にGPT-4.1-miniを使うこと（Claude Sonnetを使う）|
| S-4 | Page骨格自動生成の結果をユーザー確認なしに確定すること |

## 画像生成関連

| # | 禁止事項 |
|---|---|
| V-1 | ユーザーにpromptを手書きさせること |
| V-2 | 画像生成を同期APIレスポンスとして実装すること（SQS+Lambda経由が必須）|
| V-3 | セリフを画像に焼き込んだ後にそのコマだけを差し替えること（ページ全体再生成）|
| V-4 | スタイルロック文字列をpromptから削除すること |
| V-5 | Thinkingモードと判定すべきページをStandardで生成すること（コスト目的での回避禁止）|

## インフラ関連

| # | 禁止事項 |
|---|---|
| I-1 | APIキーをコードやDockerfileに直書きすること（SSM Parameter Storeを使う）|
| I-2 | Fargateタスク内や Lambda内にステートを持つこと（全てS3/RDS/Redisに書き出す）|
| I-3 | Webhookの冪等性チェックを省略すること |
| I-4 | success URLだけでクレジット付与すること（Webhook経由が必須）|
| I-5 | 全生成画像をsaved/に自動で永続保存すること（ユーザーが確定したものだけ）|
| I-6 | Lambda の同時実行数を無制限にすること（OpenAI Rate Limitに引っかかる）|
| I-7 | 月次クレジットを翌月に繰り越すこと |

---

# 付録B: 実装フェーズ計画

---

## Phase 1: インフラ基盤（〜2週間）

1. AWS環境構築（VPC, Subnet, SG, ALB, EC2 t2.micro）
2. RDS PostgreSQL db.t3.micro 構築
3. Upstash Redis アカウント作成・接続設定
4. SQS キュー作成（本キュー + DLQ）
5. S3バケット × 2 + CloudFront × 2 設定
6. SSM Parameter Store にシークレット登録
7. GitHub Actions CI/CD 設定（EC2 SSH deploy + Lambda zip update）
8. EC2上でHono APIの骨格起動（ヘルスチェックのみ通る状態）
9. Lambda Worker の骨格デプロイ（SQSデキュー + ログ出力のみ）

## Phase 2: 認証・ユーザー基盤（〜1週間）

10. Supabase Auth 設定・JWT検証ミドルウェア実装
11. DBスキーマ全テーブル作成（SQL migration）
12. ユーザー自動プロビジョニング
13. クレジット管理基盤（付与・消費・台帳・2財布）

## Phase 3: エンティティシステム（〜3週間）

14. エンティティ登録GUI（GUI入力 + 自由記述欄）
15. 画像インポート → GPT-4o Vision spec自動抽出フロー
16. エンティティ画像生成パイプライン（SQS+Lambda+gpt-image-2）
17. WebSocket ジョブ完了通知実装
18. Reference確定フロー（1〜3枚選択）
19. entity_state 管理機能

## Phase 4: ストーリーシステム（〜3週間）

20. Work / Chapter / Episode CRUD + CollaborativeEditor UI
21. Claude Sonnet ストリーミング統合（/api/story/collaborate）
22. Chapter/Episode AI提案フロー（差分表示・採用/却下）
23. Episode → Page骨格自動生成（Claude Sonnet）
24. Scene管理

## Phase 5: ページ・コマ設計（〜2週間）

25. ページ設計画面UI（コマ一覧・コマ編集パネル）
26. コマ割りテンプレート実装（8種）
27. PanelFrameエディタ（ドラッグ編集 + PNG export）
28. 構図ギャラリー整備（250種）
29. コマへのエンティティ割り当てUI

## Phase 6: ページ画像生成（〜2週間）

30. ページ生成prompt構築ロジック
31. Standard / Thinking モード自動判定
32. Lambda Worker → GPT-5.4 mini planner + gpt-image-2 ページ生成
33. セリフON/OFFモード（page_dialogue_toggle + コマ別設定）
34. ページ再生成フロー（22cr・高品質プロファイル）

## Phase 7: Balloonエディタ（〜2週間）

35. Balloonエディタ（SVGオーバーレイ）
36. 吹き出し追加・移動・リサイズ・スタイル変更
37. Panel.dialogueからの自動配置
38. ページ確定処理（Sharp.js合成）

## Phase 8: 課金（〜1週間）

39. Stripe Checkout + Customer Portal
40. Webhook処理（冪等チェック込み）
41. クレジット消費とUI制限の連動

## Phase 9: 安定化・本番化（〜2週間）

42. CloudWatch アラート設定
43. 負荷テスト（k6等）
44. セキュリティ設定（WAF、S3バケットポリシー）
45. エラーハンドリング強化（DLQ監視・リトライ）
46. ドキュメント整備

---

# 付録C: 設計核心まとめ

### エンティティ（6項目）

1. reference画像が顔一貫性の主役。prompt_supplementは補助にすぎない
2. 登録方法は「GUI入力」「画像インポート」「自然言語テキスト」の3パターン。全て同じ管理画面
3. 人物・人外・物体を統一エンティティとして扱う。種別ごとにstructured_fieldsが変わるだけ
4. reference画像は全身推奨。gpt-image-2への参照指示が効果的になる
5. entity_stateでScene単位の衣装・状態を管理
6. 画像インポートからのspec自動抽出はGPT-4o Vision。ユーザーが確認・修正してから保存

### ストーリー（5項目）

7. 人間とAIが同じテキストフィールドを共有する双方向編集モデル
8. AIが提案、人間が採用/却下。どちらも直接書ける
9. 話が固まったら「ページ構成を自動生成」ボタンひとつでPage骨格＋Panel骨格が出る
10. ストーリーLLMはClaude Sonnet専用。GPT系はVision・prompt変換に専念
11. 各層でedit_historyを保持（5世代）。AI提案の採用履歴も追跡

### 画像生成（6項目）

12. ページ単位一括生成。コマを1枚ずつ生成・配置する概念はない
13. エンティティ>4人またはコマ>8でThinkingモードに自動切替（$0.25/$0.40）
14. reference画像をgpt-image-2のinput_imageとして渡す。「Image 1はAの参照画像」と明示
15. コマ割りreferenceはPanelFrameエディタが出力したPNG画像をinput_imageで渡す
16. セリフはimage_baked（焼き込み）またはballoon_only（後付け）またはmixed（コマ別）
17. 再生成はページ単位。コマ単位の部分差し替えはしない

### インフラ（5項目）

18. EC2 t2.micro（API）+ Lambda（Worker）でAWS Free Tier最大活用
19. 成長に応じてEC2アップグレード→Auto Scaling→ECS Fargate移行の段階的設計
20. SQSで非同期分離。Lambda同時実行数で生成スループットを制御
21. S3の3層管理（tmp 24h / session 7日 / saved 永続）
22. シークレットはSSM Parameter Store。コードに直書きしない

---

*Lyra 統合仕様書 v4.0 終*
