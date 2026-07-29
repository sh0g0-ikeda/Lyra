# Lyra for mobile フロントエンド設計書

最終更新: 2026-07-07

## 1. 目的

Lyra for mobile は、既存の Lyra Web と同じバックエンドを使うネイティブモバイルアプリである。
この設計書は、別ウィンドウ・別担当者がこの文書だけを読んで、現在の Web 版と矛盾しないモバイル版フロントを新規実装できる状態を目標にする。

対象はフロントエンドであり、バックエンドAPIの仕様変更は原則行わない。
決済については、App Store / Google Play の課金実装が別途必要になるため、本書では購入処理の実装詳細を扱わない。ただし、現在のプラン・残クレジット・ジョブ状態の表示は既存APIで行う。

## 2. 結論

フロントは作り直しになる。
理由は、現在の Web 版は PC/ブラウザ中心の React UI であり、モバイルでは以下が根本的に異なるためである。

- 画面遷移はサイドバーではなく下部タブが自然
- 画像選択、保存、共有、ファイルダウンロードはOSネイティブAPIを使う必要がある
- Cognito Hosted UI からアプリへ戻すには Deep Link / Universal Link が必要
- 長い入力フォームは PC と同じ並びでは使いにくい
- 大きい画像の表示・キャッシュ・メモリ管理がブラウザとは異なる

ただし、バックエンドは作り直さない。
モバイル版は既存APIをそのまま呼び、保存されるデータ構造も Web 版と同一にする。

## 3. スコープ

### 3.1 実装対象

- Cognito Hosted UI によるログイン・登録
- 作品作成・選択
- ストーリー作成・保存
- StoryAI
- ページ骨格生成
- 話全体をページとコマへ反映
- キャラクター作成・編集
- キャラ画像取り込み
- キャラ全身プレビュー生成
- キャラ参照画像の確定・削除
- ページ一覧表示
- ページ画像表示・拡大
- コマ割りテンプレート選択・プレビュー・適用
- コマの追加・削除・並び替え
- コマ内容編集
- ページ画像生成・再生成
- ページ確定・再編集
- PDF / 画像エクスポート
- 残クレジット・現在プラン・ジョブ履歴表示
- 言語切替
- ログアウト
- チュートリアル表示

### 3.2 初期リリースで除外するもの

- App Store / Google Play のアプリ内課金実装
- Stripe Checkout をモバイルアプリ内で直接使う購入UI
- 法人ワークスペースの新規作成・招待・管理UI
- 監査ログ・法人請求ログなど法人専用UI
- 吹き出し単体編集UI
- ページ単体の旧 Autofill UI

法人機能は既存実装と同じく feature flag で隠す。
復活時にすぐ有効化できるよう、APIクライアントと型は残してよいが、通常UIには出さない。

## 4. 推奨技術構成

### 4.1 アプリ基盤

- React Native
- Expo Dev Client
- TypeScript strict
- React Navigation
- TanStack Query
- Zustand または Jotai
- Expo SecureStore
- Expo Image
- Expo Image Picker
- Expo FileSystem
- Expo Sharing

Expo Go だけで完結させようとしない。
Cognito の Deep Link、画像保存、将来のアプリ内課金、ネイティブ共有を考えると、Expo Dev Client / EAS Build 前提が安全である。

### 4.2 状態管理

サーバーデータは TanStack Query で扱う。

- works
- chapters
- episodes
- entities
- reference sets
- scenes
- pages
- panels
- frames
- jobs
- billing balance

UIだけの状態は Zustand/Jotai に置く。

- activeTab
- selectedWorkId
- selectedChapterId
- selectedEpisodeId
- selectedEntityId
- selectedPageId
- selectedPanelId
- uiLanguage
- 展開中セクション
- 進行中ジョブID

認証トークンは SecureStore に保存する。
選択中の作品IDなど機密性の低いUI状態は AsyncStorage / MMKV でよい。

## 5. 環境変数

モバイルアプリ側に必要な設定は以下。

| 名前 | 用途 |
|---|---|
| `API_BASE_URL` | Lyra API のベースURL |
| `COGNITO_DOMAIN` | Cognito Hosted UI のドメイン |
| `COGNITO_CLIENT_ID` | User Pool App Client ID |
| `COGNITO_REDIRECT_URI` | アプリへ戻るリダイレクトURI |
| `COGNITO_LOGOUT_URI` | ログアウト後の戻り先 |
| `COGNITO_SCOPES` | `openid email profile` を基本とする |
| `COGNITO_API_TOKEN_USE` | `id_token`。APIへ `Authorization: Bearer <id_token>` として送る |
| `ORGANIZATION_FEATURES_ENABLED` | 法人UIの表示切替 |

シークレットはモバイルアプリに入れない。
OpenAI、Stripe secret、AWS credential、DB接続情報は絶対にアプリへ含めない。

## 6. 認証設計

### 6.1 基本方針

ログイン・アカウント登録は Cognito Hosted UI に任せる。
アプリ内で独自のメールアドレス・パスワード入力UIを作らない。

表示文言は以下にする。

- 1階層目: `Lyra Japan`
- 2階層目: `Lyra AI漫画エディタ`
- CTA: `ログイン・アカウント登録はこちら`

英語表示時は以下。

- 1階層目: `Lyra Japan`
- 2階層目: `Lyra AI Manga Editor`
- CTA: `Sign in or create an account`

### 6.2 初回表示

起動直後に `start_lyra.jpg` を2秒程度表示し、フェードアウトする。
その後、未ログインなら認証画面、ログイン済みなら制作コンソールへ進む。

### 6.3 OAuth フロー

Authorization Code + PKCE を使う。

1. アプリで `Login` を押す
2. Cognito Hosted UI を外部ブラウザまたは認証セッションで開く
3. ユーザーがログインまたは登録する
4. Cognito が `COGNITO_REDIRECT_URI` に code を返す
5. アプリが code を token に交換する
6. `id_token` / `access_token` / `refresh_token` を保存する
7. APIへは `id_token` を `Authorization: Bearer <id_token>` として送る

### 6.4 招待リンク

法人機能が有効になった後は、招待リンクを以下のように扱う。

1. `https://app.lyra-editor.com/invite/:token` または Universal Link を受け取る
2. 未ログインなら Cognito Hosted UI へ送る
3. ログイン後に招待プレビューAPIで状態確認
4. 有効なら参加APIを呼ぶ
5. ワークスペース一覧を再取得する

初期リリースでは法人機能を隠すため、招待リンクUIも通常導線には出さない。

## 7. APIクライアント設計

### 7.1 共通仕様

すべての認証APIに以下を付ける。

```http
Authorization: Bearer <token>
Content-Type: application/json
```

APIエラーは以下の形として読む。

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "message"
  }
}
```

モバイル側では開発者向けのエラーをそのまま出さず、ユーザーが次に何をすればよいかに変換する。

### 7.2 クエリキー

TanStack Query のキーには必ず認証ユーザーとワークスペース範囲を含める。

例:

```ts
['works', authSessionKey, organizationId ?? 'personal']
['episodes', authSessionKey, chapterId]
['pages', authSessionKey, episodeId]
['panels', authSessionKey, pageId]
['jobs', authSessionKey]
['billing-balance', authSessionKey, organizationId ?? 'personal']
```

これを省くと、ログイン切替や Stripe から戻った後に別ユーザーの古いキャッシュが見える危険がある。

## 8. 主要API契約

### 8.0 セッション

| 操作 | メソッド | パス |
|---|---|---|
| 現在セッション取得 | GET | `/api/me` |

ログイン直後は、作品一覧より先に現在セッションを取得する。
ここで個人クレジットと所属ワークスペースの概略を確認する。

法人機能が無効な間も、このAPIの結果を安全に扱う。
`organizations` が空、またはUIで使わない状態でもエラーにしない。

### 8.1 作品

| 操作 | メソッド | パス |
|---|---|---|
| 作品一覧 | GET | `/api/works?organization_id=...` |
| 作品作成 | POST | `/api/works` |
| 作品更新 | PUT | `/api/works/:id` |

作品作成の最小入力は `title`。
`genre` は任意。
モバイルでは「新しい作品」UIはストーリータブ内にだけ出す。

空文字は `null` または未送信に寄せる。
最大長はバックエンドの zod schema に合わせる。

### 8.2 章・話

| 操作 | メソッド | パス |
|---|---|---|
| 章一覧 | GET | `/api/works/:workId/chapters` |
| 章作成 | POST | `/api/works/:workId/chapters` |
| 章更新 | PUT | `/api/chapters/:id` |
| 章移動 | POST | `/api/chapters/:id/move` |
| 章削除 | DELETE | `/api/chapters/:id` |
| 話一覧 | GET | `/api/chapters/:chapterId/episodes` |
| 話作成 | POST | `/api/chapters/:chapterId/episodes` |
| 話更新 | PUT | `/api/episodes/:id` |
| 話移動 | POST | `/api/episodes/:id/move` |
| 話削除 | DELETE | `/api/episodes/:id` |

モバイルではストーリー入力方式を全体入力に統一する。
保存時は必ず以下を送る。

```json
{
  "story_input_mode": "full",
  "story_full_draft": "本文"
}
```

序盤・中盤・クライマックス・終盤の分割UIは出さない。

### 8.3 StoryAI

| 操作 | メソッド | パス |
|---|---|---|
| StoryAI チャット | POST | `/api/story/collaborate` |
| 話の改善案作成 | POST | `/api/story/improve-episode-draft` |

StoryAI の出力は画面に表示してから、各入力欄へ反映する。
「改善タイトル」「改善された目的」のような個別反映UIはAPI圧迫につながるため、モバイルでは出さない。
全体ストーリーへの反映を主導線にする。

### 8.4 ページ骨格生成

| 操作 | メソッド | パス |
|---|---|---|
| ページ骨格生成 | POST | `/api/episodes/:id/generate-page-skeleton` |

送信例:

```json
{
  "overwrite_existing": true,
  "apply_story_plan": false,
  "language": "ja"
}
```

注意点:

- 実行前に現在の話を保存する
- 既存ページがあってもユーザーが押せるようにする
- 押下直後の表示は「開始しました」
- 完了前に「完了」と表示しない
- 返却された `job_id` をジョブ監視に登録する
- 完了後に pages / panels / frames を再取得する

### 8.5 話全体をページとコマへ反映

| 操作 | メソッド | パス |
|---|---|---|
| 話全体を反映 | POST | `/api/episodes/:id/autofill-pages-from-story` |

送信例:

```json
{
  "language": "ja"
}
```

注意点:

- 実行前に現在の話を保存する
- UIに「この処理は20分程度かかる場合があります」と出す
- 進捗バーは疑似進捗でもよいが、ジョブ完了時に必ず正しい状態へ戻す
- 完了後に pages / panels / frames / jobs を再取得する
- 504 が返っても、ジョブが作られている可能性があるため jobs を再取得する

### 8.6 キャラクター

| 操作 | メソッド | パス |
|---|---|---|
| キャラ一覧 | GET | `/api/works/:workId/entities` |
| キャラ作成 | POST | `/api/works/:workId/entities` |
| キャラ更新 | PUT | `/api/entities/:id` |
| キャラ削除 | DELETE | `/api/entities/:id` |
| 画像取り込み解析 | POST | `/api/entities/import-image` |
| 全身プレビュー生成 | POST | `/api/entities/:id/generate-reference` |
| 参照画像一覧 | GET | `/api/entities/:id/reference-set` |
| 参照画像確定 | POST | `/api/entities/:id/reference/confirm` |
| 参照画像削除 | DELETE | `/api/entities/:id/reference/:refId` |
| 確定参照画像取得 | GET | `/api/entities/:id/reference/:refId/image` |
| 生成候補画像取得 | GET | `/api/entities/:id/reference-candidate-image?candidate_token=...` |

生成前に必ず現在の入力内容を保存する。
保存せずに生成すると、古い入力内容でプレビューが作られる。

参照画像確定では、primary は selected に含める。

```json
{
  "selected_candidate_tokens": ["..."],
  "primary_candidate_token": "..."
}
```

または既存S3画像を使う場合:

```json
{
  "selected_s3_keys": ["..."],
  "primary_s3_key": "..."
}
```

### 8.7 シーン

| 操作 | メソッド | パス |
|---|---|---|
| シーン一覧 | GET | `/api/episodes/:episodeId/scenes` |
| シーン作成 | POST | `/api/episodes/:episodeId/scenes` |
| シーン更新 | PUT | `/api/scenes/:id` |

シーンは任意。
シーンがなくても、ページ骨格生成・話全体反映・ページ生成は拒否しない。

### 8.8 ページ

| 操作 | メソッド | パス |
|---|---|---|
| ページ一覧 | GET | `/api/episodes/:episodeId/pages` |
| ページ設定保存 | PUT | `/api/pages/:id` |
| ページ画像生成 | POST | `/api/pages/:id/generate` |
| ページ確定 | POST | `/api/pages/:id/confirm` |
| 再編集 | POST | `/api/pages/:id/reopen` |
| 画像エクスポート | GET | `/api/pages/:id/export-image` |

ページ生成前に必ず以下を保存する。

- ページ設定
- コマ一覧
- コマ割り
- コマ別登場人物
- コマ別セリフ
- 背景
- 状況
- 構図
- カメラ演出

保存後に `POST /api/pages/:id/generate` を呼ぶ。
再生成も初回生成と同じく「現在の保存済み入力から新規作成」として扱う。前回画像をレファレンスとして渡す前提にしない。

### 8.9 コマ

| 操作 | メソッド | パス |
|---|---|---|
| コマ一覧 | GET | `/api/pages/:pageId/panels` |
| コマ作成 | POST | `/api/pages/:pageId/panels` |
| コマ更新 | PUT | `/api/panels/:id` |
| コマ削除 | DELETE | `/api/panels/:id` |
| コマ並び替え | PUT | `/api/pages/:pageId/panels/order` |
| 登場人物保存 | PUT | `/api/panels/:id/entities` |

コマ作成時、登場人物の保存は別APIである。
作成後に assignments 保存が失敗した場合は、作成済みコマを削除して不整合を残さない。

### 8.10 コマ割り

| 操作 | メソッド | パス |
|---|---|---|
| フレーム一覧 | GET | `/api/pages/:pageId/frames` |
| 旧テンプレート適用 | POST | `/api/pages/:id/frames/apply-template` |
| テンプレート適用 | POST | `/api/pages/:id/layout-template` |
| フレーム直接保存 | PUT | `/api/pages/:id/frames` |

テンプレート適用の送信例:

```json
{
  "template_id": "standard_4",
  "allow_panel_truncation": false
}
```

`allow_panel_truncation` は原則 false。
コマ数が減るテンプレートを選ぶ場合は、先に不要なコマをユーザーに削除させる。

新規実装では `/layout-template` を優先する。
`/frames/apply-template` は既存互換のためにAPIクライアントへ残してよいが、通常UIからは使わない。

### 8.11 ジョブ

| 操作 | メソッド | パス |
|---|---|---|
| ジョブ取得 | GET | `/api/jobs/:id` |

ジョブ種別:

- `page_generate`
- `entity_generate`
- `episode_story_autofill`
- `episode_page_skeleton`

状態:

- `queued`
- `processing`
- `completed`
- `failed`

処理中UIでは、ユーザーに待つ必要があることを明示する。
特に画像生成・骨格生成・話全体反映は数分から20分程度かかる場合がある。

### 8.12 残クレジット

| 操作 | メソッド | パス |
|---|---|---|
| 残クレジット取得 | GET | `/api/billing/balance` |

表示対象:

- 現在のプラン
- 月額クレジット
- 追加購入クレジット
- 合計クレジット
- 月額クレジットの期限

モバイルアプリ内課金は本書の範囲外。
購入ボタンを置く場合は、初期リリースでは「モバイル課金は準備中」または Web への案内に留める。

## 9. データ型の要点

### 9.1 Work

モバイルで主に扱う項目:

- `title`
- `genre`
- `world_setting`
- `theme`
- `overall_flow`
- `starting_point`
- `ending_point`
- `status`

概要系は任意。
必須に見えないよう、最初は目立たない折りたたみUIにする。

### 9.2 Episode

モバイルで主に扱う項目:

- `title`
- `story_input_mode`
- `story_full_draft`
- `estimated_pages`
- `status`

`introduction` / `middle` / `climax` / `ending_hook` は既存API上は残るが、モバイルUIでは使わない。

### 9.3 Entity

基本:

- `entity_type`
- `name`
- `free_description`
- `structured_fields`
- `prompt_supplement`
- `speech_profile`
- `status`

キャラクターの `structured_fields` は、31章の選択肢と以下の代表項目を使う。

代表項目:

- 性別表現
- 年齢帯
- 肌色
- 第一印象
- 立ち姿
- 標準表情
- 身長
- 体格
- 顔型
- 眉
- 鼻
- 口
- 髪色
- 髪の長さ
- 髪型
- 前髪
- 横髪
- 後ろ髪
- 目の色
- 目の形
- まぶた
- 瞳の特徴
- 服カテゴリ
- 服の色
- 服の印象
- 襟
- 袖
- ボトムス
- 靴
- レッグウェア
- 別名・通称
- 視覚アンカー
- 特徴
- シルエットの要点
- 見分けポイント
- 頭身
- 肩幅
- 脚の長さ
- 姿勢の軸

すべてを必須にしない。
画面上に「すべての空欄を埋める必要はありません」と表示する。

### 9.4 Page

主な項目:

- `page_number`
- `layout_config`
- `story_source_scene_ids`
- `story_page_purpose`
- `story_continuity_note`
- `dialogue_mode`
- `page_dialogue_toggle`
- `generated_image`
- `status`
- `panel_count`
- `frame_count`

モバイルではページ全体のセリフ設定UIは出さない。
画風制約はページ生成品質に影響するため、初期状態で展開する。

### 9.5 Panel

主な項目:

- `order`
- `panel_role`
- `panel_size`
- `situation_text`
- `composition`
- `entities`
- `dialogue`
- `sfx_text`
- `background_note`
- `panel_notes`

ページ生成で特に重要な項目:

- 状況
- 背景
- 登場人物
- 構図メモ
- ショット
- アングル
- 全体構図メモ
- カメラ・演出メモ
- セリフ

`situation_text` と `background_note` は画像生成への強制を強めているため、モバイルUIでも省略しない。

### 9.6 モバイル実装で使う主要型

この章の型を、モバイル実装側の `domain/types.ts` にそのまま置く。
別リポジトリ・別担当者が実装する場合でも、Web版の型ファイルを見に行かなくてよい。

```ts
export type UiLanguage = 'ja' | 'en';
export type StoryStatus = 'draft' | 'published' | 'archived';
export type EntityType = 'character' | 'nonhuman' | 'object';
export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';

export type WorkRecord = {
  id: string;
  title: string;
  genre: string | null;
  theme: string | null;
  world: string | null;
  overall_flow: string | null;
  starting_point: string | null;
  ending_point: string | null;
  status: StoryStatus;
  created_at: string;
  updated_at: string;
};

export type ChapterRecord = {
  id: string;
  work_id: string;
  title: string;
  order_index: number;
  status: StoryStatus;
  created_at: string;
  updated_at: string;
};

export type EpisodeRecord = {
  id: string;
  chapter_id: string;
  title: string;
  order_index: number;
  status: StoryStatus;
  estimated_pages: number | null;
  story_input_mode: 'full';
  story_full_draft: string | null;
  introduction: string | null;
  middle: string | null;
  climax: string | null;
  ending_hook: string | null;
  created_at: string;
  updated_at: string;
};

export type EntityRecord = {
  id: string;
  work_id: string;
  entity_type: EntityType;
  name: string;
  free_description: string | null;
  structured_fields: Record<string, unknown>;
  prompt_supplement: string | null;
  speech_profile: string | null;
  status: StoryStatus;
  reference_set?: EntityReferenceSetRecord | null;
  created_at: string;
  updated_at: string;
};

export type EntityReferenceImage = {
  id: string;
  s3_key: string;
  image_url?: string | null;
  label?: string | null;
  is_primary?: boolean;
  created_at?: string;
};

export type EntityReferenceSetRecord = {
  entity_id: string;
  primary_s3_key: string | null;
  selected_s3_keys: string[];
  images: EntityReferenceImage[];
  updated_at: string;
};

export type SceneRecord = {
  id: string;
  episode_id: string;
  order_index: number;
  location: string | null;
  time: string | null;
  mood: string | null;
  description: string | null;
};

export type PageRecord = {
  id: string;
  episode_id: string;
  page_number: number;
  panel_count: number;
  frame_count: number;
  layout_config: Record<string, unknown>;
  story_source_scene_ids: string[];
  story_page_purpose: string | null;
  story_continuity_note: string | null;
  dialogue_mode: 'burned_in' | 'balloon' | 'none' | null;
  page_dialogue_toggle: boolean | null;
  generated_image_url?: string | null;
  thumbnail_url?: string | null;
  status: StoryStatus;
  panels?: PanelRecord[];
  frames?: PanelFrameRecord[];
  created_at: string;
  updated_at: string;
};

export type PanelComposition = {
  source?: 'ai' | 'gallery' | 'custom' | null;
  shot_type?: string | null;
  angle?: string | null;
  composition_prompt?: string | null;
  camera_note?: string | null;
  custom_note?: string | null;
};

export type PanelDialogueLine = {
  type: 'speech' | 'thought' | 'narration' | 'sfx' | 'shout' | 'whisper';
  text: string;
  entity_id: string | null;
  placement?: 'top' | 'bottom' | 'left' | 'right' | 'center' | null;
};

export type PanelEntityAssignment = {
  entity_id: string;
  role: 'primary' | 'secondary' | 'background';
  expression?: string | null;
  custom_expression?: string | null;
  action?: string | null;
  custom_action?: string | null;
  position?: 'left' | 'center' | 'right' | 'background' | null;
  facing_direction?: 'front' | 'left' | 'right' | 'away' | 'three_quarter_left' | 'three_quarter_right' | null;
  effect_note?: string | null;
  state_id?: string | null;
};

export type PanelRecord = {
  id: string;
  page_id: string;
  order: number;
  panel_role: string | null;
  panel_size: string | null;
  situation_text: string | null;
  composition: PanelComposition;
  entities: PanelEntityAssignment[];
  dialogue: PanelDialogueLine[];
  sfx_text: string | null;
  background_note: string | null;
  panel_notes: string | null;
  created_at: string;
  updated_at: string;
};

export type PanelFrameRecord = {
  id?: string;
  panel_id?: string | null;
  vertices: Array<{ x: number; y: number }>;
  reading_order: number;
  border_style?: 'solid' | 'dashed' | 'none';
  border_width?: number;
  border_color?: string;
  z_index?: number;
};

export type GenerationJobRecord = {
  id: string;
  type: 'page_generate' | 'entity_generate' | 'episode_page_skeleton' | 'episode_story_autofill';
  status: JobStatus;
  related_id?: string | null;
  progress?: number | null;
  message?: string | null;
  error_message?: string | null;
  created_at: string;
  updated_at: string;
};

export type BillingBalanceRecord = {
  plan: 'free' | 'standard' | 'premium' | 'enterprise_a' | 'enterprise_b' | 'enterprise_c';
  monthly_credits: number;
  purchased_credits: number;
  total_credits: number;
  current_period_end?: string | null;
};

export type CurrentSessionRecord = {
  user: {
    id: string;
    email: string;
    language: UiLanguage;
  };
  billing: BillingBalanceRecord;
  organization_features_enabled: boolean;
  organizations?: Array<{
    id: string;
    name: string;
    role: 'owner' | 'admin' | 'member' | 'viewer';
  }>;
};

export type StoryEpisodeImprovementRecord = {
  improved_title?: string | null;
  improved_story_full_draft: string;
  notes?: string | null;
};
```

## 10. モバイル画面構成

### 10.1 下部タブ

モバイルは下部タブを使う。

1. ストーリー
2. キャラクター
3. ページ
4. アカウント
5. ガイド

PC版の右側UIにあった以下はアカウントタブに移す。

- 残クレジット
- 現在プラン
- ジョブ履歴
- 言語切替
- ログアウト

チュートリアルはガイドタブに分ける。
ユーザーが制作画面を見ながら確認できるよう、ガイドタブは常に開ける位置に置く。

### 10.2 ストーリータブ

表示順:

1. 新しい作品
2. 作品一覧
3. 現在の作品
4. 作品の概要
5. 章と話
6. 現在の話
7. ストーリーAI
8. シーン

#### 新しい作品

作品がない場合は展開したままにする。
作品が選択済みの場合はコンパクトに折りたたんでよい。

入力:

- タイトル
- ジャンル

CTA:

- 作成

#### 作品の概要

必須に見えないように控えめにする。
初期状態は折りたたみでよい。

入力:

- タイトル
- ジャンル
- テーマ
- 世界観
- 全体の流れ
- 開始地点
- 終着点

#### 章と話

初期状態で展開する。
ユーザーが何から始めるべきか迷わないようにする。

機能:

- 章追加
- 話追加
- 章の移動
- 話の移動
- 章削除
- 話削除
- ページ骨格生成
- 話全体を反映

`ページ骨格生成` と `話全体を反映` は黄色系の主要ボタンにする。

#### 現在の話

初期状態で展開する。

入力:

- 話タイトル
- 想定ページ数
- ストーリー本文

ストーリー入力は全体入力のみ。
分割入力UIは出さない。

#### シーン

任意入力として表示する。
「より場所・時間・雰囲気を指定したい場合に使う」程度の扱いにする。

シーンが空でも生成はできる。

### 10.3 キャラクタータブ

表示順:

1. キャラ一覧
2. キャラ基本情報
3. 再現アンカー
4. 詳細特徴
5. 取り込みレファレンス
6. プレビュー・確定

#### キャラ一覧

横スクロールのチップまたはカードにする。
新規キャラを作るとき、既存キャラが選択されたまま上書きされないよう、作成モードと編集モードを明確に分ける。

#### キャラ基本情報

入力:

- 名前
- 種別
- 自由説明
- 話し方メモ

種別:

- キャラクター
- 人外
- 物体

#### 再現アンカー

初期状態は折りたたみでもよい。
ただし保存ボタンは目立たせる。

入力:

- 別名・通称
- 視覚アンカー
- 特徴
- シルエットの要点
- 見分けポイント
- 頭身
- 肩幅
- 脚の長さ
- 姿勢の軸

選択肢にない場合はカスタム入力を許可する。

#### 取り込みレファレンス

初期状態で展開する。

機能:

- 画像選択
- 画像解析
- 取り込み画像を候補として表示

#### プレビュー・確定

初期状態で展開する。

機能:

- 全身プレビュー生成
- プレビュー候補表示
- 確定済み参照画像表示
- 参照画像削除
- 画像拡大

プレビュー画像と確定画像は同じサイズにする。
横幅が足りる場合は横並び、狭い場合は横スクロールにする。
画像タップでは削除しない。削除は必ず削除ボタンだけで行う。

### 10.4 ページタブ

表示順:

1. 現在の話の選択
2. ページ一覧
3. 選択ページの画像
4. 画風制約
5. 話の材料
6. ページ生成
7. コマ割り
8. コマ一覧
9. コマ編集
10. エクスポート

#### 現在の話の選択

初期状態で展開する。
選択中の作品・章・話が分かるようにする。

#### ページ一覧

横スクロールのカードにする。
ページ画像は軽量サムネイルを優先し、選択中ページだけ高解像度を先読みする。

#### 選択ページの画像

画像枠は先に固定する。
読み込み中はプレースホルダーを表示する。
タップで拡大モーダルを開き、外側タップまたは閉じるボタンで戻る。

#### 画風制約

初期状態で展開する。

入力:

- 画風制約の作品名
- 画風制約メモ

これはセリフ設定とは独立したUIにする。

#### セリフ設定

ページ全体のセリフ設定UIは出さない。
現在の方針ではコマ単位のセリフ編集を使う。

#### コマ割り

テンプレート選択、プレビュー、適用を置く。

プレビューは常時表示しない。
`プレビュー` ボタンでモーダルを開く。

読み順は漫画向けに、右から左、上から下にする。
プレビュー画像と実際の frame vertices は一致させる。

#### コマ一覧

カードには以下を表示する。

- コマ番号
- 役割
- 登場人物
- 状況の短い要約
- 上へ
- 下へ
- 削除

文字が `e...` のように極端に省略されないよう、最低幅を確保する。
削除するコマを明示できるよう、各コマカードに削除ボタンを置く。

#### コマ編集

入力:

- 順番
- 役割
- サイズ
- 状況
- 構図メモ
- ショット
- アングル
- 背景
- 効果音
- 全体構図メモ
- カメラ・演出メモ
- 補足
- 登場人物
- セリフ

登場人物とセリフは、誰が何を話すかが分かるUIにする。

#### エクスポート

形式:

- PDF
- 画像

保存対象:

- 選択ページ
- 複数ページ
- 全ページ

画像形式で複数枚保存する場合以外は、ファイル名指定を出す。

### 10.5 アカウントタブ

表示内容:

- ログイン中メールアドレス
- 現在プラン
- 残クレジット
- 月額クレジット
- 追加購入クレジット
- ジョブ履歴
- 言語切替
- ログアウト

ジョブ履歴は直近5件を基本表示にする。
詳細は必要なときだけ展開する。

法人機能が無効な場合は以下の表示だけにする。

`法人機能は近日追加予定です`

### 10.6 ガイドタブ

チュートリアルは折りたたみ不可にする。
色は黒背景に埋もれないよう、黄色/金系のアクセントを使う。

文章量は増やしすぎない。
ただし初見ユーザーが作業順序を理解できる最低限の内容は入れる。

## 11. コマ割りテンプレート

モバイルはバックエンドのテンプレートIDをそのまま使う。
独自IDを作らない。

現在使うテンプレート:

| ID | 用途 |
|---|---|
| `splash_1` | 1コマ大ゴマ |
| `climax_2` | 2コマ左右 |
| `vertical_2` | 2コマ上下 |
| `top_wide_3` | 上に横長、下に2コマ |
| `bottom_wide_3` | 上に2コマ、下に横長 |
| `standard_4` | 2行2列。漫画読み順で右上、左上、右下、左下 |
| `stacked_wide_4` | 横長4コマを縦に並べる |
| `wide_top_4` | 上に横長、下に3コマ |
| `wide_bottom_4` | 上に3コマ、下に横長 |
| `tall_left_4` | 左に縦長、右に3コマ |
| `right_tall_4` | 右に縦長、左に3コマ |
| `action_5` | 動きのある5コマ |
| `balanced_5` | 上2コマ、下3コマ |
| `middle_wide_5` | 中段に横長を置く5コマ |
| `top_wide_5` | 上に横長、下に4コマ |
| `standard_6` | 6コマ標準 |
| `split_6` | 左右に3段ずつ |
| `battle_7` | 7コマ戦闘向け |
| `dense_8` | 8コマ密度高め |

### 11.1 コマ数からの初期テンプレート

コマ数変更時にテンプレート未選択の場合は以下を使う。

```ts
export const DEFAULT_PANEL_FRAME_TEMPLATE_BY_COUNT = {
  1: 'splash_1',
  2: 'climax_2',
  3: 'top_wide_3',
  4: 'standard_4',
  5: 'action_5',
  6: 'standard_6',
  7: 'battle_7',
  8: 'dense_8',
} as const;
```

### 11.2 コマ割り座標定義

座標はページ左上を `{ x: 0, y: 0 }`、右下を `{ x: 1, y: 1 }` とする。
矩形は `rect(x1, y1, x2, y2)`、台形や斜めコマは `quad(a, b, c, d)` と書く。
実装時はすべて `vertices: [{x,y}, ...]` に変換する。

漫画の読み順は、右から左、上から下である。
下記の `reading_order` はその読み順に合わせた確定値として扱う。

| ID | reading_order と座標 |
|---|---|
| `splash_1` | 1: rect(0, 0, 1, 1) |
| `climax_2` | 1: rect(0.5, 0, 1, 1), 2: rect(0, 0, 0.5, 1) |
| `vertical_2` | 1: rect(0, 0, 1, 0.48), 2: rect(0, 0.48, 1, 1) |
| `top_wide_3` | 1: rect(0, 0, 1, 0.5), 2: rect(0.5, 0.5, 1, 1), 3: rect(0, 0.5, 0.5, 1) |
| `bottom_wide_3` | 1: rect(0.5, 0, 1, 0.5), 2: rect(0, 0, 0.5, 0.5), 3: rect(0, 0.5, 1, 1) |
| `standard_4` | 1: rect(0.5, 0, 1, 0.5), 2: rect(0, 0, 0.5, 0.5), 3: rect(0.5, 0.5, 1, 1), 4: rect(0, 0.5, 0.5, 1) |
| `stacked_wide_4` | 1: rect(0, 0, 1, 0.25), 2: rect(0, 0.25, 1, 0.5), 3: rect(0, 0.5, 1, 0.75), 4: rect(0, 0.75, 1, 1) |
| `wide_top_4` | 1: rect(0, 0, 1, 0.42), 2: rect(0.6667, 0.42, 1, 1), 3: rect(0.3333, 0.42, 0.6667, 1), 4: rect(0, 0.42, 0.3333, 1) |
| `wide_bottom_4` | 1: rect(0.6667, 0, 1, 0.58), 2: rect(0.3333, 0, 0.6667, 0.58), 3: rect(0, 0, 0.3333, 0.58), 4: rect(0, 0.58, 1, 1) |
| `tall_left_4` | 1: rect(0.42, 0, 1, 0.3333), 2: rect(0.42, 0.3333, 1, 0.6667), 3: rect(0.42, 0.6667, 1, 1), 4: rect(0, 0, 0.42, 1) |
| `right_tall_4` | 1: rect(0.58, 0, 1, 1), 2: rect(0, 0, 0.58, 0.3333), 3: rect(0, 0.3333, 0.58, 0.6667), 4: rect(0, 0.6667, 0.58, 1) |
| `action_5` | 1: rect(0.35, 0, 1, 0.32), 2: rect(0.675, 0.32, 1, 0.66), 3: rect(0.35, 0.32, 0.675, 0.66), 4: rect(0.35, 0.66, 1, 1), 5: rect(0, 0, 0.35, 1) |
| `balanced_5` | 1: rect(0.5, 0, 1, 0.44), 2: rect(0, 0, 0.5, 0.44), 3: rect(0.6667, 0.44, 1, 1), 4: rect(0.3333, 0.44, 0.6667, 1), 5: rect(0, 0.44, 0.3333, 1) |
| `middle_wide_5` | 1: rect(0.5, 0, 1, 0.3), 2: rect(0, 0, 0.5, 0.3), 3: rect(0, 0.3, 1, 0.68), 4: rect(0.5, 0.68, 1, 1), 5: rect(0, 0.68, 0.5, 1) |
| `top_wide_5` | 1: rect(0, 0, 1, 0.34), 2: rect(0.5, 0.34, 1, 0.67), 3: rect(0, 0.34, 0.5, 0.67), 4: rect(0.5, 0.67, 1, 1), 5: rect(0, 0.67, 0.5, 1) |
| `standard_6` | 1: rect(0.6667, 0, 1, 0.5), 2: rect(0.3333, 0, 0.6667, 0.5), 3: rect(0, 0, 0.3333, 0.5), 4: rect(0.6667, 0.5, 1, 1), 5: rect(0.3333, 0.5, 0.6667, 1), 6: rect(0, 0.5, 0.3333, 1) |
| `split_6` | 1: rect(0.48, 0, 1, 0.3333), 2: rect(0.48, 0.3333, 1, 0.6667), 3: rect(0.48, 0.6667, 1, 1), 4: rect(0, 0, 0.48, 0.3333), 5: rect(0, 0.3333, 0.48, 0.6667), 6: rect(0, 0.6667, 0.48, 1) |
| `battle_7` | 1: quad({x:0.7,y:0},{x:1,y:0},{x:1,y:0.28},{x:0.63,y:0.32}), 2: quad({x:0.35,y:0},{x:0.7,y:0},{x:0.63,y:0.32},{x:0.28,y:0.32}), 3: quad({x:0,y:0},{x:0.35,y:0},{x:0.28,y:0.32},{x:0,y:0.28}), 4: quad({x:0.63,y:0.32},{x:1,y:0.28},{x:1,y:0.66},{x:0.56,y:0.68}), 5: quad({x:0,y:0.28},{x:0.63,y:0.32},{x:0.56,y:0.68},{x:0,y:0.66}), 6: quad({x:0.5,y:0.68},{x:1,y:0.66},{x:1,y:1},{x:0.5,y:1}), 7: quad({x:0,y:0.66},{x:0.5,y:0.68},{x:0.5,y:1},{x:0,y:1}) |
| `dense_8` | 1: rect(0.75, 0, 1, 0.5), 2: rect(0.5, 0, 0.75, 0.5), 3: rect(0.25, 0, 0.5, 0.5), 4: rect(0, 0, 0.25, 0.5), 5: rect(0.75, 0.5, 1, 1), 6: rect(0.5, 0.5, 0.75, 1), 7: rect(0.25, 0.5, 0.5, 1), 8: rect(0, 0.5, 0.25, 1) |

プレビューはこの座標定義に合わせる。
UIの見た目だけで別レイアウトを描かない。

## 12. 選択肢

モバイル側は本章と31章の選択肢を使う。
最低限、以下は一致させる。

### 12.1 コマ

役割:

- 導入
- アクション
- 反応
- 強調
- つなぎ
- 間
- 衝撃

サイズ:

- 標準
- 大きい
- 広い
- 狭い
- 見開き風

構図ソース:

- AI自動
- ギャラリー
- カスタム

ショット:

- 未指定
- 全身
- 上半身
- 顔アップ
- 広角
- 超アップ

アングル:

- 未指定
- 正面
- 横
- 斜め
- 俯瞰
- あおり
- ダッチアングル

登場人物の役割:

- 主
- 副
- 背景

位置:

- 左
- 中央
- 右
- 背景

向き:

- 未指定
- 正面
- 左
- 右
- 後ろ
- 左斜め
- 右斜め

表情:

- 決意
- 落ち着き
- 怒り
- 悲しみ
- 驚き
- カスタム

動作:

- 踏みとどまる
- 攻撃
- 防御
- 走る
- カスタム

セリフ種別:

- セリフ
- 心の声
- ナレーション
- 叫び
- ささやき

セリフ位置:

- 上
- 下
- 左
- 右
- 中央

### 12.2 キャラクター

キャラクター編集は、選択肢 + カスタム入力を基本にする。
選択肢がないせいで入力できない状態を作らない。

重要項目:

- 性別表現
- 年齢帯
- 肌色
- 身長
- 体格
- 髪色
- 髪の長さ
- 髪型
- 目の色
- 目の形
- 服カテゴリ
- 服の色
- 画風
- 再現アンカー
- 見分けポイント

男性向けの髪型・体格・服装も不足しないよう選択肢を用意する。

## 13. 保存と生成の順序

### 13.1 ページ骨格生成

1. 現在の作品・章・話を確認
2. 現在の話を保存
3. `generate-page-skeleton` を呼ぶ
4. job_id を保存
5. UIに「ページ骨格生成を開始しました」を表示
6. ジョブ監視
7. 完了後 pages / panels / frames を再取得

### 13.2 話全体を反映

1. 現在の話を保存
2. `autofill-pages-from-story` を呼ぶ
3. job_id を保存
4. UIに「この処理は20分程度かかる場合があります」を表示
5. 進捗バーを表示
6. 完了後 pages / panels / frames を再取得

### 13.3 キャラプレビュー生成

1. 現在のキャラ入力を保存
2. 取り込み画像があれば source を確認
3. `generate-reference` を呼ぶ
4. job_id を保存
5. 完了後 reference-set を再取得

### 13.4 ページ画像生成

1. 現在のページ設定を保存
2. 現在のコマ入力を保存
3. コマ別登場人物を保存
4. コマ別セリフを保存
5. frame_count と panel_count の一致を確認
6. `generate` を呼ぶ
7. job_id を保存
8. 完了後 page / jobs / balance を再取得

## 14. ジョブ進捗UI

画像生成や StoryAI 系の処理は時間がかかる。
モバイルでは必ず進捗表示を出す。

表示例:

- `処理を開始しました`
- `待機中です`
- `生成中です。この処理は時間がかかります`
- `話全体を反映中です。この処理は20分程度かかる場合があります`
- `完了しました`
- `失敗しました。入力内容を保存し、少し待ってからもう一度お試しください`

疑似進捗バーのルール:

- queued: 5%からゆっくり進める
- processing: 20%から85%まで進める
- completed: 100%
- failed: エラー表示

本当の進捗ではない場合、バーの近くに「処理状況を確認しています」と表示する。

## 15. エラーメッセージ

ユーザーに出す文言は、修正行動が分かるものにする。

| 状況 | 表示 |
|---|---|
| 401 | `ログインの有効期限が切れました。もう一度ログインしてください。` |
| 402 | `クレジットが不足しています。残クレジットを確認してください。` |
| 403 | `この操作を行う権限がありません。` |
| 404 | `対象のデータが見つかりません。画面を再読み込みしてください。` |
| 409 | `生成処理がすでに待機中または実行中です。現在の処理が終わってからもう一度お試しください。` |
| 422 | `入力内容に問題があります。赤く表示された項目を確認してください。` |
| 429 | `短時間に操作が集中しています。少し待ってからもう一度お試しください。` |
| 504 | `処理に時間がかかっています。ジョブ履歴で完了状況を確認してください。` |
| network | `通信に失敗しました。接続状況を確認して、もう一度お試しください。` |

内部エラーの詳細、JSON parse error、スタックトレース、AWS ARN などは表示しない。

## 16. 画像表示

ページ画像・キャラ画像は重い。
以下を必須にする。

- 一覧はサムネイル優先
- 選択中だけ高解像度を先読み
- 画像枠は固定サイズ
- 読み込み中プレースホルダー
- タップ拡大
- 拡大画面は閉じるボタンと外側タップで閉じる
- キャッシュを使う
- メモリ不足を避けるため、画面外の高解像度画像を保持しすぎない

## 17. 言語切替

対応言語:

- 日本語
- English

言語切替はアカウントタブに置く。
選択中の言語は以下に影響する。

- UI文言
- StoryAI
- ページ骨格生成
- 話全体反映
- 自動入力

保存済み本文を勝手に翻訳しない。
あくまで今後のAI出力とUI表示の言語を切り替える。

## 18. 法人機能

初期リリースでは法人機能を無効にする。

表示:

`法人機能は近日追加予定です`

ただし、将来復活させるために以下の設計は残す。

- APIクライアントの organization 系メソッド
- `organization_id` を受け取れる query key
- 個人/法人の workspace scope
- 法人有効時だけ表示される Account 内の法人管理UI

feature flag:

```ts
ORGANIZATION_FEATURES_ENABLED === true
```

この値が false の間は、会社作成・招待・法人プラン購入を一切表示しない。

## 19. 決済

本書ではアプリ内課金の実装を扱わない。

初期モバイル版で行うこと:

- 現在プランを表示
- 残クレジットを表示
- 月額クレジットと追加購入クレジットを表示
- クレジット不足時に分かりやすく案内

初期モバイル版で行わないこと:

- Stripe Checkout を WebView で直接開く購入導線
- App Store / Google Play 課金
- サブスク変更
- サブスク解約

将来的には、App Store / Google Play のアプリ内課金をバックエンドの credit ledger と連携する。

## 8.13 organization_id の扱い

既存APIは、多くのエンドポイントで `organization_id` クエリを受け取れる。
モバイル初期リリースでは法人機能を無効にするため、通常は送らない。

個人範囲:

```ts
organizationId = null
```

法人機能を復活させる場合:

```ts
organizationId = selectedOrganizationId
```

この分岐は API client の共通関数に閉じ込める。
各画面が自前で `?organization_id=` を組み立てない。

## 20. セキュリティ

モバイルで守るべきこと:

- シークレットをアプリに含めない
- 認証トークンは SecureStore に保存する
- APIは必ず Bearer token を付ける
- 画像ファイルは端末側でサイズと形式を確認する
- アップロード前に巨大ファイルを弾く
- 他ユーザーのキャッシュを表示しない
- ログアウト時に token と query cache を消す
- 開発用API URLを本番ビルドに混ぜない

## 21. パフォーマンス

優先順位:

1. 失敗しないこと
2. 入力内容が消えないこと
3. 進行中であることが分かること
4. 表示が速いこと

実装方針:

- 入力は画面離脱前に保存確認
- 生成系は押下直後にジョブ状態へ移す
- 画像は遅延読み込み
- 画面遷移時に必要なデータだけ取得
- 長いフォームはタブ・セクションで分割
- ScrollView に巨大リストを直置きしない

## 22. 画面別の破綻防止チェック

### 22.1 ストーリー

- 作品未作成時に次の導線が分かる
- 章と話が初期表示される
- ストーリー入力が全体入力だけになっている
- ページ骨格生成後に「完了」と誤表示しない
- 話全体反映の進捗が見える
- シーンが空でも生成が進む

### 22.2 キャラクター

- 新規キャラ作成で既存キャラを上書きしない
- 保存前の入力でプレビュー生成しない
- 取り込み画像と生成プレビューが混ざって見えない
- 確定画像をタップしても削除されない
- 削除は削除ボタンだけ
- 空欄を全部埋める必要がないことが分かる

### 22.3 ページ

- ページ画像が遅れても枠が崩れない
- コマ数とフレーム数が一致しない場合に生成しない
- テンプレート変更で勝手にコマを消さない
- 消すコマをユーザーが選べる
- コマ順が漫画読み順になっている
- プレビューと実際のコマ割りが一致する
- 状況と背景が保存され、生成に渡る
- 登場人物とセリフの対応が分かる

### 22.4 アカウント

- 残クレジットが見える
- 現在プランが見える
- ジョブ履歴が見える
- 言語切替が見える
- ログアウトできる
- 法人機能無効時に法人操作が出ない

## 23. Web版との差分監査

| 項目 | Web版 | モバイル設計 |
|---|---|---|
| 認証 | Cognito Hosted UI | 同じ |
| 作品 | API同一 | 同じ |
| ストーリー入力 | 現在は全体入力中心 | 全体入力のみ |
| 分割入力 | API上は残る | UIでは出さない |
| StoryAI | あり | 同じAPIで実装 |
| ページ骨格生成 | 非同期ジョブ | 同じ |
| 話全体反映 | 非同期ジョブ | 同じ |
| シーン | 任意 | 任意 |
| キャラ編集 | GUI中心 | GUI中心 |
| 画像取り込み | あり | OS画像選択で実装 |
| 参照画像確定 | あり | 同じ |
| ページ生成 | あり | 同じ |
| 再生成 | 現在入力から新規作成 | 同じ |
| コマ割り | テンプレート式 | 同じIDを使う |
| コマ順 | 漫画読み順 | 同じ |
| 吹き出し単体UI | 非表示方針 | 非表示 |
| ページ全体セリフ設定 | 非表示方針 | 非表示 |
| 画風制約 | 独立UI | 独立UI |
| エクスポート | PDF/画像 | 共有/保存APIに接続 |
| 課金購入 | Stripe | モバイルでは別途 |
| 残クレジット | 表示 | 表示 |
| 法人機能 | feature flag | feature flag |

差分として許容するのは、モバイルOSに合わせたUI配置と課金方式だけである。
保存データ、API、生成パイプライン、生成前保存順序は本設計書の定義に従う。

## 24. 実装順序

### Phase 1: 土台

1. React Native / Expo プロジェクト作成
2. TypeScript strict 設定
3. API client 作成
4. Cognito Hosted UI 認証
5. SecureStore token 保存
6. 下部タブ作成

### Phase 2: 読み取り系

1. 作品一覧
2. 章一覧
3. 話一覧
4. キャラ一覧
5. ページ一覧
6. 残クレジット
7. ジョブ履歴

### Phase 3: ストーリー編集

1. 作品作成
2. 作品更新
3. 章追加・編集・移動
4. 話追加・編集・移動
5. 全体ストーリー保存
6. StoryAI
7. ページ骨格生成
8. 話全体反映

### Phase 4: キャラクター

1. キャラ作成・保存
2. GUI入力
3. 画像取り込み
4. プレビュー生成
5. 確定
6. 削除
7. 拡大表示

### Phase 5: ページ

1. ページ画像表示
2. 画風制約
3. コマ割りテンプレート
4. コマ割りプレビュー
5. コマ追加・削除・並び替え
6. コマ編集
7. ページ画像生成
8. 確定・再編集
9. エクスポート

### Phase 6: 仕上げ

1. 日本語/英語切替
2. エラー文言
3. チュートリアル
4. 画像表示最適化
5. 実機確認

## 25. テスト計画

### 25.1 単体テスト

- API client が正しいパスを呼ぶ
- エラー変換が正しい
- 空文字が null / undefined に変換される
- query key に authSessionKey が含まれる
- コマ割りプレビューがテンプレート座標と一致する
- ジョブ状態から表示文言が決まる

### 25.2 結合テスト

- ログイン後に作品一覧が読める
- 作品作成後に一覧へ出る
- 話保存後に再読み込みして維持される
- ページ骨格生成で job_id を受け取る
- 話全体反映で job_id を受け取る
- キャラ保存後にプレビュー生成できる
- 参照画像を確定できる
- コマ編集後にページ生成できる

### 25.3 実機確認

iPhone と Android で確認する。

確認項目:

- ログイン・登録
- ログアウト
- 日本語入力
- 長文ストーリー入力
- 画像選択
- 画像拡大
- ページ画像表示
- ジョブ進捗
- キーボード表示時のボタン隠れ
- 下部タブ操作
- 文字化けなし

## 26. 完了条件

- 本設計書に定義したAPIで主要制作フローが動く
- 作品作成からページ生成まで一通り可能
- キャラ参照画像を使ってページ生成できる
- ストーリー本文からページ・コマへ反映できる
- コマ割り変更・プレビュー・コマ削除ができる
- PDF/画像エクスポートができる
- 残クレジットとジョブ状態が見える
- 日本語UIに文字化けがない
- 法人機能が無効時に誤って操作できない
- 課金購入が未実装であることがUI上で誤解されない

## 27. 実装ブループリント

この章は、実装者が迷わずファイルを作れるようにするための具体設計である。
新規モバイルフロントは、少なくとも以下の構成で作る。

```text
mobile/
  app.json
  package.json
  tsconfig.json
  src/
    app/
      AppRoot.tsx
      navigation/
        RootNavigator.tsx
        BottomTabs.tsx
        AuthStack.tsx
        InviteStack.tsx
    auth/
      cognitoConfig.ts
      authService.ts
      tokenStore.ts
      useAuthSession.ts
    api/
      LyraApiClient.ts
      apiError.ts
      queryKeys.ts
      payloads.ts
    domain/
      types.ts
      options.ts
      frameTemplates.ts
      limits.ts
    state/
      useWorkspaceSelectionStore.ts
      useUiPreferenceStore.ts
      useTrackedJobsStore.ts
    screens/
      AuthScreen.tsx
      InviteScreen.tsx
      StoryScreen.tsx
      EntityScreen.tsx
      PagesScreen.tsx
      AccountScreen.tsx
      GuideScreen.tsx
    features/
      story/
        WorkCreateCard.tsx
        WorkOverviewCard.tsx
        ChapterEpisodePanel.tsx
        EpisodeEditor.tsx
        StoryAiPanel.tsx
        ScenePanel.tsx
      entity/
        EntityList.tsx
        EntityBasicForm.tsx
        CharacterStructuredForm.tsx
        ImportReferencePanel.tsx
        ReferencePreviewPanel.tsx
      pages/
        EpisodeSelector.tsx
        PageList.tsx
        PageImageViewer.tsx
        StyleReferencePanel.tsx
        StorySourcePanel.tsx
        PageGeneratePanel.tsx
        FrameTemplatePanel.tsx
        PanelList.tsx
        PanelEditor.tsx
        ExportPanel.tsx
      account/
        CreditSummary.tsx
        JobList.tsx
        LanguageSelector.tsx
        LogoutButton.tsx
      guide/
        TutorialContent.tsx
    components/
      AppButton.tsx
      AppCard.tsx
      AppTextInput.tsx
      AppSelect.tsx
      CollapsibleSection.tsx
      ProgressNotice.tsx
      ImageLightbox.tsx
      ConfirmDialog.tsx
      ErrorBanner.tsx
```

`domain/types.ts` は9.6の型定義を使う。
型名は変えない。`WorkRecord`、`EpisodeRecord`、`EntityRecord`、`PageRecord`、`PanelRecord` などを同名で使う。

`domain/frameTemplates.ts` は11章のテンプレートID、panel count、vertices、reading_order を使う。
プレビューだけ別定義にすると、実際の生成レイアウトとズレるので禁止する。

## 28. APIクライアントの必須メソッド

`LyraApiClient.ts` には以下を実装する。
戻り値の型名は9.6の型定義と同じにする。

```ts
class LyraApiClient {
  getCurrentSession(): Promise<CurrentSessionRecord>;

  getWorks(organizationId?: string | null): Promise<{ works: WorkRecord[] }>;
  createWork(body: CreateWorkPayload, organizationId?: string | null): Promise<WorkRecord>;
  updateWork(workId: string, body: UpdateWorkPayload, organizationId?: string | null): Promise<WorkRecord>;

  getChapters(workId: string, organizationId?: string | null): Promise<{ chapters: ChapterRecord[] }>;
  createChapter(workId: string, body: CreateChapterPayload, organizationId?: string | null): Promise<ChapterRecord>;
  updateChapter(chapterId: string, body: UpdateChapterPayload, organizationId?: string | null): Promise<ChapterRecord>;
  moveChapter(chapterId: string, direction: 'up' | 'down', organizationId?: string | null): Promise<ChapterRecord>;
  deleteChapter(chapterId: string, organizationId?: string | null): Promise<void>;

  getEpisodes(chapterId: string, organizationId?: string | null): Promise<{ episodes: EpisodeRecord[] }>;
  createEpisode(chapterId: string, body: CreateEpisodePayload, organizationId?: string | null): Promise<EpisodeRecord>;
  updateEpisode(episodeId: string, body: UpdateEpisodePayload, organizationId?: string | null): Promise<EpisodeRecord>;
  moveEpisode(episodeId: string, direction: 'up' | 'down', organizationId?: string | null): Promise<EpisodeRecord>;
  deleteEpisode(episodeId: string, organizationId?: string | null): Promise<void>;

  improveEpisodeDraft(body: StoryEpisodeImprovePayload, organizationId?: string | null): Promise<StoryEpisodeImprovementRecord>;
  generatePageSkeleton(
    episodeId: string,
    body: { overwrite_existing?: boolean; apply_story_plan?: boolean; language?: 'ja' | 'en' },
    organizationId?: string | null,
  ): Promise<{ job_id?: string; queued?: boolean; story_plan_applied?: boolean }>;
  autofillEpisodePagesFromStory(
    episodeId: string,
    language: 'ja' | 'en',
    organizationId?: string | null,
  ): Promise<{ job_id: string }>;

  getEntities(workId: string, organizationId?: string | null): Promise<{ entities: EntityRecord[] }>;
  createEntity(workId: string, body: EntityPayload, organizationId?: string | null): Promise<EntityRecord>;
  updateEntity(entityId: string, body: Partial<EntityPayload>, organizationId?: string | null): Promise<EntityRecord>;
  deleteEntity(entityId: string, organizationId?: string | null): Promise<void>;
  importEntityImage(body: { image_base64: string; entity_type: EntityType; entity_id?: string }, organizationId?: string | null): Promise<EntityImportResult>;
  generateEntityReference(entityId: string, body?: { source_candidate_token?: string; source_s3_key?: string }, organizationId?: string | null): Promise<{ job_id: string }>;
  getEntityReferenceSet(entityId: string, organizationId?: string | null): Promise<EntityReferenceSetRecord>;
  confirmEntityReference(entityId: string, body: ConfirmReferencePayload, organizationId?: string | null): Promise<EntityReferenceSetRecord>;
  deleteEntityReference(entityId: string, refId: string, organizationId?: string | null): Promise<EntityReferenceSetRecord>;

  getScenes(episodeId: string, organizationId?: string | null): Promise<{ scenes: SceneRecord[] }>;
  createScene(episodeId: string, body: ScenePayload, organizationId?: string | null): Promise<SceneRecord>;
  updateScene(sceneId: string, body: Partial<ScenePayload>, organizationId?: string | null): Promise<SceneRecord>;

  getPages(episodeId: string, organizationId?: string | null): Promise<{ pages: PageRecord[] }>;
  updatePage(pageId: string, body: UpdatePagePayload, organizationId?: string | null): Promise<PageRecord>;
  generatePage(pageId: string, organizationId?: string | null): Promise<{ job_id: string }>;
  confirmPage(pageId: string, organizationId?: string | null): Promise<void>;
  reopenPage(pageId: string, organizationId?: string | null): Promise<void>;

  getPanels(pageId: string, organizationId?: string | null): Promise<{ panels: PanelRecord[] }>;
  createPanel(pageId: string, body: PanelPayload, organizationId?: string | null): Promise<PanelRecord>;
  updatePanel(panelId: string, body: Partial<PanelPayload>, organizationId?: string | null): Promise<PanelRecord>;
  deletePanel(panelId: string, organizationId?: string | null): Promise<void>;
  reorderPanels(pageId: string, panelIds: string[], organizationId?: string | null): Promise<{ panels: PanelRecord[] }>;
  replacePanelAssignments(panelId: string, body: { entities: PanelEntityAssignmentPayload[] }, organizationId?: string | null): Promise<{ entities: PanelEntityAssignmentRecord[] }>;

  getFrames(pageId: string, organizationId?: string | null): Promise<{ frames: PanelFrameRecord[] }>;
  applyPageLayoutTemplate(pageId: string, templateId: string, allowPanelTruncation: boolean, organizationId?: string | null): Promise<{ page: PageRecord; panels: PanelRecord[]; frames: PanelFrameRecord[] }>;
  replaceFrames(pageId: string, body: { frames: PanelFramePayload[] }, organizationId?: string | null): Promise<{ frames: PanelFrameRecord[] }>;

  getJob(jobId: string): Promise<GenerationJobRecord>;
  getBalance(): Promise<BillingBalanceRecord>;

  exportPageImage(pageId: string, organizationId?: string | null): Promise<BlobLikeResponse>;
  exportEntityReferenceImage(entityId: string, refId: string, organizationId?: string | null): Promise<BlobLikeResponse>;
  exportEntityReferenceCandidateImage(entityId: string, candidateToken: string, organizationId?: string | null): Promise<BlobLikeResponse>;
}
```

モバイルでは `Blob` の扱いが環境によって異なる。
実装では `arrayBuffer` または `base64` と `contentType` を返すラッパーにして、画面側へブラウザ依存の `Blob` を漏らさない。

このメソッド一覧で使う payload 型は、29章の型を基本にする。
29章に個別定義がないものは以下で固定する。

```ts
type CreateChapterPayload = {
  order: number;
  title?: string | null;
  purpose?: string | null;
  starting_state?: string | null;
  ending_state?: string | null;
  emotion_curve?: string | null;
  entities_involved?: string[];
  key_beats?: string[];
};

type UpdateChapterPayload = Partial<CreateChapterPayload> & {
  status?: 'draft' | 'reviewing' | 'ready';
};

type CreateEpisodePayload = {
  order: number;
  title?: string | null;
  purpose?: string | null;
  story_input_mode?: 'full';
  story_full_draft?: string | null;
  introduction?: string | null;
  middle?: string | null;
  climax?: string | null;
  ending_hook?: string | null;
  estimated_pages?: number;
  entities_involved?: string[];
};

type StoryEpisodeImprovePayload = {
  episode_id: string;
  instruction: string;
  language: 'ja' | 'en';
  base_draft: {
    title: string | null;
    purpose: string | null;
    story_input_mode: 'structured' | 'full';
    story_full_draft: string | null;
    introduction: string | null;
    middle: string | null;
    climax: string | null;
    ending_hook: string | null;
  };
};

type ScenePayload = {
  order: number;
  location?: string | null;
  time?: string | null;
  atmosphere?: string | null;
  involved_entity_ids?: string[];
  entity_states?: Array<{
    entity_id: string;
    visible_state?: string | null;
    emotional_state?: string | null;
    outfit_state?: string | null;
    injury_state?: string | null;
    notes?: string | null;
  }>;
};

type ConfirmReferencePayload = {
  selected_s3_keys?: string[];
  selected_candidate_tokens?: string[];
  primary_s3_key?: string;
  primary_candidate_token?: string;
  prompt_supplement?: string | null;
};

type BlobLikeResponse = {
  base64: string;
  contentType: string | null;
};

type EntityImportResult = {
  tmp_image_token?: string;
  source_candidate_token?: string;
  suggested_fields?: Record<string, unknown>;
  prompt_supplement?: string | null;
};
```

`EntityImportResult` は実レスポンスの追加フィールドを許容する。
画面側は存在するフィールドだけを使い、未知のフィールドで失敗しない。

## 29. ペイロード生成ルール

### 29.1 空文字

空文字は原則 `null` にする。
ただし、必須項目は空なら送信前にUIで止める。

```ts
function nullableText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
```

### 29.2 Work payload

```ts
type CreateWorkPayload = {
  title: string;
  genre?: string | null;
  world_setting?: string | null;
  theme?: string | null;
  main_entity_ids?: string[];
  starting_point?: string | null;
  ending_point?: string | null;
  overall_flow?: string | null;
  organization_id?: string | null;
};

type UpdateWorkPayload = Partial<Omit<CreateWorkPayload, 'organization_id'>> & {
  status?: 'draft' | 'reviewing' | 'ready';
};
```

作成時、`title` は必須。
更新時は少なくとも1項目を含める。

### 29.3 Episode payload

```ts
type UpdateEpisodePayload = {
  order?: number;
  title?: string | null;
  purpose?: string | null;
  story_input_mode?: 'full';
  story_full_draft?: string | null;
  introduction?: string | null;
  middle?: string | null;
  climax?: string | null;
  ending_hook?: string | null;
  estimated_pages?: number;
  entities_involved?: string[];
  status?: 'draft' | 'reviewing' | 'ready';
};
```

モバイルUIでは `story_input_mode` は常に `full`。
分割欄を出さないため、`introduction` / `middle` / `climax` / `ending_hook` は通常更新しない。既存データとの互換のため型だけ残す。

### 29.4 Entity payload

```ts
type EntityPayload = {
  entity_type: 'character' | 'nonhuman' | 'object';
  name: string;
  free_description?: string | null;
  prompt_supplement?: string | null;
  structured_fields?: Record<string, unknown>;
  speech_profile?: Record<string, unknown>;
};
```

キャラ生成前には必ず `updateEntity` を呼び、その後 `generateEntityReference` を呼ぶ。

### 29.5 Page payload

```ts
type UpdatePagePayload = {
  dialogue_mode?: 'image_baked' | 'balloon_only' | 'mixed';
  page_dialogue_toggle?: boolean;
  style_reference?: {
    title: string;
    notes?: string | null;
  } | null;
  story_source_scene_ids?: string[];
  story_page_purpose?: string | null;
  story_continuity_note?: string | null;
};
```

モバイルではページ全体のセリフ設定UIを出さない。
ただし互換のため `dialogue_mode` / `page_dialogue_toggle` は既存値を壊さないよう、画面で編集しない限り送らない。

### 29.6 Panel payload

```ts
type PanelPayload = {
  order: number;
  panel_role?: 'establish' | 'action' | 'reaction' | 'emphasis' | 'transition' | 'pause' | 'impact';
  panel_size?: 'standard' | 'large' | 'wide' | 'narrow' | 'splash';
  situation_text?: string | null;
  composition?: {
    source: 'gallery' | 'custom' | 'ai_auto';
    gallery_item_id?: string | null;
    composition_prompt?: string | null;
    shot_type?: 'full_body' | 'half_body' | 'close_up' | 'wide' | 'extreme_close_up' | null;
    angle?: 'front' | 'side' | 'three_quarter' | 'bird_eye' | 'worm_eye' | 'dutch_angle' | null;
    custom_note?: string | null;
  };
  dialogue_in_panel?: boolean;
  dialogue?: Array<{
    entity_id?: string | null;
    text: string;
    type: 'speech' | 'thought' | 'narration' | 'shout' | 'whisper' | 'sfx';
    position: 'top' | 'bottom' | 'left' | 'right' | 'center';
  }>;
  sfx_text?: string | null;
  background_note?: string | null;
  panel_notes?: string | null;
};
```

`speech` / `thought` / `shout` / `whisper` は `entity_id` 必須。
`narration` と `sfx` は `entity_id` を null にする。

### 29.7 Panel assignment payload

```ts
type PanelEntityAssignmentPayload = {
  entity_id: string;
  role: 'primary' | 'secondary' | 'background';
  expression: 'determined' | 'calm' | 'angry' | 'sad' | 'surprised' | 'custom';
  custom_expression?: string | null;
  action: 'standing_firm' | 'attacking' | 'defending' | 'running' | 'custom';
  custom_action?: string | null;
  position: 'left' | 'center' | 'right' | 'background';
  facing_direction?: 'front' | 'left' | 'right' | 'away' | 'three_quarter_left' | 'three_quarter_right' | null;
  effect_note?: string | null;
  state_id?: string | null;
};

type PanelFramePayload = {
  panel_id: string;
  vertices: Array<{ x: number; y: number }>;
  border_style?: 'solid' | 'dashed' | 'none';
  border_width?: number;
  border_color?: string;
  z_index?: number;
  reading_order?: number;
};
```

同じコマに同じ `entity_id` を複数入れない。
`expression` が `custom` の場合は `custom_expression` 必須。
`action` が `custom` の場合は `custom_action` 必須。

## 30. 画面状態の固定ルール

### 30.1 選択状態

以下を永続化する。

```ts
type WorkspaceSelectionState = {
  selectedOrganizationId: string | null;
  selectedWorkId: string | null;
  selectedChapterId: string | null;
  selectedEpisodeId: string | null;
  selectedEntityId: string | null;
  selectedPageId: string | null;
  selectedPanelId: string | null;
};
```

保存キーにはユーザーIDまたは Cognito subject を含める。

例:

```text
lyra:selected-state:<cognito-sub>
```

ログアウト時はこの状態を消す。
別ユーザーでログインしたときに前ユーザーの作品選択を復元しない。

### 30.2 生成中状態

```ts
type TrackedJob = {
  jobId: string;
  type: 'page_generate' | 'entity_generate' | 'episode_story_autofill' | 'episode_page_skeleton';
  relatedId: string;
  startedAt: string;
};
```

ジョブはアカウントタブにも、関連画面にも表示する。

### 30.3 ジョブ完了時の再取得

| job type | 再取得 |
|---|---|
| `entity_generate` | entity reference set, jobs, balance |
| `page_generate` | pages, selected page, jobs, balance |
| `episode_page_skeleton` | pages, panels, frames, jobs |
| `episode_story_autofill` | pages, panels, frames, jobs |

ジョブが failed の場合も jobs は再取得する。
入力欄は消さない。

## 31. 実装時にそのまま使う選択肢

この章の `value` は保存値またはUI内部値として使う。
表示ラベルは日本語/英語の辞書で出し分ける。

### 31.1 Character common

| 項目 | values |
|---|---|
| gender_expression | `female`, `male`, `androgynous`, `unspecified` |
| age_range | `child`, `early_teens`, `late_teens`, `twenties`, `thirties`, `forties_plus`, `ageless` |
| skin_tone | `fair`, `light`, `medium`, `tan`, `deep`, `custom` |
| first_impression | `bright_friendly`, `quiet_neat`, `cool_distant`, `gentle_soft`, `serious_reliable`, `mysterious_fragile`, `energetic_bold`, `stoic_reserved`, `rugged_calm`, `sharp_elite`, `playful_confident`, `mature_composed` |
| standing_style | `upright_neat`, `natural_relaxed`, `shy_reserved`, `confident_open`, `still_quiet`, `arms_crossed`, `hands_in_pockets`, `guarded_stance`, `wide_grounded_stance`, `elegant_upright` |
| default_expression | `soft_smile`, `calm_neutral`, `serious_focus`, `cheerful_smile`, `shy_reserved`, `cool_unfazed`, `stern_look`, `tired_neutral`, `confident_smirk`, `bored_gaze`, `teasing_smile` |
| build | `petite`, `slender`, `average`, `athletic`, `muscular`, `curvy`, `lean`, `stocky`, `broad`, `large` |
| height | `very_short_height`, `short`, `average`, `tall`, `very_tall_height` |

### 31.2 Character face / hair / eyes

| 項目 | values |
|---|---|
| face_shape | `round`, `oval`, `heart`, `square`, `diamond`, `long`, `soft_triangle`, `custom` |
| eyebrow_shape | `straight`, `soft_arch`, `high_arch`, `thick`, `thin`, `sharp`, `custom` |
| nose_shape | `small`, `straight`, `button`, `sharp`, `rounded`, `broad`, `custom` |
| mouth_shape | `soft`, `full`, `thin`, `wide`, `smirk`, `serious`, `custom` |
| hair.color | `black`, `brown`, `dark_brown`, `blonde`, `ash_blonde`, `auburn`, `silver`, `gray`, `white`, `blue`, `green`, `red`, `pink`, `purple`, `two_tone`, `custom` |
| hair.length | `very_short`, `short`, `medium`, `long`, `very_long` |
| hair.style | `straight`, `wavy`, `curly`, `wild`, `tousled`, `spiky`, `fluffy`, `slick`, `coarse`, `shaved` |
| hair.arrangement | `down`, `short_cut`, `buzz_cut`, `crew_cut`, `two_block`, `undercut`, `fade_cut`, `side_part`, `center_part`, `comma_hair`, `slick_back`, `messy_short`, `pompadour`, `short_bob`, `medium_layered`, `wolf_cut`, `long_straight`, `ponytail`, `side_ponytail`, `twin_tails`, `bun`, `man_bun`, `topknot`, `braid`, `half_up`, `tied_back`, `shaved_sides`, `custom` |
| hair.bangs | `none`, `light`, `standard`, `heavy`, `side_swept`, `blunt`, `parted`, `center_parted`, `curtain`, `messy_bangs`, `short_bangs`, `long_bangs` |
| eyes.color | `black`, `brown`, `blue`, `green`, `red`, `gold`, `silver`, `purple`, `custom` |
| eyes.shape | `gentle`, `sharp`, `round`, `narrow` |
| eyes.eyelid_type | `single`, `double` |

### 31.3 Character clothing / identity

| 項目 | values |
|---|---|
| clothing.category | `military`, `school`, `casual`, `suit`, `business_casual`, `lab_coat`, `trench_coat`, `tactical`, `traditional_formal`, `street_jacket`, `fantasy`, `japanese`, `streetwear`, `hoodie`, `sports`, `winter_coat`, `workwear`, `armor`, `gothic`, `formal_dress`, `idol_stage`, `custom` |
| clothing.main_color | `black`, `white`, `navy`, `gray`, `brown`, `red`, `blue`, `green`, `custom` |
| clothing.impression | `formal`, `practical`, `elegant`, `rough`, `cute`, `custom` |
| outfit_detail.collar_shape | `round collar`, `sharp collar`, `standing collar`, `sailor collar`, `hooded neckline` |
| outfit_detail.sleeve_length | `sleeveless`, `short sleeves`, `three-quarter sleeves`, `long sleeves`, `wide sleeves` |
| outfit_detail.skirt_or_pants_shape | `short skirt`, `long skirt`, `straight pants`, `wide pants`, `slacks`, `jeans`, `cargo pants`, `shorts` |
| outfit_detail.shoes | `loafers`, `sneakers`, `boots`, `dress shoes`, `combat boots`, `heels`, `school shoes` |
| outfit_detail.socks_or_legwear | `bare legs`, `ankle socks`, `knee socks`, `thigh-high socks`, `tights` |
| art_style | `anime`, `semi_realistic`, `manga`, `painterly` |
| visual_anchor | `Face + hair balance`, `Eye line`, `Silhouette outline`, `Posture read`, `Outfit shape`, `Color blocking`, `Accessory / prop`, `custom` |
| signature_feature | `Hair shape`, `Eye color contrast`, `Expression gap`, `Silhouette edge`, `Accessory`, `Scar / mark`, `Stance`, `custom` |
| silhouette_keywords | `Compact silhouette`, `Tall and slender`, `Broad-shouldered`, `Long coat outline`, `Skirt line`, `Military block`, `Soft rounded outline`, `custom` |
| distinguishing_features | `Beauty mark`, `Scar`, `Eye bags`, `Fang`, `Ahoge`, `Hair streak`, `Glasses`, `Stubble`, `Beard`, `Goatee`, `Earrings`, `Thick eyebrows`, `Sharp jawline`, `custom` |

### 31.4 Nonhuman / Object

Nonhuman:

- `base_form`: `dragon`, `wolf`, `spirit`, `robot`, `zombie`, `deity`, `custom`
- `size`: `tiny`, `small`, `human_scale`, `large`, `enormous`
- `movement`: `bipedal`, `quadruped`, `flying`, `floating`, `slithering`, `custom`
- `threat_level`: `harmless`, `low`, `medium`, `high`, `catastrophic`
- `art_style`: `anime`, `semi_realistic`, `manga`, `painterly`

Object:

- `category`: `weapon`, `tool`, `vehicle`, `structure`, `consumable`, `magical`, `custom`
- `material`: `metal`, `wood`, `stone`, `crystal`, `organic`, `energy`, `custom`
- `size`: `small`, `medium`, `large`, `enormous`

### 31.5 Panel / Frame

Panel values は 12.1 と同じ。
Frame template values は 11 と同じ。
この2つはバックエンド enum に直結するため、値を変更してはいけない。

## 32. 生成前保存の実装例

### 32.1 ページ生成

```ts
async function generateCurrentPage(): Promise<void> {
  if (!selectedPageId) throw new Error('page not selected');

  await savePageSettingsIfDirty();
  await saveAllDirtyPanels();
  await saveAllDirtyPanelAssignments();

  const page = getSelectedPageFromCache();
  if (page.frame_count !== page.panel_count) {
    showError('コマ数とコマ枠数が一致していません。コマ割りまたはコマ数を調整してください。');
    return;
  }

  const result = await api.generatePage(selectedPageId, currentOrganizationId);
  trackJob({ jobId: result.job_id, type: 'page_generate', relatedId: selectedPageId });
}
```

### 32.2 キャラプレビュー生成

```ts
async function generateCurrentEntityReference(): Promise<void> {
  if (!selectedEntityId) throw new Error('entity not selected');

  await saveEntityIfDirty();

  const body =
    selectedImportCandidateToken !== null
      ? { source_candidate_token: selectedImportCandidateToken }
      : undefined;

  const result = await api.generateEntityReference(selectedEntityId, body, currentOrganizationId);
  trackJob({ jobId: result.job_id, type: 'entity_generate', relatedId: selectedEntityId });
}
```

### 32.3 話全体反映

```ts
async function applyStoryToPages(): Promise<void> {
  if (!selectedEpisodeId) throw new Error('episode not selected');

  await saveEpisodeIfDirty();

  showLongRunningNotice('この処理は20分程度かかる場合があります');

  const result = await api.autofillEpisodePagesFromStory(selectedEpisodeId, uiLanguage, currentOrganizationId);
  trackJob({ jobId: result.job_id, type: 'episode_story_autofill', relatedId: selectedEpisodeId });
}
```

## 33. 追加監査結果

再精査の結果、最初の版だけでは以下が不足していた。

- 実装ファイル構成
- APIクライアントのメソッド単位の設計
- `/api/me` の正確なパス
- 参照候補画像取得APIの正確なパス
- 保存前処理の実装例
- Panel / Entity / Page の payload 形状
- ジョブ完了時に再取得する query
- キャラクター選択肢の具体値
- APIレスポンスの主要型
- コマ割りテンプレートの座標
- CognitoでAPIへ送るトークン種別

本章までの追記により、実装者はこの設計書だけを起点にモバイルフロントを作れる。
ただし、この設計書の最終更新日以降にバックエンドAPIを変更した場合は、実装前にこの設計書自体を更新する。実装者へ別ファイル確認を要求しない。

この資料以外に必要なものは、実装判断ではなく環境値と素材だけである。

- `API_BASE_URL`
- `COGNITO_DOMAIN`
- `COGNITO_CLIENT_ID`
- `COGNITO_REDIRECT_URI`
- `COGNITO_LOGOUT_URI`
- `logo.png`
- `start_lyra.jpg`

上記はアプリ固有の接続先・画像素材であり、画面構成やAPI契約の判断材料ではない。
