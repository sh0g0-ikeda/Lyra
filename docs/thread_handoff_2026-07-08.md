# Lyra 引き継ぎメモ - 2026-07-08

この文書は、長くなったトークルームから別トークルームへ移るための引き継ぎ資料である。
次のAIエージェントは、まずこの文書、`AGENTS.md`、関連ドキュメントを読んでから作業すること。

## 1. 現在のリポジトリ状態

- 作業ディレクトリ: `C:\Users\shogo\Lyra`
- 現在ブランチ: `fix/japanese-ui-localization`
- 最新コミット:
  - `9183ca8 fix(web): clarify auth screen copy`
  - `71493b2 fix(web): localize remaining Japanese UI labels`
  - `224271f docs(docker): record learning materials before ui localization fix`
  - `032a80f fix(generation): lock panel situation and background cues`
  - `0a86368 fix(billing): wait for credits after subscription checkout`
- 未コミット差分:
  - `docs/mobile_frontend_design.md` は新規作成済み、まだ未追跡
  - `scripts/createDockerLearningDocx.py` に既存の未コミット変更あり

`scripts/createDockerLearningDocx.py` の変更は今回のモバイル設計・引き継ぎ作業とは無関係。
次の作業者は、明示指示がない限り触らないこと。

## 2. 作業ルール

必ず `AGENTS.md` を読む。重要な運用ルールは以下。

- いきなり実装しない。目的、影響範囲、設計、セキュリティリスクを先に整理する。
- 既存パイプラインを壊さない。
- 認証・認可、入力バリデーション、シークレット管理、クレジット競合対策を重視する。
- 変更前後でテスト、ビルド、文字化け確認を行う。
- ユーザーの既存変更を勝手に戻さない。
- ファイル編集は原則 `apply_patch` を使う。

注意: `AGENTS.md` では `docs/Lyra_Unified_Spec_v4.md` を読むよう書かれているが、現リポジトリでは `docs/` 配下には見当たらず、ルートに `Lyra_Unified_Spec_v4.md` が存在する。現行実装と直近ドキュメントを優先して確認すること。

## 3. 現在のプロダクト方針

Lyra はAI漫画制作エディタである。主要タブは以下。

- ストーリー
- キャラクター
- ページ
- 決済、残クレジット、ジョブ履歴、チュートリアル、言語、ログアウト

現在のToC向け方針:

- 個人機能を先にリリースする。
- 法人機能は実装の土台はあるが、公開UIは feature flag で停止中。
- 法人UIには「法人機能は近日追加予定です」を表示する。
- 法人機能を復活させるときは feature flag でUIを戻せる設計にしている。

## 4. 課金・クレジット方針

現在の基本方針:

- 1クレジット = 20円
- キャラ画像生成、参照画像インポート = 1クレジット
- ページ画像生成 = 3クレジット
- ページに登場するキャラが4体を超える場合、1人増えるごとに追加1クレジット
- 月額サブスク分のクレジットは「毎月規定クレジットへ更新」。蓄積ではない。
- 追加購入クレジットは購入分として残る。

Stripe:

- スタンダードは 1000円 / 50クレジット方針。
- プレミアムプランをUIに表示する。
- プラン変更・解約は Stripe Customer Portal で行う。
- UI文言は「有料プランの変更・解約は『サブスク・請求を管理』で行ってください」。
- Stripeへ遷移しただけで「決済完了」のように見せない。完了確認はWebhook・残高反映後に行う。

## 5. 認証・ログイン方針

認証は Cognito Hosted UI を使う。独自ログインUIは避ける。

重要事項:

- APIには Cognito の `id_token` を `Authorization: Bearer <id_token>` として送る。
- 未確認ユーザーやメール確認エラーが起きやすいため、Cognitoメール送信設定に注意する。
- ログイン後に作品一覧が読めない問題が過去に複数回起きた。原因候補は以下。
  - トークン種別不一致
  - ユーザー作成・同期処理の失敗
  - APIレスポンスキャッシュがユーザーごとに分離されていない
  - Stripe遷移・ブラウザバック後のセッション再取得漏れ

Cognito画面コピー:

- 上部ブランド: `Lyra Japan`
- 見出し: `Lyra AI漫画エディタ`
- CTA: `ログイン・アカウント登録はこちら`

## 6. 法人機能の状態

法人機能は一度かなり実装されたが、SES承認・招待メール・実運用の不確実性が残るため、個人リリース優先でUI停止中。

実装済み・整備済みの範囲:

- organization 基盤
- workspace 切り替え
- member / invitation 系API
- audit / usage / billing の一部
- feature flag による法人UI表示切替
- `enterprise.md` に法人契約機能の要件定義

重要な過去問題:

- 招待メールが届かない。
- 招待リンクが無効扱いになる。
- 招待先メールアドレスとログイン中メールアドレスの照合で失敗する。
- Cognitoが確認コードを送れず `User Pool not configured properly for confirmation code delivery` が出た。
- 法人UIカードでメールアドレスや価格カードが細すぎて文字が縦割れした。

現在の方針:

- 個人向けリリースまでは法人機能を無効化。
- 復活できるよう実装自体は消さず、UI分岐で隠す。

## 7. 生成パイプラインの重要方針

### 7.1 ページ生成

ページ生成・再生成は同じ思想:

- 「いま保存されている入力内容から新規生成」
- 前回画像をレファレンスとして渡して編集する方式ではない
- 再生成でも前回画像に引っ張られないようにする

強制したい入力:

- コマの状況
- 背景
- 登場人物
- セリフ
- 構図
- カメラ演出

過去問題:

- UI上では司カサネがいるはずなのに生成では篝カイが出るなど、参照画像・キャララベルの混乱があった。
- レファレンス画像に対して明示的なキャラ名ロックが弱いと、画像モデルが取り違える。
- 対策として画像参照とキャラ名を明確に結び付ける修正を入れた。

### 7.2 StoryAI / 話全体反映

話全体反映は、ストーリーをページ・コマへ分散し、各コマに以下を自動入力する機能。

- 状況
- 登場人物
- 背景
- 構図
- カメラアングル
- セリフ

重要:

- fallback に落ちると内容が薄くなりやすい。
- JSON出力は壊れにくさ優先でGPT系 structured output を重視。
- 反映処理は時間がかかるため、UIには「この処理は20分程度かかる場合があります」を出す。
- 進捗バーは疑似進捗でもよいが、完了・失敗時には正しい状態に戻す。

## 8. UI方針

### 8.1 PC版

現在の主なUI方針:

- 日本語/英語切替対応。
- 日本語選択時に英語・`\uXXXX` が出ないよう修正済み。
- ページ生成系ボタンは黄色で目立たせる。
- チュートリアルは目立つ黄色/金系アクセント。
- セリフ設定UIは不要として削除。
- 画風制約はセリフとは独立したUIで、初期状態で畳まない。
- シーンは任意。シーンが空でも生成を拒否しない。
- ページ骨格生成直後に「完了」と出さず「開始しました」と出す。
- コマ割りプレビューは実際のテンプレート座標と一致させる。
- 漫画のコマ順は右から左、上から下。

### 8.2 モバイル版

`docs/mobile_frontend_design.md` を作成した。
この文書は、別トークルーム・別担当者が「この資料だけ」で Lyra for mobile のフロントを作れるようにする目的。

直近で追記済み:

- 主要API契約
- React Native / Expo 推奨構成
- Cognito Hosted UI 認証設計
- APIへ送るトークン種別は `id_token`
- 主要型定義
- コマ割りテンプレート座標
- 下部タブ構成
- 生成前保存ルール
- エラー文言方針
- ジョブ進捗UI
- テスト計画

モバイル下部タブ方針:

- ストーリー
- キャラクター
- ページ
- アカウント
- ガイド

モバイルでは、画面が長すぎないように以下を重視:

- 重要な作業導線は展開状態
- 補助情報は折りたたみ
- 新しい作品作成UIはストーリータブだけ
- チュートリアルは独立したガイドタブ
- クレジット・ジョブ・言語・ログアウトはアカウントタブ

## 9. クラウド構成の状態

AWS本番構成は概ね以下。

- リージョン: `ap-northeast-1`
- ECS Fargate
- API task
- Worker task
- ALB
- CloudFront
- RDS PostgreSQL
- S3
- SQS
- Secrets Manager
- Cognito
- Stripe

過去の重要対応:

- CloudFront制限は解放済み。
- ALBは現時点では撤去しない方針。
- RDSはコスト最適化済み。
- Workerは常時最大化しない。コストと可用性のバランスを取る。
- ピーク時だけ worker min 1 を検討・採用方向。
- 深夜は worker 0 にできるが、ジョブ開始に数分かかる可能性がある。

コスト関連:

- 二週間で50ドル程度の請求アラートが来た。
- stock-alert-backend は停止・削除したいという話があり、不要リソース削除は重要。
- ALB / RDS / VPC / S3 / ECS worker が主要固定費。
- ALB撤去はメリットもあるが構成変更リスクが大きいため不採用。

詳細は以下を読む。

- `docs/cloud-current-state-2026-06-21.md`
- `docs/cloudfront-migration-completed-2026-06-21.md`
- `docs/cloud-ops-guardrails-2026-06-21.md`
- `docs/cloud-cost-cuts-2-3-7-2026-06-22.md`
- `docs/phase9-production-runbook.md`

## 10. デプロイ・運用

よく使うローカルコマンド:

```powershell
bun run build
bun run test
bun run web:build
bun run web:lint
```

ローカル起動:

```powershell
bun run dev
bun run web:dev
```

DB:

```powershell
bun run db:up
bun run migrate
```

管理系:

```powershell
bun run admin:refund-credits
bun run admin:prune-images
bun run admin:prune-jobs
bun run admin:prune-rate-limits
```

本番デプロイは、ECR push、ECS task definition 更新、service 更新、必要なら migration task 実行という流れ。
過去に AWS CLI / CloudShell / ECS / CloudFormation / IAM role / SQS policy / RDS / Cognito / Stripe を手動で設定している。次に触る場合は既存ドキュメントとAWSコンソールの現在値を再確認する。

## 11. 直近の作業内容

直近の実装・調整履歴:

- 日本語UIの残存英語・文字化け修正
- Cognito認証画面コピー修正
- ページ生成時に状況・背景をより強くプロンプトへ反映
- チュートリアル文言更新
- 法人UIを feature flag で停止
- モバイルフロント設計書作成
- モバイル設計書を「この資料だけで実装できる」よう追加監査・追記

直近の未コミット作業:

- `docs/mobile_frontend_design.md`

## 12. 既知の注意点

### 12.1 `docs/mobile_frontend_design.md`

未追跡ファイル。必要なら次の作業でコミットする。
外部参照や文字化けは最後に以下で確認済み。

```powershell
rg -n "TODO|TBD|未定|要確認|apps/web|src/domain|panelFrameTemplates|移植|再利用|最終実装前|再確認|Web 版と同じ|Web版と同じ|Web 版に合わせ|Web版に合わせ" docs/mobile_frontend_design.md
rg -n "�|\\u[0-9a-fA-F]{4}|ã|譁|縺|邱|蜿|繧|髫" docs/mobile_frontend_design.md
```

どちらも問題検出なし。

### 12.2 `scripts/createDockerLearningDocx.py`

未コミット変更あり。今回の文書作業とは無関係。
過去に Docker学習用 docx 生成のため触ったファイル。次の作業で不用意に巻き込まないこと。

### 12.3 生成ジョブ

本番ではジョブが SQS / worker / DB 状態に依存する。
UIで `Queued. Starts soon.` と出た場合、worker が0台なら開始に数分かかる可能性がある。
stuck対策として、ジョブタイムアウト、段階別ログ、失敗時の回復導線が重要。

### 12.4 画像生成のキャラ取り違え

何度も特定キャラが出ない場合、単なる画像モデルの確率ミスではなく、以下を疑う。

- panel entities が保存済みDB上で間違っている
- フロントの保存内容とバックエンドの生成時スナップショットがズレている
- 参照画像とキャラ名のラベルが弱い
- プロンプトコンパイラが visual lock を落としている

現在は参照画像とキャラ名を結びつける修正が入っているが、再発時はDB上の生成スナップショットを確認する。

## 13. 次のトークルームで最初にやること

1. `AGENTS.md` を読む。
2. `docs/thread_handoff_2026-07-08.md` を読む。
3. `git status --short` を確認する。
4. 未追跡の `docs/mobile_frontend_design.md` をどう扱うか決める。
5. `scripts/createDockerLearningDocx.py` の未コミット変更を巻き込まない。
6. ユーザーの次の依頼が実装なら、設計を短く提示してから着手する。

## 14. 次にやる可能性が高い作業

候補:

- `docs/mobile_frontend_design.md` のコミット
- モバイル版実装の着手
- PC版UIの追加調整
- 本番デプロイ確認
- 課金/Stripe設定の最終確認
- 法人機能復活前のSES・招待フロー検証
- 生成パイプラインの品質・速度・コスト監査

モバイル版に入る場合は、`docs/mobile_frontend_design.md` を正本として扱うこと。
この文書は「別担当者が資料だけで実装できる」前提まで追記済み。
