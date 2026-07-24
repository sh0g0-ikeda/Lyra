# キャラクター派生作成機能 要件定義・設計

## 目的

ストーリー進行中にキャラクターの状態が変化した場合でも、各コマで毎回「右頬に斜めの傷」「制服が破れている」「片腕が欠損している」などを明示し続けなくてよい状態を作る。

既存キャラクターから派生した別キャラクターを作成し、その派生キャラクターの確定レファレンス画像をページ生成で使えるようにする。

例:

- `はるか` から `はるか（負傷）` を作る
- `司カサネ` から `司カサネ（制服）` を作る
- `篝カイ` から `篝カイ（片腕欠損）` を作る

## 基本方針

派生キャラクターは既存の `entities` テーブル上の通常キャラクターとして扱う。

ページ生成、コマ割り、登場人物割り当て、プロンプトビルダーには大きな変更を入れない。ページ生成側から見ると、派生キャラクターは通常キャラクターと同じである。

データ構造を大きく変えず、既存のキャラ作成、レファレンス生成、確定、クレジット消費の流れを再利用する。

## 非目標

初期実装では以下を行わない。

- 新しいDBテーブルを追加しない
- `entities` テーブルに派生元IDカラムを追加しない
- ページ生成プロンプト内で毎回状態差分を推論させない
- 既存キャラクターを上書きしない
- 派生履歴管理UIは作らない
- 自動で派生キャラを量産しない

## ユーザー操作

1. ユーザーがキャラクター画面で既存キャラを選択する
2. 「キャラのバージョンチェンジ」を開く
3. 変更後の名前を入力する
4. 変更点を自由入力する
5. 「派生させる」を押す
6. 新しいキャラクターが作成される
7. 元キャラの確定レファレンス画像を参照して、派生キャラのプレビュー生成ジョブが開始される
8. プレビューを確認する
9. 気に入れば確定する
10. 以後、ページ・コマでは派生キャラを通常キャラとして選択できる

## UI

### 表示場所

キャラクター詳細画面の、確定レファレンス画像の近くに配置する。

理由:

- 派生作成は「元キャラの見た目」を基準にする操作である
- 確定画像がないキャラでは成立しないため、画像と近い場所にあるほうが理解しやすい

### UI構成

見出し:

```text
キャラのバージョンチェンジ
```

説明:

```text
元キャラの確定画像をもとに、新しいキャラとして作成します。
```

入力:

```text
変更後の名前
例: はるか（負傷）

変更点
例: 右頬に斜めの傷跡。制服が破れている。左腕に包帯。
```

ボタン:

```text
派生させる
```

### 無効条件

以下の場合は「派生させる」を押せない。

- 元キャラが未保存
- 元キャラに確定済みレファレンス画像がない
- 変更後の名前が空
- 変更点が空
- 生成機能が無効
- クレジット不足
- 同じキャラで生成ジョブが待機中または処理中

### 成功時表示

```text
派生キャラを作成し、プレビュー生成を開始しました。
```

### 失敗時表示

ユーザーが直せる内容に変換して表示する。

例:

- 確定画像がない場合: `先に元キャラのプレビュー画像を確定してください。`
- クレジット不足: `クレジットが不足しています。クレジットを追加してください。`
- 生成中のジョブあり: `このキャラの生成処理が進行中です。完了後にもう一度お試しください。`

## API

### 新規API

```http
POST /api/entities/:sourceEntityId/derive
```

### リクエスト

```json
{
  "work_id": "uuid",
  "name": "はるか（負傷）",
  "change_prompt": "右頬に斜めの傷跡。制服が破れている。左腕に包帯。"
}
```

法人ワークスペースの場合は既存方針に合わせて `organization_id` を query で渡す。

```http
POST /api/entities/:sourceEntityId/derive?organization_id=...
```

### レスポンス

```json
{
  "entity": {
    "id": "uuid",
    "work_id": "uuid",
    "entity_type": "character",
    "name": "はるか（負傷）",
    "free_description": "...",
    "prompt_supplement": "...",
    "structured_fields": {},
    "speech_profile": {},
    "status": "draft",
    "created_at": "...",
    "updated_at": "..."
  },
  "job_id": "uuid"
}
```

### バリデーション

`sourceEntityId`

- UUID
- 現在ユーザーがアクセス可能
- `entity_type = character`
- 確定済み primary reference image を持つ

body:

- `work_id`: UUID
- `name`: trim後1文字以上100文字以下
- `change_prompt`: trim後1文字以上2000文字以下

### 認可

個人:

- source entity が対象ユーザーのアクセス可能な作品に属していること
- new entity を作る `work_id` も同じユーザーのアクセス可能な作品であること
- 初期実装では、source entity と new entity の work は同一であることを必須にする

法人:

- `organization_id` が指定された場合、`edit_work` と `generate` 権限を要求する
- source entity と work が同一organizationに属していること

## サービス設計

### 新規サービスメソッド

`EntityService` または新規 `EntityDerivationService` に追加する。

推奨は `EntityDerivationService`。

理由:

- 通常のEntity CRUDと、派生作成のワークフローは責務が違う
- source entity確認、new entity作成、source画像コピー、生成ジョブ起動、クレジット消費が絡む
- `EntityService` を肥大化させない

```ts
interface DeriveEntityRequest {
  userId: string;
  organizationId: string | null;
  sourceEntityId: string;
  workId: string;
  name: string;
  changePrompt: string;
}

interface DeriveEntityResult {
  entity: Entity;
  jobId: string;
}
```

### 処理手順

1. source entity の reference context を取得する
2. source entity が `character` であることを確認する
3. source entity の `referenceSet.status` が `ready` であることを確認する
4. primary reference image を特定する
5. `work_id` が source entity と同じ作品であることを確認する
6. 派生用の `structured_fields` を作る
7. 派生用の `free_description` と `prompt_supplement` を作る
8. 新しいEntityを作成する
9. source primary reference image を、新Entity用の生成入力として使えるS3キーへサーバー側でコピーする
10. 既存の `EntityReferenceService.enqueueReferenceGeneration` を呼び出す
11. `entity` と `job_id` を返す

## S3画像参照設計

### 問題

現在の `ensureAllowedReferenceSourceKey` は、基本的に以下だけを許可している。

```text
tmp/{userId}/entities/imports/
session/{userId}/entities/{entityId}/
```

そのため、元キャラの確定済み画像を、新しい派生キャラの `source_s3_key` としてそのまま渡す設計は通らない可能性が高い。

また、フロントから任意の `source_s3_key` を受け取ると、他人の画像や別ワークスペース画像を参照させるリスクがある。

### 解決策

フロントから親画像のS3キーを受け取らない。

サーバー側で以下を行う。

1. source entity の primary reference image を取得
2. そのS3キーが source entity に属していることをDBで確認
3. S3上で新Entity用の一時入力画像へコピーする

コピー先例:

```text
tmp/{userId}/entities/imports/derived-{newEntityId}-{uuid}.png
```

または、既存ポリシーを拡張する場合:

```text
tmp/{userId}/entities/{newEntityId}/derived-source/{uuid}.png
```

初期実装では既存許可プレフィックスに乗せやすい `tmp/{userId}/entities/imports/` を推奨する。

## プロンプト設計

派生キャラの `prompt_supplement` には、元画像を上書きしすぎないようにしつつ、変更点を強制する文を入れる。

例:

```text
Derived character version.
Use the attached source image as the base character identity reference.
Preserve the recognizable identity, face structure, hair silhouette, body proportions, and core character features of the source character.
Apply the following version changes exactly:
{change_prompt}
The source image is not the final target image. The version changes override clothing, injuries, scars, missing limbs, damage, accessories, and temporary body state.
Do not remove or soften the requested changes.
```

日本語UIで入力された場合でも、内部プロンプトは英語でよい。画像生成モデルへの追従性を優先する。

ただし、ユーザー入力の `change_prompt` は原文を残す。

## Entityデータの作り方

### name

ユーザー入力をそのまま使う。

例:

```text
はるか（負傷）
```

### free_description

source entity の説明をベースにし、変更点を追記する。

例:

```text
元キャラ「はるか」から派生したバージョン。
変更点: 右頬に斜めの傷跡。制服が破れている。左腕に包帯。

元キャラ説明:
...
```

長くなりすぎる場合は最大長に収める。

### structured_fields

source entity の `structured_fields` をコピーする。

変更点を構造化して無理に上書きしない。

理由:

- 「片腕欠損」「血濡れ」「変身後」など自由度が高く、構造化項目に落としにくい
- 既存GUI項目を壊さない
- prompt_supplementで強制するほうが安全

ただし、将来は以下のような任意フィールドを追加可能。

```json
{
  "derived_version": {
    "source_entity_name": "はるか",
    "change_prompt": "右頬に斜めの傷跡..."
  }
}
```

初期実装ではDB構造を変えない方針を優先し、必須ではない。

### speech_profile

source entity の `speech_profile` をコピーする。

理由:

- 同一人物の派生なので口調は基本的に維持される
- 負傷や衣装変更では話し方まで変える必要はない

## クレジット消費

派生作成時の画像生成は、通常のキャラ画像生成と同じ扱いにする。

使用コスト:

```ts
CREDIT_COSTS.ENTITY_GENERATION
```

個人:

- 個人クレジットから消費

法人:

- `organization_id` が指定されている場合、法人クレジットから消費

失敗時:

- 既存の `EntityGenerationWorkerService` の失敗処理により返金する

注意:

- 新Entity作成だけではクレジットを消費しない
- プレビュー生成ジョブを起動した時点で消費する
- ジョブ作成失敗時は既存の enqueue 失敗補償で返金する

## 生成ジョブ

既存の `entity_generate` ジョブを使う。

`params` は既存形式を維持する。

```json
{
  "entity_id": "new-derived-entity-id",
  "entity_type": "character",
  "previous_entity_status": "draft",
  "source_s3_key": "tmp/{userId}/entities/imports/derived-source.png"
}
```

worker側は大きく変えない。

既存の `buildGeneratorInputImages` が `source_s3_key` を読み込み、画像生成モデルに入力画像として渡す。

## セキュリティ

### 必須

- 任意のS3キーをフロントから受け取らない
- source entity は必ずDBで所有権またはorganization membershipを確認する
- source primary reference image がsource entityのreference set内にあることを確認する
- 派生先workはsource entityと同一workに限定する
- organization指定時は `edit_work` と `generate` を確認する
- `change_prompt` は最大長を設定する
- 生成ジョブは既存のcapacity guardを通す
- クレジット消費は既存サービス経由にする

### 禁止

- フロントから `source_s3_key` を直接指定させる派生API
- 他作品のキャラを無断で派生元にする
- 他organizationのキャラを参照する
- 既存キャラの確定画像を上書きする

## エラーハンドリング

| 条件 | HTTP | ユーザー向けメッセージ |
|---|---:|---|
| source entityが存在しない | 404 | 元キャラが見つかりません。 |
| source entityがcharacterでない | 422 | 派生作成できるのはキャラクターのみです。 |
| 確定レファレンス画像がない | 409 | 先に元キャラのプレビュー画像を確定してください。 |
| work不一致 | 403 | この作品ではそのキャラを派生元にできません。 |
| クレジット不足 | 402 | クレジットが不足しています。 |
| 生成ジョブ重複 | 409 | このキャラの生成処理が進行中です。完了後にもう一度お試しください。 |
| 画像コピー失敗 | 500 | 派生元画像の準備に失敗しました。時間をおいて再試行してください。 |

## テスト計画

### Unit

`EntityDerivationService`

- source characterから派生Entityを作成できる
- sourceの `structured_fields` をコピーする
- sourceの `speech_profile` をコピーする
- `prompt_supplement` に変更点が入る
- sourceに確定画像がない場合は失敗する
- sourceがcharacter以外なら失敗する
- sourceとworkが違う場合は失敗する
- organization指定時に権限がなければ失敗する
- 画像コピー後に `enqueueReferenceGeneration` が呼ばれる

`EntityReferenceSourceKeyPolicy`

- 派生用にコピーされたsource keyが既存許可ルールを通る
- 不正なS3キーは拒否される

### Route

`POST /api/entities/:id/derive`

- 201または202で `entity` と `job_id` を返す
- body validationが効く
- auth必須
- organization capabilityが効く
- 大きすぎる `change_prompt` を拒否する

### Integration

- 派生キャラ作成後、キャラ一覧に表示される
- 生成ジョブがjobsに表示される
- job完了後、派生キャラにプレビュー候補が表示される
- 確定後、ページの登場人物選択に派生キャラが出る

### Worker

- 派生ジョブの `source_s3_key` がinput imageとして読み込まれる
- 生成失敗時にクレジットが返金される

### Frontend

- 確定画像がないキャラでは派生ボタンが無効
- 名前・変更点入力後に派生できる
- 成功時に新キャラが選択される
- プレビュー生成中表示が出る
- エラー文言がユーザー向けになっている

## 実装順序

1. `EntityDerivationService` のインターフェースとテストを書く
2. source entity と primary reference image の取得処理を実装
3. S3コピー用メソッドを `EntityImageStoragePort` に追加
4. 新Entity作成処理を実装
5. 既存 `enqueueReferenceGeneration` 呼び出しを実装
6. `POST /api/entities/:id/derive` を追加
7. フロントに「キャラのバージョンチェンジ」UIを追加
8. テストを通す
9. ローカルで派生作成から確定まで確認
10. 本番デプロイ前に既存キャラ生成・取り込み・ページ生成が壊れていないか確認

## 将来拡張

初期実装後、必要なら以下を追加する。

- 派生元キャラへのリンク表示
- 派生キャラの一覧フィルタ
- 派生履歴
- 「この派生状態をページ範囲に適用」
- ストーリー上の状態変化から派生キャラ作成を提案
- `structured_fields.derived_version` の標準化

## 採用判断

この設計は採用してよい。

理由:

- 既存ページ生成パイプラインを大きく変更しない
- DB migrationなしで初期実装できる
- キャラクター一貫性を画像レファレンス側で管理できる
- コマごとの冗長な傷・衣装・欠損説明を減らせる
- 通常キャラ生成と同じクレジット消費・返金・ジョブ監視を使える

最小で安全な実現方法は、派生状態をページ生成時に都度説明するのではなく、派生キャラクターを通常キャラクターとして追加する方式である。
